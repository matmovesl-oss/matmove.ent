import {
  enrichTransactions,
} from './transaction-context.js';

import {
  verifiedAccount,
  monime,
  monimeEnvironment,
} from './wallet-security.js';

export async function liveWallet(
  context,
  {
    verify = verifiedAccount,
    provider = monime,
  } = {}
) {
  const { db, wallets } = context;

  const transactions = [];
  const warnings = [];

  const read = async currency => {
    const matches = wallets.filter(
      wallet => wallet.currency === currency
    );

    if (!matches.length) {
      return null;
    }

    const wallet = matches[0];

    try {
      if (matches.length !== 1) {
        throw new Error(
          'Resolve duplicate wallet rows before making payments.'
        );
      }

      const account = await verify(db, wallet);
      const balance = account.balance?.available;

      if (
        balance?.currency !== currency ||
        !Number.isSafeInteger(balance.value) ||
        balance.value < 0
      ) {
        throw new Error(
          'Provider available balance could not be verified.'
        );
      }

      try {
        const history = await provider(
          `financial-transactions?financialAccountId=${
            encodeURIComponent(account.id)
          }&limit=50`
        );

        if (!Array.isArray(history)) {
          throw new Error(
            'Invalid transaction history.'
          );
        }

        const accountHistory = history.filter(tx => {
          if (
            tx.financialAccount?.id &&
            tx.financialAccount.id !== account.id
          ) {
            warnings.push(
              'A transaction for a different account was excluded.'
            );

            return false;
          }

          return tx.amount?.currency === currency;
        });

        transactions.push(...accountHistory);
      } catch {
        warnings.push(
          `${currency} balance is verified; transaction history is temporarily unavailable.`
        );
      }

      return {
        ...wallet,
        monime_account_id: account.id,
        balance: balance.value / 100,
        balanceAvailable: true,
      };
    } catch (error) {
      return {
        ...wallet,
        balance: null,
        balanceAvailable: false,

        balanceError: error.status
          ? error.message
          : 'Wallet balance is unavailable. Check wallet links and refresh.',
      };
    }
  };

  const [
    sleWallet,
    usdWallet,
  ] = await Promise.all([
    read('SLE'),
    read('USD'),
  ]);

  transactions.sort(
    (a, b) =>
      new Date(
        b.timestamp ||
        b.createTime ||
        b.createdAt ||
        b.created_at
      ).getTime() -
      new Date(
        a.timestamp ||
        a.createTime ||
        a.createdAt ||
        a.created_at
      ).getTime()
  );

  const detailedTransactions =
    await enrichTransactions(
      db,
      context.user?.id || wallets[0]?.user_id,
      transactions,
      warnings
    );

  return {
    sleWallet,
    usdWallet,
    transactions: detailedTransactions,
    warnings,
    providerEnvironment: monimeEnvironment(),
  };
}