

import { HttpError } from './wallet-security.js';

// Provider metadata values must be strings of at most 100 characters.
// Version 1 stores [format, creditMinor, feeMinor, totalMinor, feeConfigVersion]
// as a short STRING. The public response still exposes the full quote object.
export function encodeTopupQuote(quote) {
  if (quote?.netMode !== true || !validQuote(quote, quote.totalMinor)) {
    throw new HttpError(502, 'Top-up fee receipt does not match.');
  }
  const value = JSON.stringify([
    1, quote.walletCreditMinor, quote.feeMinor, quote.totalMinor, quote.version,
  ]);
  if (value.length > 100) throw new HttpError(502, 'Top-up receipt exceeds the provider metadata limit.');
  return value;
}

function validQuote(quote, totalMinor) {
  return quote?.netMode === true &&
    Number.isSafeInteger(quote.walletCreditMinor) && quote.walletCreditMinor > 0 &&
    Number.isSafeInteger(quote.feeMinor) && quote.feeMinor >= 0 &&
    Number.isSafeInteger(quote.totalMinor) && quote.totalMinor > 0 &&
    quote.totalMinor === totalMinor &&
    quote.walletCreditMinor + quote.feeMinor === quote.totalMinor &&
    (quote.requestedMinor == null || quote.requestedMinor === quote.walletCreditMinor) &&
    typeof quote.version === 'string' && /^[a-f0-9]{24}$/.test(quote.version);
}

export function decodeTopupQuote(value, totalMinor) {
  let quote;
  try {
    if (typeof value !== 'string') throw new Error();
    const stored = JSON.parse(value);
    if (Array.isArray(stored)) {
      if (stored.length !== 5 || stored[0] !== 1) throw new Error();
      quote = {
        netMode: true, requestedMinor: stored[1], walletCreditMinor: stored[1],
        feeMinor: stored[2], totalMinor: stored[3], version: stored[4],
      };
    } else {
      // Read previous object-format receipts already saved by the provider.
      quote = stored;
    }
  } catch { throw new HttpError(502, 'Top-up quote receipt is invalid.'); }
  if (!validQuote(quote, totalMinor)) throw new HttpError(502, 'Top-up fee receipt does not match.');
  return quote;
}


export function publicPaymentCode(code, context) {
  const ownsSettlementWallet = context.wallets.some(
    wallet =>
      wallet.currency === 'SLE' &&
      (
        wallet.monime_account_id ||
        wallet.metadata?.monime_account_id
      ) === code.financialAccountId
  );

  if (
    code.metadata?.matmoveUserId !== context.user.id ||
    code.metadata?.purpose !== 'wallet_topup' ||
    !ownsSettlementWallet
  ) {
    throw new HttpError(
      403,
      'This payment code does not belong to your wallet.'
    );
  }

  if (
    code.mode !== 'one_time' ||
    code.amount?.currency !== 'SLE' ||
    !Number.isSafeInteger(code.amount?.value) ||
    code.amount.value <= 0 ||
    typeof code.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(code.id) ||
    (code.status==='pending' && (typeof code.ussdCode !== 'string' || !/^\*[0-9*]+#$/.test(code.ussdCode))) ||
    (code.status==='pending' && !Number.isFinite(Date.parse(code.expireTime))) ||
    ![
      'pending',
      'processing',
      'expired',
      'cancelled',
      'completed'
    ].includes(code.status)
  ) {
    throw new HttpError(
      502,
      'The provider returned an invalid payment code.'
    );
  }

  // GET payment-codes/:id does not include processedPaymentData; Monime
  // documents that field as webhook-only. The verified one-time code's
  // completed lifecycle is sufficient to retire this collection request.
  // This function never credits a local wallet balance.
  const paid = code.processedPaymentData;
  if(code.status==='completed' && paid != null && (
    typeof paid.paymentId!=='string' || !paid.paymentId ||
    paid.amount?.currency!=='SLE' || paid.amount.value!==code.amount.value
  ))throw new HttpError(502,'The completed payment details do not match this top-up. Contact support.');
  const confirmed=code.status==='completed';

  const storedQuote = code.metadata?.matmoveTopupQuote;
  const quote = storedQuote == null ? null : decodeTopupQuote(storedQuote, code.amount.value);
  return {
    quote,
    id: code.id,
    ussdCode: code.status==='pending'?code.ussdCode:null,
    amount: code.amount,
    expireTime: typeof code.expireTime==='string'&&Number.isFinite(Date.parse(code.expireTime))?code.expireTime:null,
    status: code.status,
    confirmed
  };
}

// Optional receipt lookup: completion never depends on a webhook or a recent
// balance delta. Match an actual Payment to this owned code, never by amount alone.
export async function topupSettlement(code, provider) {
  const payments=await provider(`payments?financialAccountId=${encodeURIComponent(code.financialAccountId)}&limit=50`);
  if(!Array.isArray(payments))return null;
  const belongs=p=>{
    if(typeof code.reference==='string'&&code.reference&&p.reference===code.reference)return true;
    let owner=p.ownershipGraph?.owner;
    for(let i=0;owner&&i<8;i++,owner=owner.owner)if(owner.type==='payment_code'&&owner.id===code.id)return true;
    return false;
  };
  const found=payments.filter(p=>p?.status==='completed'&&p.financialAccountId===code.financialAccountId&&p.amount?.currency==='SLE'&&p.amount.value===code.amount.value&&belongs(p));
  if(found.length!==1)return null;
  const payment=found[0];
  if(typeof payment.id!=='string'||!Array.isArray(payment.fees)||!payment.fees.every(f=>f.amount?.currency==='SLE'&&Number.isSafeInteger(f.amount.value)&&f.amount.value>=0))return null;
  const feeMinor=payment.fees.reduce((sum,f)=>sum+f.amount.value,0);
  if(!Number.isSafeInteger(feeMinor)||feeMinor>payment.amount.value)return null;
  return {paymentId:payment.id,feeMinor,creditMinor:payment.amount.value-feeMinor};
}
