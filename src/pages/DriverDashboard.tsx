import { useState } from 'react';
import { Wallet, TrendingUp, Navigation, MapPin, Lock } from 'lucide-react';

export function DriverDashboard({ profile, wallet, bookings, onAcceptBooking, onCompleteBooking, onOpenWithdraw }: any) {
  const [isOnline, setIsOnline] = useState(true);

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full uppercase">Driver Console</span>
          <span className="text-sm font-bold text-slate-800">{profile?.full_name}</span>
        </div>
        <button 
          onClick={() => setIsOnline(!isOnline)} 
          className={`px-4 py-2 rounded-xl text-xs font-bold transition ${isOnline ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
        >
          {isOnline ? '● Online & Accepting Requests' : '○ Go Online'}
        </button>
      </header>

      {profile?.kyc_status === 'pending' && (
        <div className="bg-amber-50 text-amber-800 p-3 text-center text-xs font-bold border-b border-amber-200">
          <Lock size={14} className="inline mr-1" /> Driver KYC Pending Approval. Live trip dispatch is restricted until documents are verified.
        </div>
      )}

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-slate-900 rounded-2xl p-6 text-white shadow-lg">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Driver Earnings Balance</span>
            <div className="text-4xl font-bold mt-1">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
            <div className="flex gap-3 mt-6">
              <button onClick={onOpenWithdraw} className="bg-emerald-600 hover:bg-emerald-700 transition px-5 py-2.5 rounded-xl text-sm font-bold">
                Withdraw Cash (Monime)
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <TrendingUp size={28} className="text-blue-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Driver Rating</h3>
            <p className="text-slate-500 text-xs mt-1">4.9 ★ (120 completed trips)</p>
          </div>
        </div>

        {/* Driver Dispatch Feed */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Nearby Ride Requests</h2>
          {!isOnline ? (
            <p className="text-sm text-slate-500">Switch status to Online to receive nearby trip requests.</p>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-slate-500">Searching for passenger requests in your vicinity...</p>
          ) : (
            <div className="space-y-3">
              {bookings.map((b: any) => (
                <div key={b.id} className="p-4 border border-slate-200 rounded-xl flex items-center justify-between bg-slate-50">
                  <div>
                    <span className="font-bold text-blue-700 uppercase text-xs bg-blue-100 px-2 py-0.5 rounded">{b.service_type}</span>
                    <span className="text-sm font-bold text-slate-900 ml-3">SLE {b.fare_amount}</span>
                    <div className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                      <MapPin size={12} className="text-emerald-600" /> {b.pickup_location} → <Navigation size={12} className="text-blue-600" /> {b.destination_location}
                    </div>
                  </div>
                  {b.status === 'pending' && (
                    <button onClick={() => onAcceptBooking(b.id)} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-emerald-700">Accept Trip</button>
                  )}
                  {b.status === 'accepted' && (
                    <button onClick={() => onCompleteBooking(b.id)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-blue-700">Complete Trip</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}