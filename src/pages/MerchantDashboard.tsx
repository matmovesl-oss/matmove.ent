import { useState } from 'react';
import { Store, Package, ShoppingBag, TrendingUp, Wallet, Bell, AlertCircle } from 'lucide-react';

export function MerchantDashboard({ profile, wallet, onOpenTopUp }: any) {
  const [storeOpen, setStoreOpen] = useState(true);

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{profile?.full_name || 'Merchant Dashboard'}</h1>
          <p className="text-sm text-slate-500 mt-1">Manage orders, inventory, and dispatch.</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-slate-100 p-1.5 rounded-full px-4">
            <span className="text-xs font-bold text-slate-600">Store Status:</span>
            <button 
              onClick={() => setStoreOpen(!storeOpen)}
              className={`text-xs font-bold px-3 py-1 rounded-full transition ${storeOpen ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}
            >
              {storeOpen ? 'ACCEPTING ORDERS' : 'CLOSED'}
            </button>
          </div>
          <button className="text-slate-400 hover:text-slate-600 relative">
            <Bell size={20} />
          </button>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto space-y-8">
        
        {/* Review Banner */}
        {profile?.kyc_status === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center gap-3">
            <AlertCircle className="text-amber-500 shrink-0" size={24} />
            <div>
              <h4 className="font-bold text-amber-900">Business Verification Pending</h4>
              <p className="text-sm text-amber-700">Your store will not be visible to customers until an admin reviews your business registration.</p>
            </div>
          </div>
        )}

        {/* Top Stats */}
        <div className="grid grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Today's Revenue</span>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp size={18} /></div>
            </div>
            <div className="text-3xl font-bold text-slate-900">SLE 0.00</div>
          </div>
          
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Merchant Wallet</span>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Wallet size={18} /></div>
            </div>
            <div className="text-3xl font-bold text-slate-900">SLE {Number(wallet?.balance || 0).toFixed(2)}</div>
            <button onClick={onOpenTopUp} className="text-xs font-bold text-blue-600 mt-2 hover:underline text-left">Top-up for dispatch →</button>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Pending Orders</span>
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><ShoppingBag size={18} /></div>
            </div>
            <div className="text-3xl font-bold text-slate-900">0</div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Active Deliveries</span>
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Package size={18} /></div>
            </div>
            <div className="text-3xl font-bold text-slate-900">0</div>
          </div>
        </div>

        {/* Live Order Queue */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm min-h-[400px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-900 text-lg">Live Order Queue</h3>
            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-3 py-1 rounded-full">Auto-refresh active</span>
          </div>
          
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Store className="text-slate-300" size={32} />
            </div>
            <h4 className="font-bold text-slate-900 text-lg">No active orders right now</h4>
            <p className="text-slate-500 text-sm mt-1 max-w-sm">When customers place an order from your store, it will appear here immediately for preparation and dispatch.</p>
          </div>
        </div>
      </div>
    </div>
  );
}