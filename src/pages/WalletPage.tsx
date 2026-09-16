import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CheckCircle2,
  CreditCard,
  History,
  Landmark,
  LockKeyhole,
  ReceiptText,
  Send,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';

type WalletRole =
  | 'rider'
  | 'client'
  | 'driver'
  | 'merchant'
  | 'vendor'
  | string;

type WalletCurrency = 'SLE' | 'USD';

interface WalletRecord {
  id?: string;
  user_id?: string;
  balance?: number | string;
  reserved_balance?: number | string;
  currency?: string;
  is_frozen?: boolean;
  frozen?: boolean;
  isFrozen?: boolean;
}

interface WalletPageProps {
  profile?: any;
  wallet?: WalletRecord & {
    wallets?: WalletRecord[];
  };
  onClose?: () => void;
  onTopUp?: () => void;
  onWithdraw?: () => void;
  onSendMoney?: () => void;
}

function normalizeCurrency(value: unknown): WalletCurrency {
  return String(value || '').toUpperCase() === 'USD' ? 'USD' : 'SLE';
}

function formatMoney(value: number, currency: WalletCurrency) {
  return `${currency} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getWalletBalance(wallet?: WalletRecord) {
  const value = Number(wallet?.balance || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getReservedBalance(wallet?: WalletRecord) {
  const value = Number(wallet?.reserved_balance || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getAvailableBalance(wallet?: WalletRecord) {
  const balance = getWalletBalance(wallet);
  const reserved = getReservedBalance(wallet);
  return Math.max(0, balance - reserved);
}

function isWalletFrozen(wallet?: WalletRecord) {
  return (
    wallet?.frozen === true ||
    wallet?.is_frozen === true ||
    wallet?.isFrozen === true
  );
}

export function WalletPage({
  profile,
  wallet,
  onClose,
  onTopUp,
  onWithdraw,
  onSendMoney,
}: WalletPageProps) {
  const role: WalletRole = String(
    profile?.role || profile?.customer_role || profile?.customerRole || ''
  ).toLowerCase();

  const isRider = role === 'rider' || role === 'client';
  const isDriver = role === 'driver';
  const isMerchant = role === 'merchant' || role === 'vendor';
  const isCustomer = isRider || isDriver || isMerchant;

  const walletList = Array.isArray(wallet?.wallets)
    ? wallet.wallets
    : wallet
    ? [wallet]
    : [];

  const sleWallet = walletList.find(
    (item) => normalizeCurrency(item.currency) === 'SLE'
  );

  const usdWallet = walletList.find(
    (item) => normalizeCurrency(item.currency) === 'USD'
  );

  const resolvedSleWallet =
    sleWallet ||
    (normalizeCurrency(wallet?.currency) === 'SLE' ? wallet : undefined);

  const resolvedUsdWallet =
    usdWallet ||
    (normalizeCurrency(wallet?.currency) === 'USD' ? wallet : undefined);

  /* =========================================================
   * SLE BALANCES
   * ========================================================= */
  const sleBalance = getWalletBalance(resolvedSleWallet);
  const sleReserved = getReservedBalance(resolvedSleWallet);
  const sleAvailable = getAvailableBalance(resolvedSleWallet);
  const sleFrozen = isWalletFrozen(resolvedSleWallet);

  /* =========================================================
   * USD BALANCES
   * ========================================================= */
  const usdBalance = getWalletBalance(resolvedUsdWallet);
  const usdReserved = getReservedBalance(resolvedUsdWallet);
  const usdAvailable = getAvailableBalance(resolvedUsdWallet);
  const usdFrozen = isWalletFrozen(resolvedUsdWallet);

  /* =========================================================
   * PRIMARY BALANCE
   * ========================================================= */
  const primaryCurrency: WalletCurrency =
    !resolvedSleWallet && !!resolvedUsdWallet ? 'USD' : 'SLE';

  const primaryBalance =
    primaryCurrency === 'USD' ? usdAvailable : sleAvailable;

  const primaryReserved =
    primaryCurrency === 'USD' ? usdReserved : sleReserved;

  const primaryFrozen = primaryCurrency === 'USD' ? usdFrozen : sleFrozen;

  /* =========================================================
   * KYC & WITHDRAWAL PERMISSIONS (ALL ROLES)
   * ========================================================= */
  const verificationStatus = String(
    profile?.kyc_status ||
      profile?.kycStatus ||
      profile?.verification_status ||
      profile?.verificationStatus ||
      ''
  )
    .trim()
    .toLowerCase();

  const isVerified = verificationStatus === 'approved';
  const hasAvailableSleBalance = sleAvailable > 0;

  // ALL customer roles (Riders, Drivers, Merchants) can withdraw when verified!
  const canWithdraw = isVerified && !sleFrozen && hasAvailableSleBalance;

  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name?.split(' ')?.filter(Boolean)?.[0] ||
    'User';

  const roleLabel = isRider
    ? 'Rider Wallet'
    : isDriver
    ? 'Driver Wallet'
    : isMerchant
    ? 'Merchant Wallet'
    : 'MatMove Wallet';

  const roleDescription = isRider
    ? 'Fund your wallet via Vult or withdraw available balances once verified.'
    : isDriver
    ? 'Receive MatMove payments, load your wallet via Vult, and withdraw available earnings.'
    : isMerchant
    ? 'Receive store payments, load your wallet via Vult, and withdraw available earnings.'
    : 'Manage your MatMove wallet and permitted Vult transactions.';

  const withdrawalStatusLabel = !isVerified
    ? 'Verification Required'
    : sleFrozen
    ? 'Wallet Frozen'
    : !hasAvailableSleBalance
    ? 'No Available SLE Funds'
    : 'Withdraw via Vult MoMo';

  const withdrawalStatusDescription = !isVerified
    ? 'Cash withdrawal becomes available after MatMove Admin approves your account verification.'
    : sleFrozen
    ? 'Your SLE wallet is currently restricted and cannot process withdrawals.'
    : !hasAvailableSleBalance
    ? sleReserved > 0
      ? `${formatMoney(sleReserved, 'SLE')} is reserved for a pending operation. Remaining funds can be withdrawn once released.`
      : 'There are currently no SLE funds available for withdrawal.'
    : 'Withdraw your available SLE balance directly to your Mobile Money account powered by Vult.';

  const handleWithdraw = () => {
    if (!canWithdraw) return;
    onWithdraw?.();
  };

  const handleTopUp = () => {
    if (!isCustomer) return;
    onTopUp?.();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-10">
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Wallet size={19} />
              </div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                MatMove Wallet • Vult Gateway
              </p>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-3">
              {roleLabel}
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Hello, {firstName}. {roleDescription}
            </p>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition shrink-0"
              aria-label="Close wallet"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* CURRENCY BALANCES */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CurrencyBalanceCard
            currency="SLE"
            balance={sleAvailable}
            reserved={sleReserved}
            frozen={sleFrozen}
            label="Operating Wallet"
            description="Receive MatMove payments, fund via MoMo, and cash out via Vult."
            icon={<Banknote size={21} />}
          />

          <CurrencyBalanceCard
            currency="USD"
            balance={usdAvailable}
            reserved={usdReserved}
            frozen={usdFrozen}
            label="USD Card Wallet"
            description="Available for supported USD card top-ups via Vult Gateway."
            icon={<CreditCard size={21} />}
          />
        </section>

        {/* PRIMARY BALANCE */}
        <section className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg overflow-hidden relative">
          <div className="absolute -right-20 -top-20 w-56 h-56 rounded-full bg-blue-500/10" />
          <div className="absolute -right-10 -bottom-24 w-48 h-48 rounded-full bg-emerald-500/10" />

          <div className="relative">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
                  <Wallet size={18} />
                  Available {primaryCurrency} Balance
                </div>

                <div className="text-4xl sm:text-5xl font-bold mt-3 tracking-tight">
                  {formatMoney(primaryBalance, primaryCurrency)}
                </div>

                <p className="text-xs text-slate-400 mt-3">
                  Your active MatMove wallet balance.
                </p>

                {primaryReserved > 0 && (
                  <p className="text-xs text-amber-300 mt-2">
                    {formatMoney(primaryReserved, primaryCurrency)} currently reserved for a pending transaction.
                  </p>
                )}
              </div>

              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                {primaryFrozen ? (
                  <LockKeyhole size={22} />
                ) : (
                  <ShieldCheck size={22} />
                )}
              </div>
            </div>

            <div className="mt-7 pt-5 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-400" />
                Protected by Vult API
              </span>
              <span className="flex items-center gap-2">
                <ReceiptText size={14} />
                Signed RSA-4096 Ledger
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400" />
                Live Webhook Sync
              </span>
            </div>
          </div>
        </section>

        {/* WALLET ACTIONS */}
        {isCustomer && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                Wallet Actions
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Fund your account or withdraw earnings securely through Vult.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* LOAD WALLET */}
              <button
                onClick={handleTopUp}
                className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-blue-300 hover:shadow-md transition"
              >
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition">
                  <ArrowDownToLine size={22} />
                </div>

                <h3 className="font-bold text-slate-900">
                  Load Wallet
                </h3>

                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Top up SLE or USD using Vult Mobile Money or Bank Card checkout.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">
                    <Smartphone size={13} />
                    Vult MoMo (SLE)
                  </span>

                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg">
                    <CreditCard size={13} />
                    Vult Card (USD)
                  </span>
                </div>

                <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-blue-600">
                  Start Vult top-up
                  <span aria-hidden="true">→</span>
                </div>
              </button>

              {/* RIDER PAYMENT */}
              {isRider && (
                <button
                  onClick={onSendMoney}
                  className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition"
                >
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition">
                    <Send size={22} />
                  </div>

                  <h3 className="font-bold text-slate-900">
                    Pay / Send Money
                  </h3>

                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    Pay MatMove drivers or merchants directly from your wallet balance.
                  </p>

                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-600">
                    Wallet-to-wallet payment
                    <span aria-hidden="true">→</span>
                  </div>
                </button>
              )}

              {/* WITHDRAWAL — AVAILABLE FOR ALL ROLES WHEN APPROVED */}
              <button
                onClick={handleWithdraw}
                disabled={!canWithdraw}
                aria-disabled={!canWithdraw}
                className={`group rounded-2xl p-5 text-left shadow-sm transition border ${
                  canWithdraw
                    ? 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-md cursor-pointer'
                    : 'bg-slate-100 border-slate-200 cursor-not-allowed'
                }`}
              >
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                    canWithdraw
                      ? 'bg-blue-50 text-blue-600 group-hover:bg-blue-100'
                      : 'bg-slate-200 text-slate-400'
                  }`}
                >
                  {canWithdraw ? (
                    <ArrowUpUpFromLine size={22} />
                  ) : (
                    <LockKeyhole size={22} />
                  )}
                </div>

                <div className="flex items-start justify-between gap-3">
                  <h3
                    className={`font-bold ${
                      canWithdraw ? 'text-slate-900' : 'text-slate-500'
                    }`}
                  >
                    Withdraw SLE
                  </h3>

                  <span
                    className={`text-[10px] uppercase tracking-wide font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                      canWithdraw
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {canWithdraw ? 'Available' : 'Locked'}
                  </span>
                </div>

                <p
                  className={`text-sm mt-1 leading-relaxed ${
                    canWithdraw ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  {withdrawalStatusDescription}
                </p>

                <div
                  className={`mt-4 inline-flex items-center gap-2 text-xs font-bold ${
                    canWithdraw ? 'text-blue-600' : 'text-slate-400'
                  }`}
                >
                  {withdrawalStatusLabel}
                  {canWithdraw && <span aria-hidden="true">→</span>}
                </div>
              </button>
            </div>
          </section>
        )}

        {/* VERIFICATION WARNING IF NOT APPROVED */}
        {!isVerified && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <LockKeyhole
                size={19}
                className="text-amber-600 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-bold text-amber-900">
                  Cash withdrawal requires identity approval
                </p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  You can still access your dashboard, load funds via Vult, and make/receive internal payments. Admin approval is required before you can perform external cash withdrawals to Mobile Money.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* VULT SECURITY SUMMARY */}
        <section className="bg-slate-100 border border-slate-200 rounded-3xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-600 shrink-0">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">
                Vult Payment Security
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                MatMove processes financial transactions through encrypted Vult API integrations[cite: 1].
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SecurityItem
              title="RSA-4096 Signatures"
              text="Payment requests are signed on the backend using RSA-4096 cryptographic signatures[cite: 1]."
            />
            <SecurityItem
              title="Basic Auth Webhooks"
              text="Provider notifications are protected with Basic Auth to prevent unauthorized manipulation[cite: 1]."
            />
            <SecurityItem
              title="Protected Cashouts"
              text="Withdrawals require KYC approval and real-time backend ledger reconciliation."
            />
            <SecurityItem
              title="No Raw Card Storage"
              text="Credit and debit cards are processed securely by Vult without touching MatMove servers."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function CurrencyBalanceCard({
  currency,
  balance,
  reserved,
  frozen,
  label,
  description,
  icon,
}: {
  currency: WalletCurrency;
  balance: number;
  reserved: number;
  frozen: boolean;
  label: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {currency}
            </div>
            <div className="font-bold text-slate-900">{label}</div>
          </div>
        </div>

        {frozen && (
          <span className="text-[10px] uppercase tracking-wide font-bold bg-red-50 text-red-700 px-2 py-1 rounded-full">
            Frozen
          </span>
        )}
      </div>

      <div className="text-2xl font-bold text-slate-900 mt-5">
        {formatMoney(balance, currency)}
      </div>

      <p className="text-xs text-slate-500 mt-1">{description}</p>

      {reserved > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Reserved
          </div>
          <div className="text-sm font-bold text-amber-900 mt-1">
            {formatMoney(reserved, currency)}
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-white rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
        <h3 className="font-bold text-sm text-slate-900">{title}</h3>
      </div>
      <p className="text-xs text-slate-500 mt-2 leading-relaxed">{text}</p>
    </div>
  );
}