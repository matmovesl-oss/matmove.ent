export function checkoutWalletCredit(session) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const items = session?.lineItems?.data;

  if (
    !session ||
    session.status !== 'completed' ||
    typeof session.id !== 'string' ||
    !session.id ||
    !/^fac-[A-Za-z0-9_-]+$/.test(String(session.financialAccountId || '')) ||
    typeof session.metadata?.userId !== 'string' ||
    !uuid.test(session.metadata.userId) ||
    !Array.isArray(items) ||
    items.length !== 1
  ) return null;

  const item = items[0];
  const amount = item?.price?.value;

  if (
    item?.name !== 'Wallet Load' ||
    item?.price?.currency !== 'SLE' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    item?.quantity !== 1
  ) return null;

  return {
    checkoutSessionId: session.id,
    financialAccountId: session.financialAccountId,
    userId: session.metadata.userId,
    role: typeof session.metadata.role === 'string' ? session.metadata.role : null,
    amountMinor: amount
  };
}
