import { verifiedAccount } from './wallet-security.js';

export class ManualReviewError extends Error {
  constructor(message) { super(message); this.name = 'ManualReviewError'; }
}
function toMinorUnits(value) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}
function reject(message) { throw new ManualReviewError(message); }

export function validateWalletTopupCheckoutSession(payment, wallet, session) {
  if (!payment || !wallet || !session || typeof session !== 'object') reject('Wallet top-up checkout is missing its MatMove payment or wallet record.');
  if (
    typeof session.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(session.id) ||
    payment.provider !== 'monime' || payment.transaction_type !== 'wallet_topup' ||
    payment.provider_reference !== session.id ||
    payment.metadata?.checkout_session_id !== session.id ||
    ['reversed', 'refunded'].includes(payment.status)
  ) reject('Monime checkout does not match one eligible MatMove wallet top-up.');
  if (
    !payment.user_id || !payment.wallet_id ||
    payment.metadata?.matmove_user_id !== payment.user_id ||
    payment.metadata?.wallet_id !== payment.wallet_id ||
    session.metadata?.userId !== payment.user_id ||
    !payment.metadata?.customer_role ||
    session.metadata?.role !== payment.metadata.customer_role
  ) reject('Monime checkout customer ownership could not be verified.');
  if (wallet.id !== payment.wallet_id || wallet.user_id !== payment.user_id) reject('Monime checkout wallet ownership could not be verified.');

  const primaryAccount = wallet.monime_account_id || null;
  const legacyAccount = wallet.metadata?.monime_account_id || null;
  if (primaryAccount && legacyAccount && primaryAccount !== legacyAccount) reject('MatMove wallet account references disagree; manual review is required.');
  const currentAccount = primaryAccount || legacyAccount;
  if (
    typeof currentAccount !== 'string' ||
    !/^fac-[A-Za-z0-9_-]{1,100}$/.test(currentAccount) ||
    session.financialAccountId !== currentAccount
  ) reject('The historical Monime checkout account no longer matches this wallet; manual review is required.');

  if (
    typeof payment.currency !== 'string' ||
    payment.currency !== wallet.currency ||
    !['SLE', 'USD'].includes(payment.currency)
  ) reject('Wallet top-up currency could not be verified.');

  const expectedMinor = toMinorUnits(payment.amount);
  const lines = session.lineItems?.data;
  if (!Number.isSafeInteger(expectedMinor) || !Array.isArray(lines) || lines.length !== 1) reject('Monime checkout amount details could not be verified.');
  const line = lines[0];
  if (
    line?.name !== 'Wallet Load' ||
    line?.quantity !== 1 ||
    !Number.isSafeInteger(line?.price?.value) ||
    line.price.value <= 0 ||
    line.price.currency !== payment.currency ||
    line.price.value !== expectedMinor
  ) reject('Monime checkout amount or currency does not match the stored MatMove request.');

  if (payment.metadata?.amount !== undefined && toMinorUnits(payment.metadata.amount) !== expectedMinor) reject('Stored MatMove top-up amount metadata does not match the payment record.');
  if (payment.metadata?.currency && payment.metadata.currency !== payment.currency) reject('Stored MatMove top-up currency metadata does not match the payment record.');

  const status = String(session.status || '').toLowerCase();
  if (!['pending', 'processing', 'completed', 'cancelled', 'expired'].includes(status)) reject('Monime checkout has an unsupported status; manual review is required.');
  return { status, amountMinor: expectedMinor, currency: payment.currency, accountId: currentAccount };
}

