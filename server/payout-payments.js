import { timingSafeEqual } from 'node:crypto';

import {
  HttpError,
  assertAllowed,
  toMinorUnits,
  keyFor,
  verifiedAccount,
  monime,
  dbClient
} from './wallet-security.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function payoutFees(amount) {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 1000000000000
  ) {
    throw new HttpError(400, 'Invalid payout amount.');
  }

  const round = bps =>
    Number(
      (BigInt(amount) * BigInt(bps) + 5000n) /
      10000n
    );

  const monimeFeeMinor = round(100);
  const platformFeeMinor = round(58);

  return {
    amountMinor: amount,
    monimeFeeMinor,
    platformFeeMinor,
    totalMinor:
      amount + monimeFeeMinor + platformFeeMinor,
    monimeRatePercent: 1,
    platformRatePercent: 0.58,
    currency: 'SLE'
  };
}

function destination(body) {
  if (
    !['orange', 'afrimoney'].includes(
      body.networkProvider
    )
  ) {
    throw new HttpError(
      400,
      'Choose Orange Money or AfriMoney.'
    );
  }

  let phone = String(
    body.destinationPhone || ''
  ).replace(/[\s()-]/g, '');

  if (/^0\d{8}$/.test(phone)) {
    phone = `+232${phone.slice(1)}`;
  }

  if (/^232\d{8}$/.test(phone)) {
    phone = `+${phone}`;
  }

  if (!/^\+232\d{8}$/.test(phone)) {
    throw new HttpError(
      400,
      'Enter a valid Sierra Leone mobile money number.'
    );
  }

  return {
    provider:
      body.networkProvider === 'orange'
        ? 'm17'
        : 'm18',
    phone
  };
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);

  if (error) {
    console.error('MatMove withdrawal RPC failed', {
      function: name,
      code: error.code,
      message: error.message
    });

    const known =
      /^(FORBIDDEN|CONFLICT|INVALID|NOT_FOUND):/;

    throw new HttpError(
      known.test(error.message) ? 409 : 503,
      known.test(error.message)
        ? error.message.replace(/^[A-Z_]+: /, '')
        : 'Withdrawal storage is unavailable. Apply PAYOUT_FEE_SETUP.sql first.'
    );
  }

  return data;
}

async function read(db, id) {
  const { data, error } = await db
    .from('matmove_withdrawals')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new HttpError(
      503,
      'Unable to read the withdrawal receipt.'
    );
  }

  return data;
}

function balance(account) {
  const amount = account?.balance?.available;

  if (
    account?.currency !== 'SLE' ||
    amount?.currency !== 'SLE' ||
    !Number.isSafeInteger(amount.value) ||
    amount.value < 0
  ) {
    throw new HttpError(
      503,
      'Your available SLE balance could not be verified.'
    );
  }

  return amount.value;
}

const record = (
  db,
  id,
  kind,
  providerId,
  status,
  error = null,
  actualFee = null
) =>
  rpc(db, 'matmove_record_withdrawal_leg', {
    p_id: id,
    p_kind: kind,
    p_provider_id: providerId,
    p_status: status,
    p_error: error,
    p_actual_fee: actualFee
  });

