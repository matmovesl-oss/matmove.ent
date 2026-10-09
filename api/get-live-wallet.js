import {
  protectedWallet,
  verifiedAccount,
  monime,
} from '../server/wallet-security.js';

export default protectedWallet(
  'read',
  async (req, res) => {
    const { db, wallets } = req.matmove;
    const transactions = [];

    const read = async currency => {
      const wallet = wallets.find(
        item => item.currency === currency
      );

      if (!wallet) return null;

      try {
        const account =
          await verifiedAccount(db, wallet);

        const balance =
          account.balance?.available;

        if (
          balance?.currency !== currency ||
          !Number.isSafeInteger(balance?.value) ||
          balance.value < 0
        ) {
          throw new Error('Invalid balance');
        }

        const tx = await monime(
          `financial-transactions?financialAccountId=${
            encodeURIComponent(account.id)
          }&limit=50`
        );

        if (Array.isArray(tx)) {
          transactions.push(...tx);
        }

        return {
          ...wallet,
          monime_account_id: account.id,
          balance: balance.value / 100,
          balanceAvailable: true,
        };
      } catch {
        return {
          ...wallet,
          balance: null,
          balanceAvailable: false,
        };
      }
    };

    const [sleWallet, usdWallet] =
      await Promise.all([
        read('SLE'),
        read('USD'),
      ]);

    transactions.sort(
      (a, b) =>
        new Date(
          b.createdAt || b.created_at
        ).getTime() -
        new Date(
          a.createdAt || a.created_at
        ).getTime()
    );

    return res.status(200).json({
      sleWallet,
      usdWallet,
      transactions,
    });
  }
);