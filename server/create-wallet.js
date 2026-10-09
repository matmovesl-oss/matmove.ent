import {
  monime,
  verifiedAccount,
  HttpError,
} from './wallet-security.js';

export async function createWallet(req, res, currency) {
  const { db, user, wallets } = req.matmove;

  const existing = wallets.find(
    wallet => wallet.currency === currency
  );

  if (
    existing?.monime_account_id ||
    existing?.metadata?.monime_account_id
  ) {
    const account =
      await verifiedAccount(db, existing);

    return res.status(200).json({
      wallet: {
        ...existing,
        monime_account_id: account.id,
      },
    });
  }

  const reference =
    currency === 'USD'
      ? `usd_${user.id}`
      : user.id;

  let found = null;
  let after = null;

  const deadline = Date.now() + 20000;
  const cursors = new Set();

  for (let page = 0; page < 100; page++) {
    if (Date.now() >= deadline) {
      throw new HttpError(
        503,
        'Wallet setup check timed out. Retry this request.'
      );
    }

    const response = await fetch(
      `https://api.monime.io/v1/financial-accounts?limit=50${
        after
          ? `&after=${encodeURIComponent(after)}`
          : ''
      }`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.MONIME_API_KEY}`,
          'Monime-Space-Id':
            process.env.MONIME_SPACE_ID,
          'Monime-Version': 'caph.2025-08-23',
        },
        signal: AbortSignal.timeout(
          Math.max(1, deadline - Date.now())
        ),
      }
    );

    const body = await response.json();

    if (
      !response.ok ||
      !Array.isArray(body.result)
    ) {
      throw new HttpError(
        502,
        'Unable to verify existing wallet setup.'
      );
    }

    const matches = body.result.filter(
      account => account.reference === reference
    );

    if (matches.length > 1) {
      throw new HttpError(
        409,
        'Wallet reference is duplicated. Contact support.'
      );
    }

    if (matches.length) {
      if (
        found &&
        found.id !== matches[0].id
      ) {
        throw new HttpError(
          409,
          'Wallet reference is duplicated. Contact support.'
        );
      }

      found = matches[0];
    }

    const next = body.pagination?.next;

    if (!next) break;

    if (
      cursors.has(next) ||
      page === 99
    ) {
      throw new HttpError(
        503,
        'Unable to finish checking existing accounts.'
      );
    }

    cursors.add(next);
    after = next;
  }

  const account =
    found ||
    await monime('financial-accounts', {
      method: 'POST',
      headers: {
        'Idempotency-Key':
          `wallet-${user.id}-${currency}`,
      },
      body: JSON.stringify({
        name: `MatMove ${currency} Wallet`,
        currency,
        reference,
      }),
    });

  if (
    !account.id ||
    account.currency !== currency
  ) {
    throw new HttpError(
      409,
      'Provider returned the wrong wallet currency.'
    );
  }

  const conflict = await db
    .from('wallets')
    .select('id,user_id,currency')
    .or(
      `monime_account_id.eq.${account.id},metadata->>monime_account_id.eq.${account.id}`
    );

  if (
    conflict.error ||
    conflict.data?.some(
      wallet =>
        wallet.user_id !== user.id ||
        wallet.currency !== currency
    )
  ) {
    throw new HttpError(
      409,
      'Provider account is already linked to another wallet.'
    );
  }

  let result;

  if (existing) {
    result = await db
      .from('wallets')
      .update({
        monime_account_id: account.id,
        metadata: {
          ...existing.metadata,
          monime_account_id: account.id,
        },
      })
      .eq('id', existing.id)
      .select()
      .single();
  } else {
    result = await db
      .from('wallets')
      .upsert(
        {
          user_id: user.id,
          currency,
          balance: 0,
          monime_account_id: account.id,
          metadata: {
            monime_account_id: account.id,
          },
          is_frozen: false,
        },
        {
          onConflict: 'user_id,currency',
          ignoreDuplicates: true,
        }
      )
      .select()
      .maybeSingle();

    if (!result.error && !result.data) {
      result = await db
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('currency', currency)
        .single();
    }
  }

  if (result.error) {
    throw new HttpError(
      503,
      'The provider account exists, but its wallet link could not be saved. Retry this request; do not create another account.'
    );
  }

  return res.status(200).json({
    wallet: result.data,
  });
}