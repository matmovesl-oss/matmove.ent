import {
  createCipheriv, createDecipheriv, createHash, privateDecrypt,
  constants, randomBytes, randomUUID
} from 'node:crypto';
import { HttpError, dbClient, toMinorUnits, verifiedAccount } from './wallet-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[A-Za-z0-9_-]{24,64}$/;
const RECIPIENT_CODE = /^MM-[A-Z2-9]{8}$/;
const MAX_RECEIVE_MINOR = 100000000; // SLE 1,000,000 hard safety ceiling.

function publicName(profile) {
  const candidate = profile?.business_name?.trim()
    || profile?.first_name?.trim()
    || profile?.full_name?.trim()?.split(/\s+/)[0]
    || 'MatMove user';
  return candidate.replace(/[<>\r\n]/g, '').slice(0, 64) || 'MatMove user';
}

function phoneE164(profile) {
  const raw = String(profile?.phone || profile?.phone_number || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const normalized = digits.startsWith('232')
    ? `+${digits}`
    : digits.startsWith('0')
      ? `+232${digits.slice(1)}`
      : null;
  return normalized && /^\+232[0-9]{8,9}$/.test(normalized) ? normalized : null;
}

function safeOrigin() {
  let origin;
  try {
    const url = new URL(process.env.MATMOVE_PUBLIC_URL || 'https://matmove.space');
    if (url.protocol !== 'https:' || !['matmove.space', 'www.matmove.space'].includes(url.hostname)) throw new Error();
    origin = url.origin;
  } catch {
    throw new HttpError(503, 'MatMove public URL is not safely configured.');
  }
  return origin;
}

function makeRecipientCode() {
  // Excludes 0, 1 and ambiguous letters for easy keypad entry.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = 'MM-';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function makeSlug() {
  return randomBytes(24).toString('base64url');
}

async function loadOwnedLink(db, walletId) {
  const { data, error } = await db.from('matmove_receive_links')
    .select('*').eq('wallet_id', walletId).maybeSingle();
  if (error) throw new HttpError(503, 'Unable to load your MatMove payment link.');
  return data;
}

export async function manageReceiveLink(context, body, { verify = verifiedAccount } = {}) {
  const { db, user, profile, wallets } = context;
  if (body?.enabled !== undefined && typeof body.enabled !== 'boolean') {
    throw new HttpError(400, 'Choose whether your MatMove payment link is enabled.');
  }
  if (body?.smsReceiptsEnabled !== undefined && typeof body.smsReceiptsEnabled !== 'boolean') {
    throw new HttpError(400, 'Choose whether SMS payment receipts are enabled.');
  }

  const sleWallets = (wallets || []).filter(wallet => wallet.currency === 'SLE');
  if (sleWallets.length !== 1) throw new HttpError(409, 'A single SLE wallet must be active before receiving payments.');
  const wallet = sleWallets[0];
  if (wallet.is_frozen === true || profile?.is_wallet_frozen === true) {
    throw new HttpError(423, 'Your wallet is frozen. Receiving payments is temporarily disabled.');
  }

  const existing = await loadOwnedLink(db, wallet.id);
  if (body?.operation === 'status') {
    const featureEnabled = process.env.MATMOVE_RECEIVE_MONEY_ENABLED === 'true';
    return featureEnabled && existing?.enabled ? {
      featureEnabled: true,
      enabled: true,
      publicName: existing.public_name,
      publicUrl: `${safeOrigin()}/pay/${existing.public_slug}`,
      recipientCode: existing.recipient_code,
      smsReceiptsEnabled: existing.sms_receipts_enabled
    } : { featureEnabled, enabled: false, publicUrl: null, recipientCode: null, smsReceiptsEnabled: false };
  }
  if (body?.enabled !== false && process.env.MATMOVE_RECEIVE_MONEY_ENABLED !== 'true') {
    throw new HttpError(503, 'MatMove secure receiving payments are not activated yet. Please check again after provider verification.');
  }
  const enable = body?.enabled !== false;
  const smsEnabled = body?.smsReceiptsEnabled ?? existing?.sms_receipts_enabled ?? false;
  if (smsEnabled && !phoneE164(profile)) {
    throw new HttpError(400, 'Add a valid Sierra Leone mobile number to your MatMove profile before enabling SMS receipts.');
  }

  if (!enable) {
    if (!existing) return { enabled: false, publicUrl: null, recipientCode: null, smsReceiptsEnabled: false };
    const { error } = await db.from('matmove_receive_links').update({
      enabled: false,
      sms_receipts_enabled: false,
      updated_at: new Date().toISOString()
    }).eq('id', existing.id).eq('user_id', user.id);
    if (error) throw new HttpError(503, 'Could not disable your MatMove payment link.');
    return { enabled: false, publicUrl: null, recipientCode: existing.recipient_code, smsReceiptsEnabled: false };
  }

  const account = await verify(db, wallet);
  const accountId = account?.id;
  const uvan = typeof account?.uvan === 'string' ? account.uvan.trim() : '';
  if (!/^fac-[A-Za-z0-9_-]+$/.test(String(accountId)) || account.currency !== 'SLE') {
    throw new HttpError(409, 'Your SLE Monime account is not ready to receive payments.');
  }
  if (!/^\d{6,20}$/.test(uvan)) {
    throw new HttpError(409, 'Your SLE receiving number is not yet available from Monime. Refresh your wallet or contact support.');
  }

  let link = existing;
  if (existing && (
    existing.user_id !== user.id ||
    existing.financial_account_id !== accountId ||
    existing.payment_target_ref !== uvan
  )) {
    throw new HttpError(409, 'Your saved MatMove payment link no longer matches the verified Monime account. Contact support before changing it.');
  }

  if (!link) {
    let created = null;
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      const row = {
        user_id: user.id,
        wallet_id: wallet.id,
        financial_account_id: accountId,
        payment_target_ref: uvan,
        public_slug: makeSlug(),
        recipient_code: makeRecipientCode(),
        public_name: publicName(profile),
        enabled: true,
        sms_receipts_enabled: smsEnabled
      };
      const { data, error } = await db.from('matmove_receive_links').insert(row).select('*').single();
      if (!error) created = data;
      else if (error.code !== '23505') throw new HttpError(503, 'Could not create your MatMove payment link.');
    }
    if (!created) throw new HttpError(503, 'Could not reserve a unique MatMove payment code. Please retry.');
    link = created;
  } else {
    const { data, error } = await db.from('matmove_receive_links').update({
      enabled: true,
      sms_receipts_enabled: smsEnabled,
      public_name: publicName(profile),
      updated_at: new Date().toISOString()
    }).eq('id', existing.id).eq('user_id', user.id).select('*').single();
    if (error || !data) throw new HttpError(503, 'Could not update your MatMove payment link.');
    link = data;
  }

  return {
    featureEnabled: true,
    enabled: true,
    publicName: link.public_name,
    publicUrl: `${safeOrigin()}/pay/${link.public_slug}`,
    recipientCode: link.recipient_code,
    smsReceiptsEnabled: link.sms_receipts_enabled
  };
}

