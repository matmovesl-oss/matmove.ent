
import { useState } from 'react';
import {
  Wallet,
  RefreshCw,
  Copy,
  Share2,
  Plus,
} from 'lucide-react';

type Props = {
  sleWallet: any;
  usdWallet: any;
  refresh: () => unknown;
  refreshing: boolean;
  createUsd: () => unknown;
  creatingUsd: boolean;
};

export default function WalletCards({
  sleWallet,
  usdWallet,
  refresh,
  refreshing,
  createUsd,
  creatingUsd,
}: Props) {
  const [notice, setNotice] = useState('');
  const [iconFailed, setIconFailed] = useState(false);

  async function share(wallet: any, currency: string) {
    const id =
      wallet?.monime_account_id ||
      wallet?.metadata?.monime_account_id;

    if (!id) {
      setNotice('Wallet account is not ready to share.');
      return;
    }

    const text =
      `MatMove ${currency} wallet\n` +
      `Account ID: ${id}\n` +
      `Send ${currency} only to this account.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `MatMove ${currency} wallet`,
          text,
        });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Wallet account details copied.');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setNotice(
          'Unable to share. Use Copy account instead.'
        );
      }
    }
  }

  async function copyAccount(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setNotice('Account ID copied.');
    } catch {
      setNotice('Could not copy account ID.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
        {(['SLE', 'USD'] as const).map(currency => {
          const wallet =
            currency === 'SLE'
              ? sleWallet
              : usdWallet;

          const id =
            wallet?.monime_account_id ||
            wallet?.metadata?.monime_account_id;

          const available =
            wallet?.balanceAvailable === true &&
            typeof wallet.balance === 'number' &&
            Number.isFinite(wallet.balance);

          const colour =
            currency === 'SLE'
              ? 'bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700'
              : 'bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700';

          return (
            <article
              key={currency}
              className={`relative overflow-hidden rounded-3xl p-6 text-white shadow-xl ${colour}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/95">
                  {iconFailed ? (
                    <Wallet
                      className="text-emerald-700"
                      size={27}
                    />
                  ) : (
                    <img
                      src="/wallet-icon.png"
                      alt="MatMove"
                      className="h-9 w-9 object-contain"
                      onError={() => setIconFailed(true)}
                    />
                  )}
                </div>

                <button
                  aria-label={`Refresh ${currency} balance`}
                  disabled={refreshing}
                  onClick={() => void refresh()}
                  className="rounded-xl bg-white/15 p-2"
                >
                  <RefreshCw
                    size={18}
                    className={
                      refreshing ? 'animate-spin' : ''
                    }
                  />
                </button>
              </div>

              <p className="mt-5 text-xs font-bold uppercase tracking-widest text-white/80">
                {currency === 'SLE'
                  ? 'Leone wallet'
                  : 'US dollar wallet'}
              </p>

              <p className="mt-2 text-3xl font-black">
                {currency}{' '}
                {available
                  ? Number(wallet.balance).toFixed(2)
                  : id
                  ? 'Unavailable'
                  : 'Not created'}
              </p>

              {id ? (
                <>
                  <p className="mt-4 break-all font-mono text-xs text-white/80">
                    {id}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm"
                      onClick={() => void copyAccount(id)}
                    >
                      <Copy size={14} />
                      Copy account
                    </button>

                    <button
                      className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm"
                      onClick={() =>
                        void share(wallet, currency)
                      }
                    >
                      <Share2 size={14} />
                      Share wallet
                    </button>
                  </div>
                </>
              ) : currency === 'USD' ? (
                <button
                  disabled={creatingUsd}
                  onClick={() => void createUsd()}
                  className="mt-4 flex items-center gap-2 rounded-xl bg-white/20 px-4 py-3 font-bold"
                >
                  <Plus size={16} />

                  {creatingUsd
                    ? 'Creating...'
                    : 'Create USD wallet'}
                </button>
              ) : (
                <p className="mt-4 text-sm">
                  Wallet setup pending.
                </p>
              )}
            </article>
          );
        })}
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
