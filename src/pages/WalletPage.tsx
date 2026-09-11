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

type WalletCurrency =
  | 'SLE'
  | 'USD';

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

function normalizeCurrency(
  value: unknown
): WalletCurrency {
  return String(
    value || ''
  ).toUpperCase() === 'USD'
    ? 'USD'
    : 'SLE';
}

function formatMoney(
  value: number,
  currency: WalletCurrency
) {
  return `${currency} ${value.toLocaleString(
    undefined,
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  )}`;
}

function getWalletBalance(
  wallet?: WalletRecord
) {
  const value = Number(
    wallet?.balance || 0
  );

  return Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function getReservedBalance(
  wallet?: WalletRecord
) {
  const value = Number(
    wallet?.reserved_balance || 0
  );

  return Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function getAvailableBalance(
  wallet?: WalletRecord
) {
  const balance =
    getWalletBalance(wallet);

  const reserved =
    getReservedBalance(wallet);

  return Math.max(
    0,
    balance - reserved
  );
}

function isWalletFrozen(
  wallet?: WalletRecord
) {
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
  const role: WalletRole =
    String(
      profile?.role ||
        profile?.customer_role ||
        profile?.customerRole ||
        ''
    ).toLowerCase();

  const isRider =
    role === 'rider' ||
    role === 'client';

  const isDriver =
    role === 'driver';

  const isMerchant =
    role === 'merchant' ||
    role === 'vendor';

  const isCustomer =
    isRider ||
    isDriver ||
    isMerchant;

  const isReceiver =
    isDriver ||
    isMerchant;

  /*
   * =========================================================
   * IMPORTANT CUSTOMER WALLET RULE
   * =========================================================
   *
   * Wallet access is NOT controlled by KYC status.
   *
   * A registered Rider, Driver, or Merchant can:
   *
   * - access the dashboard
   * - access the wallet
   * - view SLE/USD balances
   * - load their wallet
   *
   * Driver/Merchant KYC approval is only required
   * for cash withdrawal.
   *
   * Backend financial RPCs and provider webhooks
   * remain authoritative for actual money movement.
   */

  const walletList =
    Array.isArray(
      wallet?.wallets
    )
      ? wallet.wallets
      : wallet
        ? [wallet]
        : [];

  const sleWallet =
    walletList.find(
      (item) =>
        normalizeCurrency(
          item.currency
        ) === 'SLE'
    );

  const usdWallet =
    walletList.find(
      (item) =>
        normalizeCurrency(
          item.currency
        ) === 'USD'
    );

  const resolvedSleWallet =
    sleWallet ||
    (normalizeCurrency(
      wallet?.currency
    ) === 'SLE'
      ? wallet
      : undefined);

  const resolvedUsdWallet =
    usdWallet ||
    (normalizeCurrency(
      wallet?.currency
    ) === 'USD'
      ? wallet
      : undefined);

  /*
   * =========================================================
   * SLE
   * =========================================================
   */

  const sleBalance =
    getWalletBalance(
      resolvedSleWallet
    );

  const sleReserved =
    getReservedBalance(
      resolvedSleWallet
    );

  const sleAvailable =
    getAvailableBalance(
      resolvedSleWallet
    );

  const sleFrozen =
    isWalletFrozen(
      resolvedSleWallet
    );

  /*
   * =========================================================
   * USD
   * =========================================================
   */

  const usdBalance =
    getWalletBalance(
      resolvedUsdWallet
    );

  const usdReserved =
    getReservedBalance(
      resolvedUsdWallet
    );

  const usdAvailable =
    getAvailableBalance(
      resolvedUsdWallet
    );

  const usdFrozen =
    isWalletFrozen(
      resolvedUsdWallet
    );

  /*
   * =========================================================
   * PRIMARY BALANCE
   * =========================================================
   */

  const primaryCurrency: WalletCurrency =
    !resolvedSleWallet &&
    !!resolvedUsdWallet
      ? 'USD'
      : 'SLE';

  const primaryBalance =
    primaryCurrency === 'USD'
      ? usdAvailable
      : sleAvailable;

  const primaryReserved =
    primaryCurrency === 'USD'
      ? usdReserved
      : sleReserved;

  const primaryFrozen =
    primaryCurrency === 'USD'
      ? usdFrozen
      : sleFrozen;

  /*
   * =========================================================
   * KYC
   * =========================================================
   *
   * KYC ONLY controls withdrawal for drivers
   * and merchants.
   */

  const verificationStatus =
    String(
      profile?.kyc_status ||
        profile?.kycStatus ||
        profile?.verification_status ||
        profile?.verificationStatus ||
        ''
    )
      .trim()
      .toLowerCase();

  const isVerified =
    verificationStatus ===
    'approved';

  /*
   * =========================================================
   * WITHDRAWAL
   * =========================================================
   */

  const hasAvailableSleBalance =
    sleAvailable > 0;

  const canWithdraw =
    isReceiver &&
    isVerified &&
    !sleFrozen &&
    hasAvailableSleBalance;

  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name
      ?.split(' ')
      ?.filter(Boolean)?.[0] ||
    'User';

  const roleLabel =
    isRider
      ? 'Rider Wallet'
      : isDriver
        ? 'Driver Wallet'
        : isMerchant
          ? 'Merchant Wallet'
          : 'MatMove Wallet';

  const roleDescription =
    isRider
      ? 'Fund your wallet and use your MatMove balance to pay for services and purchases.'
      : isDriver
        ? 'Receive MatMove payments, load your wallet, and withdraw available earnings after verification.'
        : isMerchant
          ? 'Receive customer payments, load your wallet, and withdraw available earnings after verification.'
          : 'Manage your MatMove wallet and permitted transactions.';

  const withdrawalStatusLabel =
    !isVerified
      ? 'Verification Required'
      : sleFrozen
        ? 'Wallet Frozen'
        : !hasAvailableSleBalance
          ? 'No Available SLE Funds'
          : 'Withdraw Available SLE Funds';

  const withdrawalStatusDescription =
    !isVerified
      ? isMerchant
        ? 'You can receive and hold funds, but cash withdrawal becomes available after MatMove Admin approves your business verification.'
        : 'You can receive and hold funds, but cash withdrawal becomes available after MatMove Admin approves your account verification.'
      : sleFrozen
        ? 'Your SLE wallet is currently restricted and cannot process withdrawals.'
        : !hasAvailableSleBalance
          ? sleReserved > 0
            ? `${formatMoney(
                sleReserved,
                'SLE'
              )} is reserved for a pending financial operation. Your remaining available balance can be withdrawn once funds are released.`
            : 'There are currently no SLE funds available for withdrawal.'
          : 'Withdraw your available SLE earnings through a secure supported Mobile Money method.';

  const handleWithdraw =
    () => {
      if (!canWithdraw) {
        return;
      }

      onWithdraw?.();
    };

  /*
   * A registered customer always has wallet
   * funding access from this page.
   *
   * No KYC check is performed here.
   */
  const handleTopUp =
    () => {
      if (!isCustomer) {
        return;
      }

      onTopUp?.();
    };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-10">
      {/* =========================
          HEADER
         ========================= */}

      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Wallet size={19} />
              </div>

              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                MatMove Wallet
              </p>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-3">
              {roleLabel}
            </h1>

            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Hello, {firstName}.{' '}
              {roleDescription}
            </p>
          </div>

          {onClose && (
            <button
              onClick={
                onClose
              }
              className="p-2.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition shrink-0"
              aria-label="Close wallet"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">

        {/* =========================
            CURRENCY BALANCES
           ========================= */}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CurrencyBalanceCard
            currency="SLE"
            balance={
              sleAvailable
            }
            reserved={
              sleReserved
            }
            frozen={
              sleFrozen
            }
            label={
              isReceiver
                ? 'Earnings Wallet'
                : 'Spending Wallet'
            }
            description={
              isReceiver
                ? 'Receive MatMove payments and manage available SLE funds.'
                : 'Load and use your SLE MatMove balance.'
            }
            icon={
              <Banknote
                size={21}
              />
            }
          />

          <CurrencyBalanceCard
            currency="USD"
            balance={
              usdAvailable
            }
            reserved={
              usdReserved
            }
            frozen={
              usdFrozen
            }
            label="USD Wallet"
            description="Available for supported USD wallet funding and transactions."
            icon={
              <CreditCard
                size={21}
              />
            }
          />
        </section>

        {/* =========================
            PRIMARY BALANCE
           ========================= */}

        <section className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg overflow-hidden relative">
          <div className="absolute -right-20 -top-20 w-56 h-56 rounded-full bg-blue-500/10" />

          <div className="absolute -right-10 -bottom-24 w-48 h-48 rounded-full bg-emerald-500/10" />

          <div className="relative">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
                  <Wallet size={18} />

                  Available{' '}
                  {primaryCurrency}{' '}
                  Balance
                </div>

                <div className="text-4xl sm:text-5xl font-bold mt-3 tracking-tight">
                  {formatMoney(
                    primaryBalance,
                    primaryCurrency
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-3">
                  Your available MatMove wallet balance.
                </p>

                {primaryReserved >
                  0 && (
                  <p className="text-xs text-amber-300 mt-2">
                    {formatMoney(
                      primaryReserved,
                      primaryCurrency
                    )}{' '}
                    currently reserved for a pending financial operation.
                  </p>
                )}
              </div>

              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                {primaryFrozen ? (
                  <LockKeyhole
                    size={22}
                  />
                ) : (
                  <ShieldCheck
                    size={22}
                  />
                )}
              </div>
            </div>

            <div className="mt-7 pt-5 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <ShieldCheck
                  size={14}
                  className="text-emerald-400"
                />
                Secure wallet
              </span>

              <span className="flex items-center gap-2">
                <ReceiptText size={14} />
                Ledger protected
              </span>

              <span className="flex items-center gap-2">
                <CheckCircle2
                  size={14}
                  className="text-emerald-400"
                />
                Provider-confirmed transactions
              </span>
            </div>
          </div>
        </section>

        {/* =========================
            WALLET INFORMATION
           ========================= */}

        <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center shrink-0">
              <Landmark size={20} />
            </div>

            <div>
              <h2 className="font-bold text-slate-900">
                Your MatMove Wallets
              </h2>

              <p className="text-sm text-slate-500 mt-1">
                MatMove maintains separate SLE and USD wallet balances.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <WalletSummary
              currency="SLE"
              balance={
                sleBalance
              }
              available={
                sleAvailable
              }
              reserved={
                sleReserved
              }
              frozen={
                sleFrozen
              }
              description={
                isReceiver
                  ? 'Receive MatMove wallet payments and supported SLE funding.'
                  : 'Mobile Money funding and everyday MatMove spending.'
              }
            />

            <WalletSummary
              currency="USD"
              balance={
                usdBalance
              }
              available={
                usdAvailable
              }
              reserved={
                usdReserved
              }
              frozen={
                usdFrozen
              }
              description="Supported USD wallet funding through secure card checkout."
            />
          </div>
        </section>

        {/* =========================
            WALLET ACTIONS
           ========================= */}

        {isCustomer && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                Wallet Actions
              </h2>

              <p className="text-sm text-slate-500 mt-1">
                Manage your MatMove funds. Verification does not prevent
                wallet access or wallet funding.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

              {/* LOAD WALLET — ALL CUSTOMER ROLES */}

              <button
                onClick={
                  handleTopUp
                }
                className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-blue-300 hover:shadow-md transition"
              >
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition">
                  <ArrowDownToLine size={22} />
                </div>

                <h3 className="font-bold text-slate-900">
                  Load Wallet
                </h3>

                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Add money to your MatMove wallet using an available
                  payment provider.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">
                    <Smartphone size={13} />
                    SLE
                  </span>

                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg">
                    <CreditCard size={13} />
                    USD
                  </span>
                </div>

                <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-blue-600">
                  Start wallet funding
                  <span aria-hidden="true">
                    →
                  </span>
                </div>
              </button>

              {/* RIDER PAYMENT */}

              {isRider && (
                <button
                  onClick={
                    onSendMoney
                  }
                  className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-emerald-300 hover:shadow-md transition"
                >
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition">
                    <Send size={22} />
                  </div>

                  <h3 className="font-bold text-slate-900">
                    Pay / Send Money
                  </h3>

                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    Pay MatMove drivers or merchants directly from your
                    available wallet balance.
                  </p>

                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-600">
                    Wallet-to-wallet payment
                    <span aria-hidden="true">
                      →
                    </span>
                  </div>
                </button>
              )}

              {/* DRIVER / MERCHANT RECEIVE */}

              {isReceiver && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
                    <Banknote size={22} />
                  </div>

                  <h3 className="font-bold text-slate-900">
                    Receive Payments
                  </h3>

                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    {isDriver
                      ? 'Receive customer and trip payments directly into your MatMove SLE wallet.'
                      : 'Receive customer payments directly into your merchant SLE wallet.'}
                  </p>

                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                    <CheckCircle2 size={14} />
                    Incoming payments enabled
                  </div>
                </div>
              )}

              {/* DRIVER / MERCHANT WITHDRAW */}

              {isReceiver && (
                <button
                  onClick={
                    handleWithdraw
                  }
                  disabled={
                    !canWithdraw
                  }
                  aria-disabled={
                    !canWithdraw
                  }
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
                      <ArrowUpFromLine size={22} />
                    ) : (
                      <LockKeyhole size={22} />
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <h3
                      className={`font-bold ${
                        canWithdraw
                          ? 'text-slate-900'
                          : 'text-slate-500'
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
                      {canWithdraw
                        ? 'Available'
                        : 'Locked'}
                    </span>
                  </div>

                  <p
                    className={`text-sm mt-1 leading-relaxed ${
                      canWithdraw
                        ? 'text-slate-500'
                        : 'text-slate-400'
                    }`}
                  >
                    {withdrawalStatusDescription}
                  </p>

                  <div
                    className={`mt-4 inline-flex items-center gap-2 text-xs font-bold ${
                      canWithdraw
                        ? 'text-blue-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {withdrawalStatusLabel}

                    {canWithdraw && (
                      <span aria-hidden="true">
                        →
                      </span>
                    )}
                  </div>
                </button>
              )}
            </div>
          </section>
        )}

        {/* =========================
            DRIVER / MERCHANT NOTICE
           ========================= */}

        {isReceiver &&
          !isVerified && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <LockKeyhole
                size={19}
                className="text-amber-600 mt-0.5 shrink-0"
              />

              <div>
                <p className="text-sm font-bold text-amber-900">
                  Cash withdrawal is locked until verification
                </p>

                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  You still have full access to your MatMove wallet,
                  including wallet funding and receiving wallet-to-wallet
                  payments. Admin approval is required only before you can
                  withdraw funds to Mobile Money.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* =========================
            RIDER FUNDING
           ========================= */}

        {isRider && (
          <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                <CreditCard size={20} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  How Wallet Funding Works
                </h2>

                <p className="text-xs text-slate-500 mt-1">
                  Choose your funding method before entering your payment
                  information.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-slate-200 rounded-2xl p-5 hover:border-blue-200 transition">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4">
                  <Smartphone size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-blue-600">
                  SLE
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Mobile Money
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Fund your SLE wallet through a supported secure Mobile
                  Money checkout.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Choose Mobile Money" />
                  <Step text="Enter SLE amount" />
                  <Step text="Complete secure provider checkout" />
                  <Step text="MatMove credits after provider confirmation" />
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5 hover:border-emerald-200 transition">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
                  <CreditCard size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                  USD
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Bank Card
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Fund your USD wallet through secure Visa/Mastercard
                  checkout.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Choose Bank Card" />
                  <Step text="Enter USD amount" />
                  <Step text="Complete secure card checkout" />
                  <Step text="MatMove credits after provider confirmation" />
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5 hover:border-purple-200 transition">
                <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center mb-4">
                  <Landmark size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-purple-600">
                  MatMove
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Ledger Settlement
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Provider confirmation is reconciled with the correct
                  currency wallet and MatMove ledger.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Provider confirms transaction" />
                  <Step text="MatMove verifies the reference" />
                  <Step text="Correct currency ledger is posted" />
                  <Step text="Wallet balance is updated" />
                </div>
              </div>
            </div>

            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
              <LockKeyhole
                size={18}
                className="text-slate-500 mt-0.5 shrink-0"
              />

              <div>
                <p className="text-xs font-bold text-slate-700">
                  Secure payment handling
                </p>

                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  MatMove does not store raw bank-card details or credit
                  wallet balances from a browser button click. The payment
                  provider confirms the transaction first, after which the
                  secure MatMove backend records and settles the transaction.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* =========================
            RECEIVING INFORMATION
           ========================= */}

        {isReceiver && (
          <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                <ArrowDownToLine size={20} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Incoming Payments
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  Customers can pay you directly from their MatMove
                  wallet.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  Payment Type
                </div>

                <div className="font-bold text-slate-900 mt-1">
                  Wallet-to-wallet
                </div>

                <p className="text-xs text-slate-600 mt-1">
                  Customer wallet → Driver/Merchant wallet
                </p>
              </div>

              <div
                className={`rounded-2xl p-4 border ${
                  canWithdraw
                    ? 'bg-blue-50 border-blue-100'
                    : 'bg-amber-50 border-amber-100'
                }`}
              >
                <div
                  className={`text-xs font-bold uppercase tracking-wider ${
                    canWithdraw
                      ? 'text-blue-700'
                      : 'text-amber-700'
                  }`}
                >
                  Cash Out
                </div>

                <div className="font-bold text-slate-900 mt-1">
                  {canWithdraw
                    ? 'Secure SLE withdrawal available'
                    : 'Withdrawal locked'}
                </div>

                <p className="text-xs text-slate-600 mt-1">
                  {canWithdraw
                    ? 'Withdrawal is completed only after Mobile Money payout confirmation.'
                    : 'Admin verification is required before cash withdrawal.'}
                </p>
              </div>
            </div>

            <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={18}
                  className="text-emerald-600 mt-0.5 shrink-0"
                />

                <p className="text-xs text-slate-600 leading-relaxed">
                  Incoming wallet-to-wallet payments are separate from
                  cash withdrawal approval. A Driver or Merchant can
                  receive MatMove wallet payments while verification is
                  still pending.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* =========================
            TRANSACTION HISTORY
           ========================= */}

        <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center shrink-0">
                <History size={20} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900 text-lg">
                  Transaction History
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  Your wallet transaction history will appear here.
                </p>
              </div>
            </div>
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-2xl py-12 px-6 text-center">
            <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <History
                size={28}
                className="text-slate-300"
              />
            </div>

            <h3 className="font-bold text-slate-900">
              No transactions displayed yet
            </h3>

            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              Wallet transactions will appear here as the live transaction
              history feed is connected.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">
              <ReceiptText size={14} />
              Live ledger history
            </div>
          </div>
        </section>

        {/* =========================
            WALLET SECURITY
           ========================= */}

        <section className="bg-slate-100 border border-slate-200 rounded-3xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-600 shrink-0">
              <ShieldCheck size={20} />
            </div>

            <div>
              <h2 className="font-bold text-slate-900">
                Wallet Security
              </h2>

              <p className="text-xs text-slate-500 mt-1">
                MatMove separates the customer interface from the financial
                ledger and external payment providers.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SecurityItem
              title="Provider confirmation"
              text="External Mobile Money and card transactions must be confirmed before funds are credited."
            />

            <SecurityItem
              title="Central ledger"
              text="Every wallet movement must have a corresponding MatMove ledger transaction."
            />

            <SecurityItem
              title="No raw card storage"
              text="Card details are handled by the approved payment provider rather than stored by MatMove."
            />

            <SecurityItem
              title="Withdrawal protection"
              text="Driver and merchant cash-out requires Admin verification, available SLE funds, and provider confirmation."
            />
          </div>
        </section>

        {/* =========================
            WALLET PERMISSIONS
           ========================= */}

        <section className="bg-slate-100 border border-slate-200 rounded-3xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-600 shrink-0">
              <ShieldCheck size={20} />
            </div>

            <div>
              <h2 className="font-bold text-slate-900">
                Wallet Permissions
              </h2>

              <p className="text-xs text-slate-500 mt-1">
                Verification controls restricted operations, not basic
                wallet access.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">

            {isCustomer && (
              <>
                <PermissionItem
                  allowed
                  text="Access MatMove wallet"
                />

                <PermissionItem
                  allowed
                  text="Load MatMove wallet"
                />

                <PermissionItem
                  allowed
                  text="View SLE and USD balances"
                />
              </>
            )}

            {isRider && (
              <>
                <PermissionItem
                  allowed
                  text="Pay drivers and merchants"
                />

                <PermissionItem
                  allowed={false}
                  text="Cash withdrawal"
                />
              </>
            )}

            {isReceiver && (
              <>
                <PermissionItem
                  allowed
                  text="Receive wallet-to-wallet payments"
                />

                <PermissionItem
                  allowed={
                    canWithdraw
                  }
                  text={
                    canWithdraw
                      ? 'Withdraw available SLE funds'
                      : 'Cash withdrawal — Admin verification required'
                  }
                />
              </>
            )}
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

            <div className="font-bold text-slate-900">
              {label}
            </div>
          </div>
        </div>

        {frozen && (
          <span className="text-[10px] uppercase tracking-wide font-bold bg-red-50 text-red-700 px-2 py-1 rounded-full">
            Frozen
          </span>
        )}
      </div>

      <div className="text-2xl font-bold text-slate-900 mt-5">
        {formatMoney(
          balance,
          currency
        )}
      </div>

      <p className="text-xs text-slate-500 mt-1">
        {description}
      </p>

      {reserved >
        0 && (
        <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Reserved
          </div>

          <div className="text-sm font-bold text-amber-900 mt-1">
            {formatMoney(
              reserved,
              currency
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WalletSummary({
  currency,
  balance,
  available,
  reserved,
  frozen,
  description,
}: {
  currency: WalletCurrency;
  balance: number;
  available: number;
  reserved: number;
  frozen: boolean;
  description: string;
}) {
  return (
    <div className="border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {currency} Wallet
        </div>

        <span
          className={`text-[10px] uppercase tracking-wide font-bold px-2 py-1 rounded-full ${
            frozen
              ? 'bg-red-50 text-red-700'
              : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {frozen
            ? 'Frozen'
            : 'Active'}
        </span>
      </div>

      <div className="mt-4">
        <div className="text-xs text-slate-400">
          Total balance
        </div>

        <div className="text-xl font-bold text-slate-900 mt-1">
          {formatMoney(
            balance,
            currency
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="text-xs text-slate-400">
          Available
        </div>

        <div className="font-bold text-emerald-700 mt-1">
          {formatMoney(
            available,
            currency
          )}
        </div>
      </div>

      {reserved >
        0 && (
        <div className="mt-3">
          <div className="text-xs text-slate-400">
            Reserved
          </div>

          <div className="font-semibold text-amber-700 mt-1">
            {formatMoney(
              reserved,
              currency
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function Step({
  text,
}: {
  text: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2
        size={14}
        className="text-emerald-600 mt-0.5 shrink-0"
      />

      <span>{text}</span>
    </div>
  );
}

function SecurityItem({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2
          size={16}
          className="text-emerald-600 shrink-0"
        />

        <h3 className="font-bold text-sm text-slate-900">
          {title}
        </h3>
      </div>

      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
        {text}
      </p>
    </div>
  );
}

function PermissionItem({
  allowed,
  text,
}: {
  allowed: boolean;
  text: string;
}) {
  return (
    <div
      className={`rounded-xl p-3 flex items-center gap-2 text-sm ${
        allowed
          ? 'bg-white text-slate-700'
          : 'bg-slate-200/70 text-slate-500'
      }`}
    >
      {allowed ? (
        <CheckCircle2
          size={16}
          className="text-emerald-600 shrink-0"
        />
      ) : (
        <X
          size={16}
          className="text-slate-400 shrink-0"
        />
      )}

      <span>{text}</span>
    </div>
  );
}