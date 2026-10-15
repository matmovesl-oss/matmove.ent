

import { useEffect, useRef, useState } from 'react';
import {
  Wallet,
  RefreshCw,
  Copy,
  Share2,
  Plus,
  Eye, EyeOff, ChevronLeft, ChevronRight,
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
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState(0);
  useEffect(() => { setVisible({}); }, [sleWallet?.monime_account_id, sleWallet?.metadata?.monime_account_id, usdWallet?.monime_account_id, usdWallet?.metadata?.monime_account_id]);
  const rail = useRef<HTMLDivElement>(null);
  function move(index: number) {
    const next = Math.max(0, Math.min(1, index));
    const el = rail.current;
    if (el) el.scrollTo({left: el.clientWidth * next, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">Your wallets · swipe to change currency</p>
        <div className="flex gap-2">
          <button type="button" aria-label="Previous wallet" disabled={active === 0} onClick={() => move(active - 1)} className="rounded-full border p-2 disabled:opacity-40"><ChevronLeft size={18}/></button>
          <button type="button" aria-label="Next wallet" disabled={active === 1} onClick={() => move(active + 1)} className="rounded-full border p-2 disabled:opacity-40"><ChevronRight size={18}/></button>
        </div>
      </div>
      <div ref={rail} role="region" aria-label="SLE and USD wallets" tabIndex={0}
        onScroll={e => {const el=e.currentTarget; setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));}}
        onKeyDown={e => {if(e.target!==e.currentTarget)return; if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(active+(e.key==='ArrowRight'?1:-1));}}}
        className="flex w-full snap-x snap-mandatory overflow-x-auto rounded-3xl" style={{overscrollBehaviorX:'contain'}}>
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
              aria-label={`${currency} wallet`}
              className={`relative w-full min-w-0 shrink-0 snap-center overflow-hidden rounded-3xl p-6 text-white shadow-xl ${colour}`}
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

              <div className="mt-2 flex items-center gap-3">
                <p className="min-w-0 break-words text-3xl font-black" aria-live="polite">
                  {currency} {visible[currency] ? (available ? Number(wallet.balance).toFixed(2) : id ? 'Unavailable' : 'Not created') : <span aria-label="Balance hidden">••••••</span>}
                </p>
                <button type="button" aria-label={`${visible[currency] ? 'Hide' : 'Show'} ${currency} balance`} aria-pressed={!!visible[currency]}
                  onClick={() => setVisible(old => ({...old,[currency]:!old[currency]}))}
                  className="shrink-0 rounded-xl bg-white/15 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                  {visible[currency] ? <EyeOff size={21}/> : <Eye size={21}/>}
                </button>
              </div>

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

      <div className="flex justify-center gap-3" aria-label="Choose wallet">
        {['SLE','USD'].map((currency,index)=><button type="button" key={currency} aria-label={`Show ${currency} wallet`} aria-current={active===index?'true':undefined} onClick={()=>move(index)} className={`rounded-full px-4 py-1 text-xs font-bold ${active===index?'bg-slate-900 text-white':'bg-slate-100 text-slate-600'}`}>{currency}</button>)}
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
