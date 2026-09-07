import { useState } from 'react';
import { Store, Plus, ShoppingBag, Truck } from 'lucide-react';

export function MerchantDashboard({ profile, wallet, onOpenWithdraw }: any) {
  const [orders] = useState<any[]>([]);

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold bg-purple-100 text-purple-800 px-3 py-1 rounded-full uppercase">Merchant Portal</span>
          <span className="text-sm font-bold text-slate-800">{profile?.full_name}</span>
        </div>
        <button className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2">
          <Plus size={16} /> New Batch Courier Request
        </button>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-purple-900 rounded-2xl p-6 text-white shadow-lg">
            <span className="text-purple-200 text-xs font-bold uppercase tracking-wider">Merchant Sales Balance</span>
            <div className="text-4xl font-bold mt-1">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
            <div className="flex gap-3 mt-6">
              <button onClick={onOpenWithdraw} className="bg-emerald-600 hover:bg-emerald-700 transition px-5 py-2.5 rounded-xl text-sm font-bold">
                Withdraw Sales Funds
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <Store size={28} className="text-purple-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Storefront Active</h3>
            <p className="text-slate-500 text-xs mt-1">Synced to MatMove Delivery Dispatch Network</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><ShoppingBag size={24} /></div>
            <div>
              <h3 className="font-bold text-slate-900">Manage Catalog</h3>
              <p className="text-xs text-slate-500 mt-0.5">Add products and pricing for delivery</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Truck size={24} /></div>
            <div>
              <h3 className="font-bold text-slate-900">Dispatch Fleet</h3>
              <p className="text-xs text-slate-500 mt-0.5">Assign courier drivers to pending sales orders</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Recent Customer Delivery Orders</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-slate-500">No active customer delivery orders currently pending.</p>
          ) : (
            <div className="space-y-3">
              {/* Order items */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}