export async function runWithdrawalLeg(
  db,
  withdrawal,
  kind,
  provider = monime
) {
  const id = withdrawal.id;

  const leg = await rpc(
    db,
    'matmove_claim_withdrawal_leg',
    {
      p_id: id,
      p_kind: kind
    }
  );

  if (
    !leg ||
    ['completed', 'failed', 'review_required']
      .includes(leg.status) ||
    (!leg.can_create && !leg.provider_id)
  ) {
    return;
  }

  const isPayout = kind === 'payout';

  const source =
    kind === 'refund'
      ? withdrawal.platform_account
      : withdrawal.source_account;

  const target =
    kind === 'refund'
      ? withdrawal.source_account
      : withdrawal.platform_account;

  if (leg.can_create && isPayout) {
    try {
      const account = await provider(
        `financial-accounts/${encodeURIComponent(source)}?withBalance=true`
      );

      if (account.id !== source) {
        throw new HttpError(
          503,
          'Provider account changed.'
        );
      }

      const required =
        Number(withdrawal.amount_minor) +
        Number(withdrawal.monime_fee_minor);

      if (balance(account) < required) {
        await record(
          db,
          id,
          kind,
          null,
          'failed',
          'Insufficient available balance for payout plus Monime fee.',
          0
        );

        return;
      }
    } catch {
      // No payout POST occurred.
      await record(
        db,
        id,
        kind,
        null,
        'failed',
        'Balance unavailable before payout. MatMove fee will be refunded.',
        0
      );

      return;
    }
  }

  let result;

  try {
    const path =
      isPayout ? 'payouts' : 'internal-transfers';

    result = leg.provider_id
      ? await provider(
          `${path}/${encodeURIComponent(leg.provider_id)}`
        )
      : await provider(path, {
          method: 'POST',

          headers: {
            'Idempotency-Key': leg.request_key
          },

          body: JSON.stringify(
            isPayout
              ? {
                  amount: {
                    currency: 'SLE',
                    value: Number(leg.amount_minor)
                  },

                  source: {
                    financialAccountId: source
                  },

                  destination: {
                    type: 'momo',
                    providerId: withdrawal.provider,
                    phoneNumber: withdrawal.phone
                  },

                  metadata: {
                    matmoveWithdrawalId: id
                  }
                }
              : {
                  amount: {
                    currency: 'SLE',
                    value: Number(leg.amount_minor)
                  },

                  sourceFinancialAccount: {
                    id: source
                  },

                  destinationFinancialAccount: {
                    id: target
                  },

                  description:
                    `MatMove payout ${kind} ${id}`,

                  metadata: {
                    matmoveWithdrawalId: id,
                    kind
                  }
                }
          )
        });
  } catch (error) {
    if (leg.can_create) {
      await record(
        db,
        id,
        kind,
        null,
        'review_required',
        'Provider response uncertain. Verify Monime receipts before any new payment.'
      );
    }

    throw error;
  }

  const matches =
    typeof result?.id === 'string' &&
    result.id.length > 0 &&
    (
      !leg.provider_id ||
      result.id === leg.provider_id
    ) &&
    result.amount?.currency === 'SLE' &&
    result.amount?.value ===
      Number(leg.amount_minor) &&
    ['pending', 'processing', 'completed', 'failed']
      .includes(result.status) &&
    (
      isPayout
        ? result.source?.financialAccountId ===
            source &&
          result.destination?.type === 'momo' &&
          result.destination?.providerId ===
            withdrawal.provider &&
          result.destination?.phoneNumber ===
            withdrawal.phone
        : result.sourceFinancialAccount?.id ===
            source &&
          result.destinationFinancialAccount?.id ===
            target
    );

  if (!matches) {
    await record(
      db,
      id,
      kind,
      leg.provider_id || null,
      'review_required',
      'Provider response did not match the recorded operation.'
    );

    throw new HttpError(
      502,
      'Withdrawal receipt needs support review. Do not make another payment.'
    );
  }

  let actualFee = null;

  if (
    isPayout &&
    ['completed', 'failed'].includes(result.status)
  ) {
    if (
      !Array.isArray(result.fees) ||
      result.fees.some(
        fee =>
          fee.amount?.currency !== 'SLE' ||
          !Number.isSafeInteger(fee.amount?.value) ||
          fee.amount.value < 0
      )
    ) {
      await record(
        db,
        id,
        kind,
        result.id,
        'review_required',
        'Monime did not return verifiable payout fee amounts.'
      );

      return;
    }

    actualFee = result.fees.reduce(
      (sum, fee) => sum + fee.amount.value,
      0
    );
  }

  await record(
    db,
    id,
    kind,
    result.id,
    result.status,
    result.failureDetail?.message || null,
    actualFee
  );
}

export async function reconcileWithdrawal(
  db,
  id,
  provider = monime
) {
  for (let step = 0; step < 3; step++) {
    const withdrawal = await read(db, id);

    const kind = {
      fee_pending: 'fee',
      fee_paid: 'payout',
      payout_pending: 'payout',
      refund_pending: 'refund'
    }[withdrawal.state];

    if (!kind) return withdrawal;

    await runWithdrawalLeg(
      db,
      withdrawal,
      kind,
      provider
    );

    const updated = await read(db, id);

    if (updated.state === withdrawal.state) {
      return updated;
    }
  }

  return read(db, id);
}

