export function transactionDirection(tx) {
  const type = String(tx?.type || '').toLowerCase();

  if (type === 'credit' || type === 'debit') {
    return type;
  }

  const legacy = String(
    tx?.balanceImpact || ''
  ).toLowerCase();

  if (legacy === 'credit' || legacy === 'debit') {
    return legacy;
  }

  return 'unknown';
}

export function transactionTitle(tx) {
  if (tx?.businessTitle) {
    return tx.businessTitle;
  }

  if (tx?.originatingReversal?.originTxnId) {
    return 'Payment reversal';
  }

  if (tx?.originatingFee?.code) {
    return 'Provider processing fee';
  }

  if (
    tx?.description &&
    !['credit', 'debit'].includes(
      String(tx.description).toLowerCase()
    )
  ) {
    return tx.description;
  }

  let owner = tx?.ownershipGraph?.owner;

  for (
    let i = 0;
    owner && i < 10;
    i++, owner = owner.owner
  ) {
    if (
      ['checkout_session', 'payment_code', 'payment']
        .includes(owner.type)
    ) {
      return 'Wallet top-up';
    }

    if (owner.type === 'payout') {
      return 'Mobile money withdrawal';
    }

    if (owner.type === 'internal_transfer') {
      return transactionDirection(tx) === 'credit'
        ? 'Wallet transfer received'
        : 'Wallet transfer sent';
    }
  }

  const direction = transactionDirection(tx);

  if (direction === 'credit') {
    return 'Money received';
  }

  if (direction === 'debit') {
    return 'Money sent';
  }

  return 'Wallet transaction';
}

export function transactionAmount(tx) {
  const direction = transactionDirection(tx);
  const value = tx?.amount?.value;

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value)
  ) {
    return 'Amount unavailable';
  }

  const sign =
    direction === 'credit'
      ? '+'
      : direction === 'debit'
      ? '−'
      : '';

  const currency = tx.amount.currency || 'SLE';
  const amount = (Math.abs(value) / 100).toFixed(2);

  return `${sign} ${currency} ${amount}`.trim();
}

export function transactionReceipt(tx) {
  const raw =
    tx.timestamp ||
    tx.createTime ||
    tx.createdAt ||
    tx.created_at ||
    tx.date;

  const date = new Date(raw);
  const direction = transactionDirection(tx);

  const directionLabel =
    direction === 'credit'
      ? 'Received'
      : direction === 'debit'
      ? 'Sent'
      : 'Not provided';

  const dateLabel = Number.isNaN(date.getTime())
    ? 'Not provided'
    : date.toLocaleString();

  const lines = [
    'MatMove transaction receipt',
    transactionTitle(tx),
    `Direction: ${directionLabel}`,
    `Amount: ${transactionAmount(tx)}`,
    `Recorded: ${dateLabel}`,
    `Status: ${
      tx.status || 'Recorded in wallet ledger'
    }`,
    `Reference: ${
      tx.id || tx.reference || 'Not provided'
    }`,
  ];

  if (tx.businessDetails) {
    lines.push(tx.businessDetails);
  }

  return lines.join('\n');
}