export async function getPublicReceiveLink(db, slug) {
  if (process.env.MATMOVE_RECEIVE_MONEY_ENABLED !== 'true') return null;
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  const { data, error } = await db.from('matmove_receive_links')
    .select('id,public_name,recipient_code,enabled')
    .eq('public_slug', slug).eq('enabled', true).maybeSingle();
  if (error) throw new HttpError(503, 'Payment link lookup is temporarily unavailable.');
  if (!data?.enabled) return null;
  return {
    id: data.id,
    publicName: data.public_name,
    recipientCode: data.recipient_code,
    currency: 'SLE'
  };
}

function paymentReference(id) {
  return `MM-${String(id).replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

async function getOrCreatePayment(db, { link, amountMinor, channel, idempotencyKey }) {
  const { data: prior, error: priorError } = await db.from('matmove_received_payments')
    .select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (priorError) throw new HttpError(503, 'Could not verify an existing payment request.');
  if (prior) {
    if (prior.link_id !== link.id || Number(prior.amount_minor) !== amountMinor || prior.provider_channel !== channel) {
      throw new HttpError(409, 'This payment request key was already used for a different payment.');
    }
    return prior;
  }

  const id = randomUUID();
  const row = {
    id,
    link_id: link.id,
    owner_user_id: link.user_id,
    wallet_id: link.wallet_id,
    provider_account_id: link.financial_account_id,
    provider_channel: channel,
    reference: paymentReference(id),
    idempotency_key: idempotencyKey,
    amount_minor: amountMinor,
    currency: 'SLE',
    state: 'created'
  };
  const { data, error } = await db.from('matmove_received_payments').insert(row).select('*').single();
  if (error) {
    // Resolve an uncertain insert by its stable idempotency key.
    const { data: recovered, error: lookupError } = await db.from('matmove_received_payments')
      .select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (!lookupError && recovered && recovered.link_id === link.id &&
        Number(recovered.amount_minor) === amountMinor && recovered.provider_channel === channel) return recovered;
    throw new HttpError(503, 'The payment request could not be safely recorded. Do not retry with a new reference.');
  }
  return data;
}

export async function createReceiveCheckout(req, res, { db = dbClient(), provider, verify = verifiedAccount } = {}) {
  if (process.env.MATMOVE_RECEIVE_MONEY_ENABLED !== 'true') throw new HttpError(503, 'MatMove receive payments are being activated. Please try again later.');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const origin = safeOrigin();
  const slug = req.body?.slug;
  const requestKey = req.body?.idempotencyKey;
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new HttpError(404, 'This MatMove payment link is unavailable.');
  if (typeof requestKey !== 'string' || !UUID.test(requestKey)) throw new HttpError(400, 'A valid payment request key is required.');

  let amountMinor;
  try { amountMinor = toMinorUnits(req.body?.amount); }
  catch (error) { throw error; }
  if (amountMinor < 100 || amountMinor > MAX_RECEIVE_MINOR) {
    throw new HttpError(400, 'Enter an amount between SLE 1 and SLE 1,000,000.');
  }

  const { data: link, error: linkError } = await db.from('matmove_receive_links')
    .select('*').eq('public_slug', slug).eq('enabled', true).maybeSingle();
  if (linkError) throw new HttpError(503, 'Payment link lookup is temporarily unavailable.');
  if (!link) throw new HttpError(404, 'This MatMove payment link is unavailable.');

  const { data: wallet, error: walletError } = await db.from('wallets')
    .select('id,user_id,currency,is_frozen,monime_account_id,metadata')
    .eq('id', link.wallet_id).eq('user_id', link.user_id).single();
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('is_wallet_frozen').eq('id', link.user_id).single();
  if (walletError || !wallet || wallet.currency !== 'SLE' || wallet.is_frozen === true ||
      profileError || profile?.is_wallet_frozen === true) {
    throw new HttpError(409, 'The recipient wallet is not available to receive payment.');
  }
  if ((wallet.monime_account_id || wallet.metadata?.monime_account_id) !== link.financial_account_id) {
    throw new HttpError(409, 'The recipient wallet account requires verification before receiving payment.');
  }
  const providerAccount = await verify(db, wallet);
  if (providerAccount?.id !== link.financial_account_id ||
      providerAccount?.currency !== 'SLE' ||
      String(providerAccount?.uvan || '').trim() !== link.payment_target_ref) {
    throw new HttpError(409, 'The recipient Monime account needs verification before receiving payment.');
  }

  const row = await getOrCreatePayment(db, {
    link,
    amountMinor,
    channel: 'checkout',
    idempotencyKey: `checkout:${requestKey}`
  });
  if (row.state === 'completed') {
    return res.status(200).json({ completed: true, reference: row.reference });
  }

  const send = provider || (async (path, options) => {
    const token = process.env.MONIME_API_KEY;
    const space = process.env.MONIME_SPACE_ID;
    if (!token || !space) throw new HttpError(503, 'Monime checkout is not configured.');
    const response = await fetch(`https://api.monime.io/v1/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Monime-Space-Id': space,
        'Monime-Version': 'caph.2025-08-23',
        'Content-Type': 'application/json',
        ...options?.headers
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.result) throw new HttpError(502, 'Monime could not start this payment. Check the same payment request before trying again.');
    return body.result;
  });

  const session = await send('checkout-sessions', {
    method: 'POST',
    headers: { 'Idempotency-Key': createHash('sha256').update(row.idempotency_key).digest('hex') },
    body: JSON.stringify({
      name: `MatMove payment to ${link.public_name}`,
      description: 'Secure MatMove receive-money payment',
      financialAccountId: link.financial_account_id,
      reference: row.reference,
      successUrl: `${origin}/pay/complete?ref=${encodeURIComponent(row.reference)}`,
      cancelUrl: `${origin}/pay/${encodeURIComponent(slug)}?cancelled=1`,
      lineItems: [{
        type: 'custom',
        name: `Payment to ${link.public_name}`,
        quantity: 1,
        price: { currency: 'SLE', value: amountMinor },
        reference: row.reference
      }],
      paymentOptions: { momo: { enabledProviders: ['m17', 'm18'] } },
      brandingOptions: { primaryColor: '#109B71' },
      metadata: {
        mmReceivePayId: row.id,
        mmReceiveLinkId: link.id,
        purpose: 'matmove_receive'
      }
    })
  });

  const redirectUrl = session?.redirectUrl;
  let safeRedirect = false;
  try {
    const target = new URL(redirectUrl);
    safeRedirect = target.protocol === 'https:' &&
      (target.hostname === 'monime.io' || target.hostname.endsWith('.monime.io'));
  } catch { /* invalid URL */ }

  const lines = Array.isArray(session?.lineItems?.data) ? session.lineItems.data : [];
  const observedTotal = lines.reduce((sum, item) => {
    const quantity = Number(item.quantity || 1);
    const value = item.price?.value;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(quantity) || quantity < 1) return NaN;
    return sum + value * quantity;
  }, 0);
  if (!safeRedirect || typeof session.id !== 'string' ||
      session.financialAccountId !== link.financial_account_id ||
      session.reference !== row.reference || observedTotal !== amountMinor ||
      lines.some(item => item.price?.currency !== 'SLE')) {
    await db.from('matmove_received_payments').update({
      state: 'review_required',
      provider_status: 'provider_response_mismatch',
      updated_at: new Date().toISOString()
    }).eq('id', row.id);
    throw new HttpError(502, 'The provider response did not match this MatMove payment request. Contact support before trying again.');
  }

  const { error: updateError } = await db.from('matmove_received_payments').update({
    provider_object_id: session.id,
    state: 'processing',
    provider_status: String(session.status || 'pending').slice(0, 40),
    updated_at: new Date().toISOString()
  }).eq('id', row.id).neq('state', 'completed');
  if (updateError) throw new HttpError(503, 'Payment was created, but MatMove could not save its provider reference. Do not create another payment; contact support.');
  return res.status(200).json({ link: redirectUrl, reference: row.reference, state: 'processing' });
}