export async function withdrawalSnapshot(db, w) {
  const {
    data: legs,
    error
  } = await db
    .from('matmove_withdrawal_legs')
    .select('*')
    .eq('withdrawal_id', w.id);

  if (error) {
    throw new HttpError(
      503,
      'Withdrawal receipts are unavailable.'
    );
  }

  const payoutCompleted = legs.some(
    leg =>
      leg.kind === 'payout' &&
      leg.status === 'completed'
  );

  return {
    id: w.id,
    state: w.state,
    currency: 'SLE',
    amountMinor: Number(w.amount_minor),
    monimeFeeMinor: Number(w.monime_fee_minor),
    platformFeeMinor: Number(w.platform_fee_minor),
    totalMinor: Number(w.total_minor),

    actualMonimeFeeMinor:
      w.actual_monime_fee_minor === null
        ? null
        : Number(w.actual_monime_fee_minor),

    platformAccountId: w.platform_account,
    phone: w.phone,

    networkProvider:
      w.provider === 'm17'
        ? 'orange'
        : 'afrimoney',

    actualTotalMinor:
      payoutCompleted &&
      w.actual_monime_fee_minor !== null
        ? Number(w.amount_minor) +
          Number(w.actual_monime_fee_minor) +
          Number(w.platform_fee_minor)
        : null,

    error: w.error,

    receipts: legs.map(leg => ({
      kind: leg.kind,
      id: leg.provider_id,
      status: leg.status,
      amountMinor: Number(leg.amount_minor)
    }))
  };
}

export async function payoutAction(
  req,
  res,
  {
    provider = monime,
    verifyAccount = verifiedAccount
  } = {}
) {
  const {
    db,
    user,
    profile,
    wallets
  } = req.matmove;

  const action = req.body?.action || 'submit';

  if (
    !['quote', 'submit', 'status'].includes(action)
  ) {
    throw new HttpError(
      400,
      'Choose a valid withdrawal action.'
    );
  }

  if (action === 'status') {
    const id = req.body.withdrawalId;

    if (!uuid.test(String(id || ''))) {
      throw new HttpError(
        400,
        'Valid withdrawal ID required.'
      );
    }

    const existing = await read(db, id);

    if (existing.user_id !== user.id) {
      throw new HttpError(
        403,
        'This withdrawal belongs to another user.'
      );
    }

    const updated = await reconcileWithdrawal(
      db,
      id,
      provider
    );

    return respond(db, res, updated);
  }

  if (
    String(
      req.body.currency || 'SLE'
    ).toUpperCase() !== 'SLE'
  ) {
    throw new HttpError(
      400,
      'Mobile payouts support SLE only.'
    );
  }

  const quote = payoutFees(
    toMinorUnits(req.body.amount)
  );

  const dest = destination(req.body);

  const wallet = wallets.filter(
    item => item.currency === 'SLE'
  );

  if (wallet.length !== 1) {
    throw new HttpError(
      409,
      'A unique SLE wallet is required.'
    );
  }

  const key = keyFor(
    user.id,
    'payout',
    req.body.idempotencyKey
  );

  if (action === 'submit') {
    const {
      data: existing,
      error
    } = await db
      .from('matmove_withdrawals')
      .select('*')
      .eq('request_key', key)
      .maybeSingle();

    if (error) {
      throw new HttpError(
        503,
        'Apply PAYOUT_FEE_SETUP.sql before withdrawing.'
      );
    }

    if (existing) {
      if (
        existing.user_id !== user.id ||
        Number(existing.amount_minor) !==
          quote.amountMinor ||
        existing.provider !== dest.provider ||
        existing.phone !== dest.phone
      ) {
        throw new HttpError(
          409,
          'Withdrawal request key conflict.'
        );
      }

      return respond(
        db,
        res,
        await reconcileWithdrawal(
          db,
          existing.id,
          provider
        )
      );
    }

    if (
      req.body.acceptedTotalMinor !==
      quote.totalMinor
    ) {
      throw new HttpError(
        409,
        'Review and confirm the current payout fee quote first.'
      );
    }
  }

  assertAllowed(profile, wallets, 'payout');

  const account = await verifyAccount(
    db,
    wallet[0]
  );

  const available = balance(account);

  // MatMove's payout fee goes strictly to escrow.
  const platform =
    process.env.MONIME_ESCROW_ACCOUNT_ID;

  if (
    !/^fac-[A-Za-z0-9_-]+$/.test(
      String(platform || '')
    ) ||
    platform === account.id
  ) {
    throw new HttpError(
      503,
      'Set MONIME_ESCROW_ACCOUNT_ID to the platform SLE escrow account, separate from the customer wallet.'
    );
  }

  const platformAccount = await provider(
    `financial-accounts/${encodeURIComponent(platform)}?withBalance=true`
  );

  if (
    platformAccount.id !== platform ||
    platformAccount.currency !== 'SLE'
  ) {
    throw new HttpError(
      503,
      'Platform withdrawal fee account could not be verified.'
    );
  }

  if (action === 'quote') {
    return res.status(200).json({
      quote: {
        ...quote,
        availableMinor: available,
        affordable:
          quote.totalMinor <= available
      }
    });
  }

  if (quote.totalMinor > available) {
    throw new HttpError(
      400,
      'Insufficient balance for the withdrawal and both fees.'
    );
  }

  const withdrawal = await rpc(
    db,
    'matmove_prepare_withdrawal',
    {
      p_key: key,
      p_user_id: user.id,
      p_wallet_id: wallet[0].id,
      p_source: account.id,
      p_platform: platform,
      p_amount: quote.amountMinor,
      p_monime_fee: quote.monimeFeeMinor,
      p_platform_fee: quote.platformFeeMinor,
      p_provider: dest.provider,
      p_phone: dest.phone
    }
  );

  return respond(
    db,
    res,
    await reconcileWithdrawal(
      db,
      withdrawal.id,
      provider
    )
  );
}

