import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toMinorUnits(value) {
  const text = String(value ?? '');

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new HttpError(
      400,
      'Enter a positive amount with at most two decimal places.'
    );
  }

  const [whole, fraction = ''] = text.split('.');
  const minor =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, '0'));

  if (minor <= 0n || minor > 1000000000000n) {
    throw new HttpError(400, 'Amount is outside the supported range.');
  }

  return Number(minor);
}

export function keyFor(userId, action, key) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(key)
    )
  ) {
    throw new HttpError(400, 'A valid request key is required.');
  }

  return createHash('sha256')
    .update(`${userId}:${action}:${key}`)
    .digest('hex')
    .slice(0, 64);
}

export function assertAllowed(profile, wallets, action) {
  if (!['rider', 'driver', 'merchant'].includes(profile.role)) {
    throw new HttpError(403, 'Customer account required.');
  }

  if (action === 'read') return;

  if (
    profile.is_wallet_frozen ||
    wallets.some(wallet => wallet.is_frozen)
  ) {
    throw new HttpError(
      423,
      'Your wallet is frozen. Contact MatMove support.',
      'WALLET_FROZEN'
    );
  }

  if (
    ['load', 'payout', 'transfer'].includes(action) &&
    ['driver', 'merchant'].includes(profile.role) &&
    profile.kyc_status !== 'approved'
  ) {
    throw new HttpError(
      403,
      'Your account needs administrator approval before using wallet payments.'
    );
  }
}

export function dbClient() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new HttpError(
      503,
      'Server payment configuration is incomplete.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function monime(path, options = {}) {
  if (
    !process.env.MONIME_API_KEY ||
    !process.env.MONIME_SPACE_ID
  ) {
    throw new HttpError(
      503,
      'Wallet provider configuration is incomplete.'
    );
  }

  const response = await fetch(
    `https://api.monime.io/v1/${path}`,
    {
      ...options,
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Monime-Version': 'caph.2025-08-23',
        'Content-Type': 'application/json',
        ...options.headers
      }
    }
  );

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.result) {
    const errorMsg =
      body?.error?.message ||
      body?.message ||
      (Array.isArray(body?.messages) && body.messages[0]) ||
      (typeof body?.error === 'string' ? body.error : null) ||
      'The wallet provider could not complete this request.';

    console.error(`Monime API Error (${response.status} on /v1/${path}):`, body);

    throw new HttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      errorMsg
    );
  }

  return body.result;
}

export async function verifiedAccount(db, wallet) {
  const direct = wallet?.monime_account_id;
  const legacy = wallet?.metadata?.monime_account_id;

  if (direct && legacy && direct !== legacy) {
    throw new HttpError(
      409,
      'Wallet account links disagree. Contact MatMove support.'
    );
  }

  const id = direct || legacy;

  if (!/^fac-[A-Za-z0-9_-]+$/.test(String(id))) {
    throw new HttpError(409, 'Wallet setup is pending.');
  }

  const linked = await db
    .from('wallets')
    .select('id')
    .or(
      `monime_account_id.eq.${id},` +
      `metadata->>monime_account_id.eq.${id}`
    );

  if (linked.error) {
    throw new HttpError(503, 'Unable to verify wallet ownership.');
  }

  if (
    linked.data?.length !== 1 ||
    linked.data[0].id !== wallet.id
  ) {
    throw new HttpError(
      409,
      'This account is linked to multiple wallets. Contact MatMove support.'
    );
  }

  const account = await monime(
    `financial-accounts/${encodeURIComponent(id)}?withBalance=true`
  );

  if (
    account.id !== id ||
    account.currency !== wallet.currency
  ) {
    throw new HttpError(
      409,
      'Wallet currency does not match the provider account.'
    );
  }

  return account;
}

export async function authorize(
  req,
  action,
  { db = dbClient() } = {}
) {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'Method not allowed.');
  }

  const authorization = String(
    req.headers.authorization || ''
  );

  if (!authorization.startsWith('Bearer ')) {
    throw new HttpError(
      401,
      'Sign in before using your wallet.'
    );
  }

  const token = authorization.slice(7);
  const auth = await db.auth.getUser(token);

  if (auth.error || !auth.data?.user) {
    throw new HttpError(
      401,
      'Your session expired. Sign in again.'
    );
  }

  const user = auth.data.user;

  if (req.body?.userId && req.body.userId !== user.id) {
    throw new HttpError(
      403,
      'This request does not belong to your account.'
    );
  }

  const [profileResult, walletResult] = await Promise.all([
    db
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single(),
    db
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
  ]);

  if (profileResult.error || walletResult.error) {
    throw new HttpError(
      503,
      'Unable to verify your wallet permissions.'
    );
  }

  assertAllowed(
    profileResult.data,
    walletResult.data || [],
    action
  );

  req.body = {
    ...req.body,
    userId: user.id,
    role: profileResult.data.role
  };

  const context = {
    db,
    user,
    profile: profileResult.data,
    wallets: walletResult.data || []
  };

  if (['load', 'payout', 'transfer'].includes(action)) {
    context.minor = toMinorUnits(req.body.amount);

    const currency = String(
      req.body.currency || 'SLE'
    ).toUpperCase();

    if (!['SLE', 'USD'].includes(currency)) {
      throw new HttpError(400, 'Choose SLE or USD.');
    }

    if (action !== 'transfer' && currency !== 'SLE') {
      throw new HttpError(
        400,
        'This payment method currently supports SLE only.'
      );
    }

    context.currency = currency;

    const wallet = context.wallets.find(
      item => item.currency === currency
    );

    context.account = await verifiedAccount(db, wallet);
    context.accountId = context.account.id;
    context.idempotencyKey = keyFor(
      user.id,
      action,
      req.body.idempotencyKey
    );
  }

  req.matmove = context;

  return context;
}

export function protectedWallet(action, handler) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    try {
      await authorize(req, action);
      return await handler(req, res);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : 'Unable to complete the wallet request.',
        code: error.code
      });
    }
  };
}