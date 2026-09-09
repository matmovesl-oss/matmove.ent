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

interface WalletPageProps {
  profile?: any;
  wallet?: any;
  onClose?: () => void;
  onTopUp?: () => void;
  onWithdraw?: () => void;
  onSendMoney?: () => void;
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
    profile?.role || ''
  ).toLowerCase();

  const isRider =
    role === 'rider' || role === 'client';

  const isDriver = role === 'driver';

  const isMerchant =
    role === 'merchant' ||
    role === 'vendor';

  const isReceiver =
    isDriver || isMerchant;

  const balance = Number(
    wallet?.balance || 0
  );

  const reservedBalance = Number(
    wallet?.reserved_balance ||
      wallet?.reservedBalance ||
      0
  );

  const availableBalance = Math.max(
    0,
    balance - reservedBalance
  );

  const currency =
    wallet?.currency || 'SLE';

  const isFrozen =
    wallet?.frozen === true ||
    wallet?.is_frozen === true ||
    wallet?.isFrozen === true;

  /*
   * MatMove verification rule:
   *
   * Driver and merchant withdrawals are only
   * available after KYC/business verification
   * has been approved by MatMove Admin.
   *
   * We intentionally require an explicit
   * "approved" status. Missing/unknown status
   * therefore remains locked.
   */
  const verificationStatus = String(
    profile?.kyc_status ||
      profile?.kycStatus ||
      profile?.verification_status ||
      profile?.verificationStatus ||
      ''
  ).toLowerCase();

  const isVerified =
    verificationStatus === 'approved';

  const hasAvailableBalance =
    availableBalance > 0;

  const canWithdraw =
    isReceiver &&
    isVerified &&
    !isFrozen &&
    hasAvailableBalance;

  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name
      ?.split(' ')
      ?.filter(Boolean)?.[0] ||
    'User';

  const roleLabel = isRider
    ? 'Rider Wallet'
    : isDriver
      ? 'Driver Wallet'
      : isMerchant
        ? 'Merchant Wallet'
        : 'MatMove Wallet';

  const roleDescription = isRider
    ? 'Fund your wallet securely and use your MatMove balance to pay for services and purchases.'
    : isDriver
      ? 'Receive trip payments and securely withdraw your available earnings.'
      : isMerchant
        ? 'Receive customer payments and securely withdraw your business earnings.'
        : 'Manage your MatMove wallet and permitted transactions.';

  const withdrawalStatusLabel =
    !isVerified
      ? 'Verification Required'
      : isFrozen
        ? 'Wallet Frozen'
        : !hasAvailableBalance
          ? 'No Available Funds'
          : 'Withdraw Available Funds';

  const withdrawalStatusDescription =
    !isVerified
      ? isMerchant
        ? 'Merchant cash withdrawal becomes available after your business verification is approved by MatMove Admin.'
        : 'Driver cash withdrawal becomes available after your account verification is approved by MatMove Admin.'
      : isFrozen
        ? 'This wallet is currently restricted and cannot process withdrawals.'
        : !hasAvailableBalance
          ? reservedBalance > 0
            ? 'Some funds are reserved for a pending financial operation. Your remaining available balance can be withdrawn once funds are released.'
            : 'There are currently no funds available for withdrawal.'
          : 'Withdraw your available earnings through a secure supported cash-out method.';

  const handleWithdraw = () => {
    if (!canWithdraw) {
      return;
    }

    onWithdraw?.();
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
        {/* =========================
            BALANCE
           ========================= */}

        <section className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg overflow-hidden relative">
          <div className="absolute -right-20 -top-20 w-56 h-56 rounded-full bg-blue-500/10" />
          <div className="absolute -right-10 -bottom-24 w-48 h-48 rounded-full bg-emerald-500/10" />

          <div className="relative">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
                  <Wallet size={18} />
                  Available Balance
                </div>

                <div className="text-4xl sm:text-5xl font-bold mt-3 tracking-tight">
                  {currency}{' '}
                  {availableBalance.toLocaleString(
                    undefined,
                    {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-3">
                  Your available MatMove wallet balance.
                </p>

                {reservedBalance > 0 && (
                  <p className="text-xs text-amber-300 mt-2">
                    {currency}{' '}
                    {reservedBalance.toLocaleString(
                      undefined,
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }
                    )}{' '}
                    currently reserved for a pending financial operation.
                  </p>
                )}
              </div>

              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                <LockKeyhole size={22} />
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
            PRIMARY ACTIONS
           ========================= */}

        <section>
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900">
              Wallet Actions
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              {isRider
                ? 'Choose what you want to do with your MatMove wallet.'
                : 'Manage money received through your MatMove account.'}
            </p>
          </div>

          {/* =========================
              RIDER ACTIONS
             ========================= */}

          {isRider && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={onTopUp}
                className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-blue-300 hover:shadow-md transition"
              >
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition">
                  <ArrowDownToLine size={22} />
                </div>

                <h3 className="font-bold text-slate-900">
                  Load Wallet
                </h3>

                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Add money to your MatMove wallet using Mobile Money or
                  a supported bank card.
                </p>

                <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-blue-600">
                  Start wallet funding
                  <span aria-hidden="true">→</span>
                </div>
              </button>

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
                  Pay MatMove drivers or merchants directly from your
                  available wallet balance.
                </p>

                <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-600">
                  Wallet-to-wallet payment
                  <span aria-hidden="true">→</span>
                </div>
              </button>
            </div>
          )}

          {/* =========================
              DRIVER / MERCHANT ACTIONS
             ========================= */}

          {isReceiver && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
                  <Banknote size={22} />
                </div>

                <h3 className="font-bold text-slate-900">
                  Receive Payments
                </h3>

                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  {isDriver
                    ? 'Receive customer and trip payments directly into your MatMove wallet.'
                    : 'Receive customer payments directly into your merchant wallet.'}
                </p>

                <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                  <CheckCircle2 size={14} />
                  Incoming payments enabled
                </div>
              </div>

              {/* =========================
                  WITHDRAWAL CONTROL
                 ========================= */}

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
                    Withdraw Cash
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
            </div>
          )}

          {/* =========================
              VERIFICATION NOTICE
             ========================= */}

          {isReceiver && !isVerified && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <LockKeyhole
                  size={18}
                  className="text-amber-600 mt-0.5 shrink-0"
                />

                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Cash withdrawal is locked
                  </p>

                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    {isMerchant
                      ? 'Your merchant wallet can receive customer payments, but cash withdrawal will remain locked until MatMove Admin approves your business verification.'
                      : 'Your driver wallet can receive trip earnings, but cash withdrawal will remain locked until MatMove Admin approves your account verification.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isReceiver && isVerified && isFrozen && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <LockKeyhole
                  size={18}
                  className="text-red-600 mt-0.5 shrink-0"
                />

                <div>
                  <p className="text-sm font-bold text-red-900">
                    Wallet withdrawals are temporarily locked
                  </p>

                  <p className="text-xs text-red-800 mt-1 leading-relaxed">
                    Your account has an active wallet restriction.
                    Withdrawals cannot be initiated until the restriction
                    is removed by the appropriate MatMove process.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* =========================
            RIDER WALLET FUNDING
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
                  Select your funding method before entering your
                  payment information.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Mobile Money */}

              <div className="border border-slate-200 rounded-2xl p-5 hover:border-blue-200 transition">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4">
                  <Smartphone size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-blue-600">
                  Method 01
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Mobile Money
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Choose Mobile Money first, then enter the amount and
                  mobile-money number.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Choose Mobile Money" />
                  <Step text="Enter amount and number" />
                  <Step text="Complete secure provider checkout" />
                  <Step text="MatMove credits after confirmation" />
                </div>
              </div>

              {/* Bank Card */}

              <div className="border border-slate-200 rounded-2xl p-5 hover:border-emerald-200 transition">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
                  <CreditCard size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                  Method 02
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Bank Card
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Choose Card first, enter the amount, then continue to
                  secure card checkout.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Choose Bank Card" />
                  <Step text="Enter amount" />
                  <Step text="Complete secure Visa/Mastercard checkout" />
                  <Step text="MatMove credits after confirmation" />
                </div>
              </div>

              {/* MatMove Ledger */}

              <div className="border border-slate-200 rounded-2xl p-5 hover:border-purple-200 transition">
                <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center mb-4">
                  <Landmark size={19} />
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-purple-600">
                  MatMove Ledger
                </div>

                <h3 className="font-bold text-slate-900 mt-1">
                  Wallet Settlement
                </h3>

                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  External payment confirmation is reconciled with the
                  MatMove wallet and central ledger.
                </p>

                <div className="mt-4 text-xs text-slate-600 space-y-2">
                  <Step text="Provider confirms transaction" />
                  <Step text="MatMove verifies the reference" />
                  <Step text="Ledger records the movement" />
                  <Step text="User wallet is updated" />
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
                  MatMove should not store raw bank-card details or rely
                  on a button click to credit a wallet. The payment
                  provider must confirm the transaction first, after
                  which the MatMove backend records the transaction and
                  updates the wallet ledger.
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
                  Customer wallet → your wallet
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
                    ? 'Secure withdrawal available'
                    : 'Withdrawal locked'}
                </div>

                <p className="text-xs text-slate-600 mt-1">
                  {canWithdraw
                    ? 'Withdrawal is completed only after the payout process is confirmed.'
                    : 'Admin verification is required before cash withdrawal becomes available.'}
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
                  Driver and merchant balances are controlled by the
                  MatMove transaction ledger. A withdrawal request should
                  never directly modify the wallet balance from the
                  browser.
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
                  Your wallet ledger will show funding, payments,
                  earnings, withdrawals, fees, and reversals.
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
              No transactions yet
            </h3>

            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              Once you load your wallet, pay, receive money, complete
              trips, or withdraw funds, your confirmed transactions will
              appear here.
            </p>
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
                MatMove separates the user interface from the financial
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
              text="Every wallet movement should have a corresponding MatMove ledger transaction."
            />

            <SecurityItem
              title="No raw card storage"
              text="Card details should be handled by the approved payment provider rather than stored by MatMove."
            />

            <SecurityItem
              title="Withdrawal protection"
              text="Cash-out requests require approved verification, available balance, and provider confirmation before final settlement."
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
                Available wallet operations depend on your MatMove
                account role and verification status.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isRider && (
              <>
                <PermissionItem
                  allowed
                  text="Load wallet"
                />

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
                  allowed={canWithdraw}
                  text={
                    canWithdraw
                      ? 'Withdraw available funds'
                      : 'Withdraw available funds — Admin verification required'
                  }
                />

                <PermissionItem
                  allowed={false}
                  text="Customer wallet top-up"
                />

                <PermissionItem
                  allowed={false}
                  text="Outgoing wallet payments"
                />
              </>
            )}
          </div>
        </section>
      </main>
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