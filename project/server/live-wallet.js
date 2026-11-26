
import {
  enrichTransactions,
} from './transaction-context.js';

import {
  verifiedAccount,
  monime,
  monimeEnvironment,
} from './wallet-security.js';

const MAX_FINANCIAL_TRANSACTION_PAGES = 20;
const FINANCIAL_TRANSACTION_PAGE_SIZE = 50;

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
        let after = null;
        const seenCursors = new Set();
        const seenTransactionIds = new Set(transactions.map(tx => tx.id).filter(Boolean));
        let reachedEnd = false;

        for (let pageIndex = 0; pageIndex < MAX_FINANCIAL_TRANSACTION_PAGES; pageIndex += 1) {
          const query = new URLSearchParams({
            financialAccountId: account.id,
            limit: String(FINANCIAL_TRANSACTION_PAGE_SIZE),
          });
          if (after) query.set('after', after);

          const response = await provider(
            'financial-transactions?' + query.toString(),
            { includePagination: true }
          );
          const history = Array.isArray(response) ? response : response?.result;

          if (!Array.isArray(history)) {
            throw new Error('Invalid transaction history.');
          }

          const accountHistory = history.filter(tx => {
            if (tx.financialAccount?.id && tx.financialAccount.id !== account.id) return false;
            if (tx.amount?.currency !== currency) return false;
            if (tx.id && seenTransactionIds.has(tx.id)) return false;
            if (tx.id) seenTransactionIds.add(tx.id);
            return true;
          });
          transactions.push(...accountHistory);

          const next = Array.isArray(response) ? null : response?.pagination?.next;
          if (!next) {
            reachedEnd = true;
            break;
          }
          if (typeof next !== 'string' || seenCursors.has(next)) {
            throw new Error('Invalid transaction history pagination cursor.');
          }
          seenCursors.add(next);
          after = next;
        }

        if (!reachedEnd) {
          warnings.push(
            currency + ' transaction history is showing the latest ' +
            (MAX_FINANCIAL_TRANSACTION_PAGES * FINANCIAL_TRANSACTION_PAGE_SIZE) +
            ' records. Older records may remain; contact MatMove support for a full statement.'
          );
        }
      } catch {
        warnings.push(
          currency + ' balance is verified; transaction history is temporarily unavailable.'
        );
      }

      // A UVAN is a Monime-issued receiving alias. Preserve leading zeroes
      // and never synthesize one from the Financial Account ID.
      const uvan = typeof account.uvan === 'string' && /^\d{6,20}$/.test(account.uvan.trim())
        ? account.uvan.trim()
        : null;
      const monimePaymentUrl = currency === 'SLE' && uvan
        ? `https://pay.monime.io/${uvan}`
        : null;

      return {
        ...wallet,
        monime_account_id: account.id,
        ...(uvan ? { monime_uvan: uvan } : {}),
        ...(monimePaymentUrl ? { monime_payment_url: monimePaymentUrl } : {}),
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