export async function reconcileWalletTopupCheckoutSession(db, session, { verifyAccount = verifiedAccount, now = () => new Date().toISOString() } = {}) {
  if (!session || typeof session.id !== 'string') reject('Monime checkout session identity is missing.');

  const { data: matches, error: paymentError } = await db.from('payment_transactions')
    .select('*').eq('provider', 'monime').eq('transaction_type', 'wallet_topup')
    .eq('provider_reference', session.id).limit(2);
  if (paymentError) throw new Error('Could not read the MatMove wallet top-up record.');
  if (!Array.isArray(matches) || matches.length !== 1) reject('Monime checkout does not identify exactly one MatMove wallet top-up.');

  const payment = matches[0];
  const { data: wallet, error: walletError } = await db.from('wallets')
    .select('id,user_id,currency,monime_account_id,metadata')
    .eq('id', payment.wallet_id).eq('user_id', payment.user_id).maybeSingle();
  if (walletError) throw new Error('Could not read the wallet linked to this top-up.');
  if (!wallet) reject('The wallet linked to this top-up no longer exists.');

  const checked = validateWalletTopupCheckoutSession(payment, wallet, session);
  let account;
  try { account = await verifyAccount(db, wallet); }
  catch (error) {
    if (error?.status === 409) reject('Monime wallet account ownership could not be verified; manual review is required.');
    throw error;
  }
  if (account?.id !== checked.accountId || account?.currency !== checked.currency) reject('Live Monime wallet account details do not match the checkout session.');

  if (checked.status === 'pending' || checked.status === 'processing') {
    if (payment.status !== 'pending') reject('Monime reports a non-final checkout while MatMove has a different payment state.');
    return 'pending';
  }

  if (checked.status === 'cancelled' || checked.status === 'expired') {
    const failureState = checked.status === 'cancelled' ? 'cancelled' : 'failed';
    if (payment.status === failureState) return 'processed';
    if (payment.status !== 'pending') reject('Monime checkout cancellation conflicts with the stored MatMove payment state.');

    const { data: existingLedger, error: ledgerError } = await db.from('ledger_transactions')
      .select('id').eq('payment_transaction_id', payment.id)
      .eq('transaction_type', 'wallet_topup').limit(1);
    if (ledgerError) throw new Error('Could not check existing wallet top-up settlement entries.');
    if (Array.isArray(existingLedger) && existingLedger.length > 0) reject('A wallet top-up ledger entry already exists for a checkout Monime reports as not paid.');

    const timestamp = now();
    const { data: updated, error: updateError } = await db.from('payment_transactions')
      .update({
        status: failureState,
        failure_code: checked.status === 'cancelled' ? 'MONIME_CHECKOUT_CANCELLED' : 'MONIME_CHECKOUT_EXPIRED',
        failure_message: checked.status === 'cancelled' ? 'Monime checkout was cancelled before payment.' : 'Monime checkout expired before payment.',
        failed_at: timestamp,
        updated_at: timestamp
      }).eq('id', payment.id).eq('status', 'pending').select('id,status').maybeSingle();
    if (updateError) throw new Error('Could not record the verified Monime checkout result.');
    if (updated?.id === payment.id && updated.status === failureState) return 'processed';

    const { data: latest, error: latestError } = await db.from('payment_transactions')
      .select('status').eq('id', payment.id).maybeSingle();
    if (latestError) throw new Error('Could not confirm the final MatMove payment state.');
    if (latest?.status === failureState) return 'processed';
    reject('The MatMove payment state changed while recording the Monime checkout result.');
  }

  if (checked.status !== 'completed') reject('Monime checkout has an unsupported status; manual review is required.');
  if (!['pending', 'completed'].includes(payment.status)) reject('A completed Monime checkout conflicts with the stored MatMove payment state.');

  const { data: settlement, error: settlementError } = await db.rpc('settle_wallet_topup', {
    p_payment_transaction_id: payment.id,
    p_provider_transaction_id: session.id,
    p_provider_response: {
      id: session.id, status: checked.status, financialAccountId: checked.accountId,
      currency: checked.currency, amountMinor: checked.amountMinor
    }
  });
  if (settlementError) throw new Error('Verified Monime top-up could not yet be settled in the MatMove ledger.');
  if (
    settlement?.success !== true ||
    settlement.payment_transaction_id !== payment.id ||
    settlement.wallet_id !== wallet.id ||
    typeof settlement.ledger_transaction_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settlement.ledger_transaction_id)
  ) reject('MatMove did not confirm the exact wallet top-up settlement.');

  const { data: finalPayment, error: finalError } = await db.from('payment_transactions')
    .select('status,wallet_id').eq('id', payment.id).maybeSingle();
  if (finalError) throw new Error('Could not confirm the final wallet top-up state.');
  if (finalPayment?.status !== 'completed' || finalPayment.wallet_id !== wallet.id) reject('The verified wallet top-up did not reach its completed MatMove state.');
  return 'processed';
}