async function respond(db, res, withdrawal) {
  const terminal = [
    'completed',
    'fee_failed',
    'refunded',
    'review_required'
  ].includes(withdrawal.state);

  const snapshot = await withdrawalSnapshot(
    db,
    withdrawal
  );

  return res.status(
    terminal ? 200 : 202
  ).json({
    success:
      withdrawal.state === 'completed',
    pending: !terminal,
    withdrawal: snapshot
  });
}

export async function reconcileWithdrawals(
  req,
  res
) {
  const secret = process.env.CRON_SECRET;

  const expected = Buffer.from(
    `Bearer ${secret || ''}`
  );

  const actual = Buffer.from(
    String(req.headers.authorization || '')
  );

  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return res.status(401).json({
      error: 'Unauthorized.'
    });
  }

  try {
    const db = dbClient();

    const {
      data,
      error
    } = await db
      .from('matmove_withdrawals')
      .select('id')
      .in('state', [
        'fee_pending',
        'fee_paid',
        'payout_pending',
        'refund_pending'
      ])
      .order('updated_at')
      .limit(5);

    if (error) throw error;

    const results = await Promise.allSettled(
      data.map(withdrawal =>
        reconcileWithdrawal(
          db,
          withdrawal.id
        )
      )
    );

    for (const withdrawal of data) {
      const result = await db
        .from('matmove_withdrawals')
        .update({
          updated_at:
            new Date().toISOString()
        })
        .eq('id', withdrawal.id)
        .in('state', [
          'fee_pending',
          'fee_paid',
          'payout_pending',
          'refund_pending'
        ]);

      if (result.error) {
        throw result.error;
      }
    }

    const failed = results.filter(
      result =>
        result.status === 'rejected'
    ).length;

    return res.status(
      failed ? 503 : 200
    ).json({
      checked: data.length,
      failed
    });
  } catch {
    return res.status(503).json({
      error: 'Withdrawal reconciliation unavailable.'
    });
  }
}