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
} from 'lucide-react';

export function MerchantDashboard({
  profile,
  wallet,
  onOpenWithdraw,
}: any) {
  const firstName =
    profile?.first_name ||
    profile?.firstName ||
    profile?.full_name?.split(' ')?.[0] ||
    'Merchant';

  const kycStatus = profile?.kyc_status || 'not_started';

  const verificationPending = [
    'pending',
    'submitted',
    'under_review',
    'draft',
  ].includes(kycStatus);

  const verificationApproved = kycStatus === 'approved';

  const verificationRejected = [
    'rejected',
    'resubmission_required',
  ].includes(kycStatus);

  const canAcceptOrders = verificationApproved;

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 sticky top-0 z-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {firstName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your store, orders, inventory, and dispatch.
          </p>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-3 bg-slate-100 p-1.5 rounded-full px-3 sm:px-4">
            <span className="text-xs font-bold text-slate-600 hidden sm:block">
              Store Status:
            </span>

            <button
              disabled={!canAcceptOrders}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                !canAcceptOrders
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-emerald-500 text-white'
              }`}
            >
              {!canAcceptOrders
                ? 'VERIFICATION REQUIRED'
                : 'ACCEPTING ORDERS'}
            </button>
          </div>

          <button
            className="text-slate-400 hover:text-slate-600 relative"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        {/* Verification Status */}
        {verificationPending && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
            <Clock
              className="text-amber-500 shrink-0 mt-0.5"
              size={24}
            />

            <div>
              <h4 className="font-bold text-amber-900">
                Business Verification In Progress
              </h4>

              <p className="text-sm text-amber-700 mt-1">
                Your business documents are being reviewed. Store
                visibility and live order acceptance will become available
                after verification is approved.
              </p>
            </div>
          </div>
        )}

        {verificationRejected && (
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3">
            <AlertCircle
              className="text-rose-500 shrink-0 mt-0.5"
              size={24}
            />

            <div>
              <h4 className="font-bold text-rose-900">
                Business Verification Needs Attention
              </h4>

              <p className="text-sm text-rose-700 mt-1">
                Your business verification requires resubmission or has
                been rejected. Please review your verification requirements
                before accepting customer orders.
              </p>
            </div>
          </div>
        )}

        {verificationApproved && (
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-start gap-3">
            <ShieldCheck
              className="text-emerald-600 shrink-0 mt-0.5"
              size={24}
            />

            <div>
              <h4 className="font-bold text-emerald-900">
                Business Verified
              </h4>

              <p className="text-sm text-emerald-700 mt-1">
                Your merchant account is verified and eligible to receive
                customer orders.
              </p>
            </div>
          </div>
        )}

        {/* Top Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                Today's Revenue
              </span>

              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <TrendingUp size={18} />
              </div>
            </div>

            <div className="text-3xl font-bold text-slate-900">
              SLE 0.00
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                Merchant Wallet
              </span>

              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Wallet size={18} />
              </div>
            </div>

            <div className="text-3xl font-bold text-slate-900">
              SLE {Number(wallet?.balance || 0).toFixed(2)}
            </div>

            <button
              onClick={onOpenWithdraw}
              className="text-xs font-bold text-blue-600 mt-2 hover:underline text-left"
            >
              Withdraw Cash →
            </button>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                Pending Orders
              </span>

              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                <ShoppingBag size={18} />
              </div>
            </div>

            <div className="text-3xl font-bold text-slate-900">
              0
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">
                Active Deliveries
              </span>

              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <Package size={18} />
              </div>
            </div>

            <div className="text-3xl font-bold text-slate-900">
              0
            </div>
          </div>
        </div>

        {/* Store Operations */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
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

              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-3 py-1 rounded-full w-fit">
                Auto-refresh active
              </span>
            </div>

            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <Store className="text-slate-300" size={32} />
              </div>

              <h4 className="font-bold text-slate-900 text-lg">
                No active orders right now
              </h4>

              <p className="text-slate-500 text-sm mt-1 max-w-sm">
                When customers place an order from your store, it will
                appear here immediately for preparation and dispatch.
              </p>
            </div>
          </div>

          {/* Store Readiness */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 text-lg mb-5">
              Store Readiness
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck
                    size={18}
                    className={
                      verificationApproved
                        ? 'text-emerald-600'
                        : 'text-slate-400'
                    }
                  />

                  <span className="text-sm font-semibold text-slate-700">
                    Business verification
                  </span>
                </div>

                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    verificationApproved
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {verificationApproved ? 'Approved' : 'Pending'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Store size={18} className="text-slate-400" />

                  <span className="text-sm font-semibold text-slate-700">
                    Store status
                  </span>
                </div>

                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    canAcceptOrders
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {canAcceptOrders ? 'Open' : 'Closed'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Package size={18} className="text-slate-400" />

                  <span className="text-sm font-semibold text-slate-700">
                    Inventory
                  </span>
                </div>

                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                  Ready
                </span>
              </div>
            </div>

            {!canAcceptOrders && (
              <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle
                    size={18}
                    className="text-slate-400 shrink-0 mt-0.5"
                  />

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Customer order acceptance will be enabled once your
                    business verification is approved.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}