function decodeBase64Field(value) {
  if (typeof value !== 'string' || value.length > 12000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid encrypted exchange field.');
  }
  return Buffer.from(value, 'base64');
}

export function decryptUssdExchange(body, privateKey) {
  if (!body || typeof body !== 'object' || typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('USSD encryption is not configured.');
  }
  const encryptedKey = decodeBase64Field(body.encryptedAesKey);
  const encryptedData = decodeBase64Field(body.encryptedExchangeData);
  const aesKey = privateDecrypt({
    key: privateKey.replace(/\\n/g, '\n'),
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, encryptedKey);
  if (aesKey.length !== 16 || encryptedData.length < 29 || encryptedData[0] !== 12) {
    throw new Error('Invalid encrypted USSD exchange payload.');
  }
  const iv = encryptedData.subarray(1, 13);
  const tag = encryptedData.subarray(encryptedData.length - 16);
  const ciphertext = encryptedData.subarray(13, encryptedData.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', aesKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return { data: JSON.parse(decoded), aesKey };
}

export function encryptUssdExchange(responseObject, aesKey) {
  if (!Buffer.isBuffer(aesKey) || aesKey.length !== 16) throw new Error('Invalid USSD response key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(responseObject), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.alloc(1 + iv.length + ciphertext.length + tag.length);
  blob.writeUInt8(iv.length, 0);
  iv.copy(blob, 1);
  ciphertext.copy(blob, 13);
  tag.copy(blob, 13 + ciphertext.length);
  return blob.toString('base64');
}

function stop(message) {
  return { action: 'stop', message: String(message).slice(0, 120) };
}

async function linkForUssdCode(db, code, { verify = false, verifyAccount = verifiedAccount } = {}) {
  if (typeof code !== 'string' || !RECIPIENT_CODE.test(code.trim().toUpperCase())) return null;
  const { data, error } = await db.from('matmove_receive_links')
    .select('id,user_id,wallet_id,financial_account_id,payment_target_ref,recipient_code,public_name,enabled,sms_receipts_enabled')
    .eq('recipient_code', code.trim().toUpperCase()).eq('enabled', true).maybeSingle();
  if (error) throw new Error('Recipient lookup failed.');
  if (!data) return null;
  const { data: wallet, error: walletError } = await db.from('wallets')
    .select('id,user_id,currency,is_frozen,monime_account_id,metadata')
    .eq('id', data.wallet_id).eq('user_id', data.user_id).single();
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('is_wallet_frozen').eq('id', data.user_id).single();
  if (walletError || !wallet || wallet.currency !== 'SLE' || wallet.is_frozen === true ||
      profileError || profile?.is_wallet_frozen === true ||
      (wallet.monime_account_id || wallet.metadata?.monime_account_id) !== data.financial_account_id) return null;
  if (verify) {
    const account = await verifyAccount(db, wallet);
    if (account?.id !== data.financial_account_id ||
        account?.currency !== 'SLE' ||
        String(account?.uvan || '').trim() !== data.payment_target_ref) return null;
  }
  return data;
}

async function createUssdIntent(db, link, sessionId, amountText) {
  const amount = Number(amountText);
  if (!/^\\d{1,7}$/.test(String(amountText)) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) {
    throw new Error('Enter an amount between SLE 1 and SLE 1,000,000.');
  }
  const amountMinor = amount * 100;
  const row = await getOrCreatePayment(db, {
    link,
    amountMinor,
    channel: 'ussd',
    idempotencyKey: `ussd:${sessionId}`
  });
  if (row.state === 'completed' || row.provider_channel !== 'ussd') {
    throw new Error('This USSD session has already been used. Start a new payment session.');
  }
  if (row.state === 'review_required') {
    throw new Error('This payment request needs support review. Please start a new session later.');
  }

  const { error } = await db.from('matmove_received_payments').update({
    state: 'processing',
    provider_status: 'awaiting_payer_authorization',
    updated_at: new Date().toISOString()
  }).eq('id', row.id).neq('state', 'completed');
  if (error) throw new Error('MatMove could not securely record this payment request.');
  return { ...row, state: 'processing', provider_status: 'awaiting_payer_authorization' };
}

export async function resolveUssdExchange(payload, { db = dbClient(), verify = verifiedAccount, enabled = process.env.MATMOVE_RECEIVE_MONEY_ENABLED === 'true' && process.env.MATMOVE_RECEIVE_USSD_ENABLED === 'true' } = {}) {
  if (!enabled) return stop('MatMove USSD payments are not enabled yet. Please use the MatMove payment link.');
  const sessionId = payload?.global?.sessionId;
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return stop('This USSD session could not be verified. Please dial again.');
  const flowData = payload?.flowData && typeof payload.flowData === 'object' ? payload.flowData : {};
  const page = payload?.currentPage;

  try {
    if (page === 'enter_recipient') {
      const code = String(flowData.enter_recipient || '').trim().toUpperCase();
      const link = await linkForUssdCode(db, code);
      if (!link) return stop('MatMove recipient not found. Check the code and try again.');
      return { action: 'navigate', pageId: 'enter_amount', pageData: { recipientName: link.public_name, recipientCode: link.recipient_code } };
    }

    if (page === 'enter_amount') {
      const code = String(flowData.enter_recipient || '').trim().toUpperCase();
      const link = await linkForUssdCode(db, code);
      if (!link) return stop('This MatMove recipient is no longer available.');
      const amount = String(flowData.enter_amount || '').trim();
      if (!/^\d{1,7}$/.test(amount) || Number(amount) < 1 || Number(amount) > 1000000) {
        return stop('Enter a whole SLE amount from 1 to 1,000,000.');
      }
      return {
        action: 'navigate',
        pageId: 'confirm_payment',
        pageData: { recipientName: link.public_name, recipientCode: link.recipient_code, amount }
      };
    }

    if (page === 'confirm_payment') {
      const confirmed = String(flowData.confirm_payment || '').toLowerCase();
      if (confirmed !== 'true' && confirmed !== 'yes') return stop('Payment cancelled.');
      const code = String(flowData.enter_recipient || '').trim().toUpperCase();
      const link = await linkForUssdCode(db, code, { verify: true, verifyAccount: verify });
      if (!link) return stop('This MatMove recipient is no longer available.');
      const amount = String(flowData.enter_amount || '').trim();
      const row = await createUssdIntent(db, link, sessionId, amount);
      return {
        action: 'navigate',
        pageId: 'collect_payment',
        pageData: {
          recipientName: link.public_name,
          amount: Number(row.amount_minor) / 100,
          paymentTargetRef: link.payment_target_ref,
          reference: row.reference,
          receivePaymentId: row.id,
          receiveLinkId: link.id
        }
      };
    }
    return stop('MatMove could not continue this payment. Please start again.');
  } catch (error) {
    console.error('MatMove USSD exchange failed', { page, reason: error?.message || 'exchange_error' });
    return stop('MatMove is temporarily unable to check this payment. Please try again.');
  }
}

export async function handleReceiveUssdExchange(req, res, {
  db = dbClient(),
  privateKey = process.env.MONIME_RSA_PRIVATE_KEY,
  enabled = process.env.MATMOVE_RECEIVE_MONEY_ENABLED === 'true' && process.env.MATMOVE_RECEIVE_USSD_ENABLED === 'true'
} = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  let payload;
  let aesKey = null;
  const isSimulation = String(req.headers?.['is-simulation'] || '').toLowerCase() === 'true';
  try {
    if (isSimulation && process.env.VERCEL_ENV !== 'production') {
      payload = req.body;
    } else {
      const encrypted = decryptUssdExchange(req.body, privateKey);
      payload = encrypted.data;
      aesKey = encrypted.aesKey;
    }
    const result = await resolveUssdExchange(payload, { db, enabled });
    if (isSimulation && process.env.VERCEL_ENV !== 'production') return res.status(200).json(result);
    res.setHeader?.('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(encryptUssdExchange(result, aesKey));
  } catch (error) {
    console.error('MatMove USSD exchange unavailable', { reason: error?.message || 'exchange_error' });
    if (aesKey) {
      res.setHeader?.('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(encryptUssdExchange(stop('MatMove is temporarily unavailable. Please try again.'), aesKey));
    }
    if (isSimulation && process.env.VERCEL_ENV !== 'production') return res.status(200).json(stop('MatMove is temporarily unavailable. Please try again.'));
    return res.status(503).json({ error: 'USSD exchange is not configured.' });
  }
}

function metadataFor(object) {
  const candidates = [object?.metadata, object?.ownershipGraph?.owner?.metadata, object?.ownershipGraph?.owner?.owner?.metadata];
  return candidates.find(value => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function totalCheckoutMinor(session) {
  const lines = session?.lineItems?.data;
  if (!Array.isArray(lines) || !lines.length) return null;
  let total = 0;
  for (const item of lines) {
    const quantity = Number(item.quantity || 1);
    const value = item.price?.value;
    if (item.price?.currency !== 'SLE' || !Number.isSafeInteger(value) ||
        !Number.isSafeInteger(quantity) || quantity < 1) return null;
    total += value * quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function normalizeRecipientPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized = digits.startsWith('232') ? digits : digits.startsWith('0') ? `232${digits.slice(1)}` : '';
  return /^232[0-9]{8,9}$/.test(normalized) ? normalized : null;
}

async function queueRecipientSms(db, payment) {
  const { data: link, error: linkError } = await db.from('matmove_receive_links')
    .select('user_id,public_name,sms_receipts_enabled').eq('id', payment.link_id).maybeSingle();
  if (linkError) throw new Error('Could not verify SMS receipt preference.');
  if (!link?.sms_receipts_enabled) return;
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('phone,phone_number').eq('id', payment.owner_user_id).single();
  if (profileError) throw new Error('Could not read the SMS receipt destination.');
  const phone = normalizeRecipientPhone(profile.phone || profile.phone_number);
  if (!phone) return;
  const amount = (Number(payment.amount_minor) / 100).toFixed(2);
  const message = `MatMove: You received SLE ${amount}. Ref ${payment.reference}. Check your MatMove wallet for details.`;
  const { error } = await db.from('matmove_receive_sms_outbox').insert({
    payment_id: payment.id,
    recipient_user_id: payment.owner_user_id,
    phone_e164: `+${phone}`,
    message
  });
  if (error && error.code !== '23505') throw new Error('Could not queue the recipient SMS receipt.');
}

export async function reconcileReceivePaymentEvent(db, event, providerObject) {
  const objectId = event?.object_id || event?.payload?.object?.id;
  if (!objectId || providerObject?.id !== objectId) throw new Error('Provider payment identity did not match the webhook.');
  const metadata = metadataFor(providerObject);
  const paymentId = metadata.mmReceivePayId;
  if (typeof paymentId !== 'string' || !UUID.test(paymentId)) {
    throw new Error('Provider receive-payment metadata is missing.');
  }
  const { data: payment, error } = await db.from('matmove_received_payments')
    .select('*').eq('id', paymentId).maybeSingle();
  if (error || !payment) throw new Error('MatMove receive-payment request was not found.');
  if (payment.provider_channel === 'checkout' && event.object_type !== 'checkout_session') {
    throw new Error('Provider object type did not match the receive-payment channel.');
  }
  if (payment.provider_channel === 'ussd' && event.object_type !== 'payment') {
    throw new Error('Provider object type did not match the receive-payment channel.');
  }

  const amountMinor = event.object_type === 'checkout_session'
    ? totalCheckoutMinor(providerObject)
    : providerObject?.amount?.currency === 'SLE' && Number.isSafeInteger(providerObject.amount?.value)
      ? providerObject.amount.value
      : null;
  const reference = providerObject.reference;
  const status = String(providerObject.status || '').toLowerCase();
  const lifecycle = event?.event_type || event?.payload?.event?.name;
  const expectedStatus = lifecycle === 'checkout_session.cancelled' || lifecycle === 'payment_code.cancelled'
    ? 'cancelled'
    : lifecycle === 'checkout_session.expired' || lifecycle === 'payment_code.expired'
      ? 'expired'
      : 'completed';
  const status = String(providerObject.status || '').toLowerCase();
  const reference = providerObject.reference;
  const valid = status === expectedStatus &&
    providerObject.financialAccountId === payment.provider_account_id &&
    amountMinor === Number(payment.amount_minor) &&
    reference === payment.reference &&
    providerObject.amount?.currency !== 'USD' &&
    (providerObject.currency == null || providerObject.currency === 'SLE');
  if (!valid) {
    throw new Error('Provider payment did not match the expected MatMove recipient, amount, currency, reference and final status.');
  }

  if (payment.state === 'completed') {
    if (payment.provider_object_id && payment.provider_object_id !== objectId) {
      throw new Error('A second provider payment object references an already completed MatMove request.');
    }
    // A previous webhook may have recorded the payment but failed before
    // inserting its SMS outbox row. The unique payment_id makes this retry safe.
    await queueRecipientSms(db, payment);
    return 'processed';
  }
  if (payment.state === 'review_required') throw new Error('MatMove payment is already under review.');
  if (expectedStatus !== 'completed') {
    const { error: updateError } = await db.from('matmove_received_payments').update({
      provider_object_id: objectId,
      state: expectedStatus,
      provider_status: expectedStatus,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id).neq('state', 'completed');
    if (updateError) throw new Error('Could not record the final cancelled or expired payment request.');
    return 'processed';
  }
  const { data: updated, error: updateError } = await db.from('matmove_received_payments')
    .update({
      provider_object_id: objectId,
      state: 'completed',
      provider_status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', payment.id).neq('state', 'completed')
    .select('*').single();
  if (updateError || !updated) {
    const { data: check } = await db.from('matmove_received_payments').select('state,provider_object_id').eq('id', payment.id).maybeSingle();
    if (check?.state === 'completed' && check.provider_object_id === objectId) return 'processed';
    throw new Error('Could not record the confirmed MatMove incoming payment.');
  }
  await queueRecipientSms(db, updated);
  return 'processed';
}

export async function processReceiveSmsOutbox({ db = dbClient(), limit = 5 } = {}) {
  const clientId = process.env.APPHIVE_SMS_CLIENT_ID;
  const clientSecret = process.env.APPHIVE_SMS_CLIENT_SECRET;
  const walletToken = process.env.APPHIVE_SMS_WALLET_TOKEN;
  const sender = process.env.APPHIVE_SMS_SENDER_ID;
  if (!clientId || !clientSecret || !walletToken || !sender) {
    return { checked: 0, sent: 0, skipped: 0, failed: 0, configured: false };
  }
  const { data: rows, error } = await db.from('matmove_receive_sms_outbox')
    .select('id,phone_e164,message,payment_id,status,attempts')
    .eq('status', 'pending').order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(20, limit)));
  if (error) throw new Error('Could not read MatMove SMS outbox.');
  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows || []) {
    const { data: claimed, error: claimError } = await db.from('matmove_receive_sms_outbox')
      .update({ status: 'processing', attempts: Number(row.attempts || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimError) throw new Error('Could not claim a MatMove SMS receipt.');
    if (!claimed) { skipped++; continue; }

    try {
      const response = await fetch('https://api.apphivesl.com/v1/messages/sms', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'X-Wallet': `Token ${walletToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          From: sender,
          To: row.phone_e164.replace(/^\+/, ''),
          Content: row.message,
          Reference: `MM-RX-${String(row.payment_id).replace(/-/g, '').slice(0, 20)}`
        }),
        signal: AbortSignal.timeout(12000)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.Id !== 'string' || !body.Id) {
        await db.from('matmove_receive_sms_outbox').update({
          status: 'review_required',
          last_error: `Apphive SMS request could not be confirmed (HTTP ${response.status}).`,
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('status', 'processing');
        failed++;
        continue;
      }
      const { error: saveError } = await db.from('matmove_receive_sms_outbox').update({
        status: 'sent',
        provider_message_id: body.Id,
        last_error: null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', row.id).eq('status', 'processing');
      if (saveError) throw new Error('Provider accepted SMS but MatMove could not record its receipt. Do not resend automatically.');
      sent++;
    } catch (error) {
      // A timeout can occur after Apphive accepted the SMS. Do not resend blindly.
      await db.from('matmove_receive_sms_outbox').update({
        status: 'review_required',
        last_error: 'SMS send outcome is uncertain; review provider delivery status before retrying.',
        updated_at: new Date().toISOString()
      }).eq('id', row.id).eq('status', 'processing');
      failed++;
    }
  }
  return { checked: (rows || []).length, sent, skipped, failed, configured: true };
}
