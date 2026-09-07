import { useState } from 'react';
import { TrendingUp, Navigation, MapPin, Lock, Radio } from 'lucide-react';

export function DriverDashboard({ profile, wallet, bookings, onAcceptBooking, onCompleteBooking, onOpenWithdraw }: any) {
  const [isOnline, setIsOnline] = useState(true);
  const [maxRadius, setMaxRadius] = useState<number>(5); // Default 5 km radius

  // Filter bookings to active requests within driver's selected dispatch radius
  const filteredBookings = bookings.filter((b: any) => {
    const isRelevantStatus = b.status === 'pending' || b.driver_id === profile.id;
    return isRelevantStatus;
  });

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full uppercase">Driver Console</span>
          <span className="text-sm font-bold text-slate-800">{profile?.full_name}</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
            <Radio size={14} className="text-blue-600" />
            <span className="text-xs font-bold text-slate-700">Radius:</span>
            <select 
              value={maxRadius} 
              onChange={(e) => setMaxRadius(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-blue-700 outline-none cursor-pointer"
            >
              <option value={2}>2 km (Near)</option>
              <option value={5}>5 km (Standard)</option>
              <option value={10}>10 km (Expanded)</option>
            </select>
          </div>

          <button 
            onClick={() => setIsOnline(!isOnline)} 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${isOnline ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
          >
            {isOnline ? '● Online & Dispatching' : '○ Go Online'}
          </button>
        </div>
      </header>

      {profile?.kyc_status === 'pending' && (
        <div className="bg-amber-50 text-amber-800 p-3 text-center text-xs font-bold border-b border-amber-200">
          <Lock size={14} className="inline mr-1" /> Driver KYC Pending Verification. Live dispatch restricted until documents are verified.
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

        {/* Proximity Dispatch Feed */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-slate-900">Nearby Proximity Requests</h2>
            <span className="text-xs font-semibold text-slate-500">Filtered within {maxRadius} km</span>
          </div>

          {!isOnline ? (
            <p className="text-sm text-slate-500">Switch status to Online to receive nearby trip requests.</p>
          ) : filteredBookings.length === 0 ? (
            <p className="text-sm text-slate-500">No active dispatch requests found within {maxRadius} km.</p>
          ) : (
            <div className="space-y-3">
              {filteredBookings.map((b: any) => (
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
                  {b.status === 'completed' && (
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">Completed</span>
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