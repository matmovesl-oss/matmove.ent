import {
  Store,
  Package,
  ShoppingBag,
  TrendingUp,
  Wallet,
  Bell,
  AlertCircle,
  ShieldCheck,
  Clock,
  Truck,
  Boxes,
  Settings,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

type MerchantDashboardProps = {
  profile?: any;
  wallet?: any;
  onOpenWithdraw?: () => void;
};

type StoreMode = 'open' | 'closed';

type MerchantStat = {
  label: string;
  value: string;
  helper: string;
  icon: any;
  iconClass: string;
};

export function MerchantDashboard({
  profile,
  wallet,
  onOpenWithdraw,
}: MerchantDashboardProps) {
  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name?.split(' ')?.[0] ||
    'Merchant';

  const businessName =
    profile?.business_name ||
    profile?.businessName ||
    profile?.store_name ||
    profile?.merchant_name ||
    'Your Store';

  const businessAddress =
    profile?.business_address ||
    profile?.businessAddress ||
    profile?.address ||
    'Business location not yet configured';

  const kycStatus = String(
    profile?.kyc_status || 'not_started'
  ).toLowerCase();

  const verificationPending = [
    'pending',
    'submitted',
    'under_review',
    'draft',
  ].includes(kycStatus);

  const verificationApproved =
    kycStatus === 'approved';

  const verificationRejected = [
    'rejected',
    'resubmission_required',
  ].includes(kycStatus);

  /*
   * Merchant financial permissions are intentionally tied
   * to successful admin verification.
   *
   * This is a UI permission gate. The backend must remain
   * the final authority for all financial operations.
   */
  const canAcceptOrders =
    verificationApproved;

  const canWithdraw =
    verificationApproved;

  const wallets =
    Array.isArray(wallet?.wallets)
      ? wallet.wallets
      : wallet
        ? [wallet]
        : [];

  const sleWallet =
    wallets.find(
      (item: any) =>
        String(
          item?.currency || ''
        ).toUpperCase() === 'SLE'
    ) ||
    (String(
      wallet?.currency || ''
    ).toUpperCase() === 'SLE'
      ? wallet
      : null);

  const usdWallet =
    wallets.find(
      (item: any) =>
        String(
          item?.currency || ''
        ).toUpperCase() === 'USD'
    );

  const sleBalance =
    Number(
      sleWallet?.balance || 0
    );

  const usdBalance =
    Number(
      usdWallet?.balance || 0
    );

  const [storeMode, setStoreMode] =
    useState<StoreMode>(
      canAcceptOrders
        ? 'open'
        : 'closed'
    );

  const [refreshing, setRefreshing] =
    useState(false);

  const storeIsOpen =
    canAcceptOrders &&
    storeMode === 'open';

  const storeStatusLabel =
    storeIsOpen
      ? 'ACCEPTING ORDERS'
      : 'STORE CLOSED';

  const handleOpenWithdraw =
    () => {
      if (!canWithdraw) {
        return;
      }

      onOpenWithdraw?.();
    };

  const stats =
    useMemo<MerchantStat[]>(
      () => [
        {
          label: "Today's Revenue",
          value: 'SLE 0.00',
          helper:
            'Live sales data will appear here.',
          icon: TrendingUp,
          iconClass:
            'bg-emerald-50 text-emerald-600',
        },
        {
          label: 'Merchant Wallet',
          value: `SLE ${sleBalance.toLocaleString(
            undefined,
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}`,
          helper:
            usdWallet
              ? `USD ${usdBalance.toLocaleString(
                  undefined,
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )} available`
              : 'SLE wallet available',
          icon: Wallet,
          iconClass:
            'bg-blue-50 text-blue-600',
        },
        {
          label: 'Pending Orders',
          value: '0',
          helper:
            'Live merchant orders will appear here.',
          icon: ShoppingBag,
          iconClass:
            'bg-amber-50 text-amber-600',
        },
        {
          label: 'Active Deliveries',
          value: '0',
          helper:
            'Dispatched orders will appear here.',
          icon: Truck,
          iconClass:
            'bg-purple-50 text-purple-600',
        },
      ],
      [
        sleBalance,
        usdBalance,
        usdWallet,
      ]
    );

  const handleToggleStore =
    () => {
      if (!canAcceptOrders) {
        return;
      }

      setStoreMode(
        (current) =>
          current === 'open'
            ? 'closed'
            : 'open'
      );
    };

  const handleRefresh =
    () => {
      setRefreshing(true);

      setTimeout(() => {
        setRefreshing(false);
      }, 700);
    };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen pb-28">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col xl:flex-row xl:justify-between xl:items-center gap-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">
                Merchant Portal
              </span>

              <span className="text-slate-300">
                /
              </span>

              <span className="text-[11px] font-semibold text-slate-500">
                {businessName}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Welcome, {firstName}
            </h1>

            <p className="text-sm text-slate-500 mt-1">
              Manage your store, orders, inventory, dispatch and earnings.
            </p>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={handleRefresh}
              className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center transition"
              aria-label="Refresh merchant dashboard"
            >
              <RefreshCw
                size={18}
                className={
                  refreshing
                    ? 'animate-spin'
                    : ''
                }
              />
            </button>

            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-full px-3">
              <span className="text-xs font-bold text-slate-600 hidden sm:block">
                Store:
              </span>

              <button
                type="button"
                disabled={!canAcceptOrders}
                onClick={handleToggleStore}
                className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                  !canAcceptOrders
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : storeIsOpen
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-500 text-white'
                }`}
              >
                {storeStatusLabel}
              </button>
            </div>

            <button
              type="button"
              className="w-10 h-10 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center relative transition"
              aria-label="Notifications"
            >
              <Bell size={20} />

              <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full" />
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        {/* Business identity */}
        <section className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Store size={27} />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">
                    {businessName}
                  </h2>

                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                      verificationApproved
                        ? 'bg-emerald-50 text-emerald-700'
                        : verificationRejected
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {verificationApproved
                      ? 'VERIFIED'
                      : verificationRejected
                        ? 'ACTION REQUIRED'
                        : 'UNDER REVIEW'}
                  </span>
                </div>

                <p className="text-sm text-slate-500 mt-1">
                  {businessAddress}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              <Settings size={17} />
              Store Settings
            </button>
          </div>
        </section>

        {/* Verification */}
        {verificationPending && (
          <section className="bg-amber-50 border border-amber-200 p-5 rounded-2xl flex items-start gap-3">
            <Clock
              className="text-amber-500 shrink-0 mt-0.5"
              size={24}
            />

            <div className="flex-1">
              <h4 className="font-bold text-amber-900">
                Business Verification In Progress
              </h4>

              <p className="text-sm text-amber-700 mt-1 leading-relaxed">
                Your business documents are being reviewed. Store visibility,
                live order acceptance and merchant cash withdrawal will become
                available after verification is approved.
              </p>
            </div>
          </section>
        )}

        {verificationRejected && (
          <section className="bg-rose-50 border border-rose-200 p-5 rounded-2xl flex items-start gap-3">
            <AlertCircle
              className="text-rose-500 shrink-0 mt-0.5"
              size={24}
            />

            <div className="flex-1">
              <h4 className="font-bold text-rose-900">
                Business Verification Needs Attention
              </h4>

              <p className="text-sm text-rose-700 mt-1 leading-relaxed">
                Your verification requires attention before your store can
                accept customer orders or withdraw merchant earnings.
              </p>

              <button
                type="button"
                className="mt-3 text-sm font-bold text-rose-700 hover:underline"
              >
                Review verification requirements →
              </button>
            </div>
          </section>
        )}

        {verificationApproved && (
          <section className="bg-emerald-50 border border-emerald-200 p-5 rounded-2xl flex items-start gap-3">
            <ShieldCheck
              className="text-emerald-600 shrink-0 mt-0.5"
              size={24}
            />

            <div className="flex-1">
              <h4 className="font-bold text-emerald-900">
                Business Verified
              </h4>

              <p className="text-sm text-emerald-700 mt-1">
                Your merchant account is verified and eligible to receive
                customer orders and access approved financial operations.
              </p>
            </div>

            <CircleCheck
              size={21}
              className="text-emerald-600 shrink-0"
            />
          </section>
        )}

        {/* Statistics */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Store Overview
              </h2>

              <p className="text-sm text-slate-500 mt-1">
                Your latest merchant activity.
              </p>
            </div>

            <span className="hidden sm:inline-flex text-xs font-semibold text-slate-400">
              Live data
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
            {stats.map((stat) => {
              const Icon = stat.icon;

              return (
                <div
                  key={stat.label}
                  className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-5">
                    <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                      {stat.label}
                    </span>

                    <div
                      className={`p-2.5 rounded-xl ${stat.iconClass}`}
                    >
                      <Icon size={18} />
                    </div>
                  </div>

                  <div className="text-2xl sm:text-3xl font-bold text-slate-900">
                    {stat.value}
                  </div>

                  <p className="text-xs text-slate-400 mt-2">
                    {stat.helper}
                  </p>

                  {stat.label === 'Merchant Wallet' && (
                    <button
                      type="button"
                      disabled={!canWithdraw}
                      onClick={handleOpenWithdraw}
                      className={`text-xs font-bold mt-3 transition ${
                        canWithdraw
                          ? 'text-blue-600 hover:underline'
                          : 'text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {canWithdraw
                        ? 'Withdraw Cash →'
                        : 'Verification Required'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">
              Store Operations
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              The tools you will use to run your MatMove store.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <MerchantActionCard
              icon={<ShoppingBag size={21} />}
              iconClass="bg-blue-50 text-blue-600"
              title="Orders"
              description="Review, accept and prepare customer orders."
              badge="Live queue"
            />

            <MerchantActionCard
              icon={<Boxes size={21} />}
              iconClass="bg-purple-50 text-purple-600"
              title="Inventory"
              description="Manage products, stock levels and availability."
              badge="Inventory"
            />

            <MerchantActionCard
              icon={<Truck size={21} />}
              iconClass="bg-emerald-50 text-emerald-600"
              title="Dispatch"
              description="Prepare orders for delivery and monitor dispatch."
              badge="Operations"
            />

            <MerchantActionCard
              icon={<Wallet size={21} />}
              iconClass="bg-amber-50 text-amber-600"
              title="Earnings"
              description={
                canWithdraw
                  ? 'Review sales, wallet activity and withdrawals.'
                  : 'Wallet earnings are visible, but withdrawals require admin verification.'
              }
              badge={
                canWithdraw
                  ? 'Financials'
                  : 'Verification required'
              }
              onClick={
                canWithdraw
                  ? handleOpenWithdraw
                  : undefined
              }
              disabled={!canWithdraw}
            />
          </div>
        </section>

        {/* Order queue + readiness */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">
                  Live Order Queue
                </h3>

                <p className="text-xs text-slate-500 mt-1">
                  Customer orders will appear here for preparation and
                  dispatch.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full" />

                <span className="text-xs font-bold text-slate-500">
                  Auto-refresh active
                </span>
              </div>
            </div>

            <div className="border border-dashed border-slate-200 rounded-2xl min-h-[270px] flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <ShoppingBag
                  className="text-slate-300"
                  size={30}
                />
              </div>

              <h4 className="font-bold text-slate-900 text-lg">
                No active orders right now
              </h4>

              <p className="text-slate-500 text-sm mt-1 max-w-md leading-relaxed">
                When customers place an order from your store, it will
                appear here immediately for preparation and dispatch.
              </p>

              {!canAcceptOrders && (
                <div className="mt-5 inline-flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-700 px-3 py-2 rounded-xl text-xs font-semibold">
                  <CircleAlert size={15} />
                  Verification required before orders can be accepted.
                </div>
              )}
            </div>
          </div>

          {/* Readiness */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">
                  Store Readiness
                </h3>

                <p className="text-xs text-slate-500 mt-1">
                  Operational requirements.
                </p>
              </div>

              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  canAcceptOrders
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-amber-50 text-amber-600'
                }`}
              >
                {canAcceptOrders ? (
                  <CircleCheck size={20} />
                ) : (
                  <CircleAlert size={20} />
                )}
              </div>
            </div>

            <div className="space-y-4">
              <ReadinessRow
                icon={<ShieldCheck size={18} />}
                label="Business verification"
                status={
                  verificationApproved
                    ? 'Approved'
                    : verificationRejected
                      ? 'Action required'
                      : 'Pending'
                }
                tone={
                  verificationApproved
                    ? 'success'
                    : verificationRejected
                      ? 'danger'
                      : 'warning'
                }
              />

              <ReadinessRow
                icon={<Store size={18} />}
                label="Store status"
                status={
                  storeIsOpen
                    ? 'Open'
                    : 'Closed'
                }
                tone={
                  storeIsOpen
                    ? 'success'
                    : 'neutral'
                }
              />

              <ReadinessRow
                icon={<Package size={18} />}
                label="Inventory"
                status="Ready"
                tone="neutral"
              />

              <ReadinessRow
                icon={<Truck size={18} />}
                label="Dispatch"
                status="Ready"
                tone="neutral"
              />

              <ReadinessRow
                icon={<Wallet size={18} />}
                label="Cash withdrawal"
                status={
                  canWithdraw
                    ? 'Enabled'
                    : 'Verification required'
                }
                tone={
                  canWithdraw
                    ? 'success'
                    : 'warning'
                }
              />
            </div>

            {!canAcceptOrders && (
              <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle
                    size={18}
                    className="text-slate-400 shrink-0 mt-0.5"
                  />

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Customer order acceptance and merchant cash withdrawal
                    will be enabled once your business verification is
                    approved by MatMove Admin.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Wallet summary */}
        <section className="bg-slate-900 rounded-3xl p-6 sm:p-7 text-white overflow-hidden relative">
          <div className="absolute -right-20 -top-20 w-64 h-64 bg-blue-500/10 rounded-full" />
          <div className="absolute -right-10 -bottom-24 w-56 h-56 bg-emerald-500/10 rounded-full" />

          <div className="relative">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-blue-300 text-xs font-bold uppercase tracking-wider">
                  <Wallet size={15} />
                  MatMove Merchant Wallet
                </div>

                <div className="flex flex-wrap items-end gap-5 mt-3">
                  <div>
                    <div className="text-3xl sm:text-4xl font-bold">
                      SLE{' '}
                      {sleBalance.toLocaleString(
                        undefined,
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}
                    </div>

                    <p className="text-slate-400 text-sm mt-1">
                      Available SLE balance
                    </p>
                  </div>

                  {usdWallet && (
                    <div>
                      <div className="text-xl font-bold text-slate-200">
                        USD{' '}
                        {usdBalance.toLocaleString(
                          undefined,
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}
                      </div>

                      <p className="text-slate-500 text-xs mt-1">
                        Available USD balance
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-stretch lg:items-end gap-2">
                <button
                  type="button"
                  onClick={handleOpenWithdraw}
                  disabled={!canWithdraw}
                  className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition ${
                    canWithdraw
                      ? 'bg-white text-slate-900 hover:bg-slate-100'
                      : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {canWithdraw
                    ? 'Withdraw Cash'
                    : 'Verification Required'}
                  <ChevronRight size={17} />
                </button>

                {!canWithdraw && (
                  <span className="text-xs text-slate-400 text-center lg:text-right">
                    Admin approval is required before cash withdrawal.
                  </span>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 mt-6 pt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck
                  size={15}
                  className="text-emerald-400"
                />
                Secure wallet
              </span>

              <span className="inline-flex items-center gap-2">
                <CircleCheck
                  size={15}
                  className="text-emerald-400"
                />
                Ledger protected
              </span>

              <span className="inline-flex items-center gap-2">
                <CircleCheck
                  size={15}
                  className="text-emerald-400"
                />
                Provider-confirmed transactions
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MerchantActionCard({
  icon,
  iconClass,
  title,
  description,
  badge,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  description: string;
  badge: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm transition group ${
        disabled
          ? 'opacity-80 cursor-not-allowed'
          : 'hover:shadow-md hover:border-slate-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconClass}`}
        >
          {icon}
        </div>

        <ChevronRight
          size={18}
          className={
            disabled
              ? 'text-slate-200'
              : 'text-slate-300 group-hover:text-slate-500 transition'
          }
        />
      </div>

      <h3 className="font-bold text-slate-900 mt-4">
        {title}
      </h3>

      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
        {description}
      </p>

      <span
        className={`inline-flex mt-4 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
          disabled
            ? 'bg-amber-50 text-amber-700'
            : 'bg-slate-100 text-slate-500'
        }`}
      >
        {badge}
      </span>
    </button>
  );
}

function ReadinessRow({
  icon,
  label,
  status,
  tone,
}: {
  icon: ReactNode;
  label: string;
  status: string;
  tone:
    | 'success'
    | 'warning'
    | 'danger'
    | 'neutral';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'danger'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-slate-100 text-slate-600';

  const iconClass =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-rose-600'
          : 'text-slate-400';

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={iconClass}>
          {icon}
        </span>

        <span className="text-sm font-semibold text-slate-700 truncate">
          {label}
        </span>
      </div>

      <span
        className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${toneClass}`}
      >
        {status}
      </span>
    </div>
  );
}