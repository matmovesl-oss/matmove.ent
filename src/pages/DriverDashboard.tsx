import { useState } from 'react';
import { Power, MapPin, Navigation, Wallet, Clock, ShieldCheck, Bell, Radio } from 'lucide-react';

export function DriverDashboard({ profile, wallet, bookings = [], onAcceptBooking, onCompleteBooking, onOpenWithdraw }: any) {
  const [isOnline, setIsOnline] = useState(false);
  const [maxRadius, setMaxRadius] = useState<number>(5);

  const filteredBookings = bookings.filter((b: any) => {
    const isRelevantStatus = b.status === 'pending' || b.driver_id === profile.id;
    return isRelevantStatus;
  });

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsOnline(!isOnline)}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2>
            <p className="text-xs text-slate-500">{isOnline ? 'Finding trip requests near you...' : 'Go online to start receiving trips'}</p>
          </div>
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
              <option value={2}>2 km</option>
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
            </select>
          </div>

          <div className="text-right hidden sm:block ml-4">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Driver Earnings</div>
            <div className="text-lg font-bold text-slate-900">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
          </div>
          <button className="p-2 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full relative ml-2">
            <Bell size={20} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
          </button>
        </div>
      </header>

      {/* Main Interface */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Sidebar Panel */}
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          
          {profile?.kyc_status === 'pending' && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
              <Clock className="text-amber-500 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm">Account Under Review</h4>
                <p className="text-xs text-amber-700 mt-1">Live dispatch restricted until documents are verified.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
              <div className="text-slate-500 mb-1"><Wallet size={20} /></div>
              <div className="text-xl font-bold text-slate-900">SLE {Number(wallet?.balance || 0).toFixed(2)}</div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Wallet Balance</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
              <div className="text-slate-500 mb-1"><Navigation size={20} /></div>
              <div className="text-xl font-bold text-slate-900">0</div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Trips Finished</div>
            </div>
          </div>

          <button onClick={onOpenWithdraw} className="w-full bg-emerald-600 text-white font-bold p-3 rounded-xl hover:bg-emerald-700 transition">
            Withdraw Cash
          </button>

          {/* Active Dispatch Radar */}
          <div className="flex-1">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
              <MapPin size={18} className="text-blue-600" /> Dispatch Radar
            </h3>
            
            {!isOnline ? (
              <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48">
                <Power className="text-slate-400 mb-2" size={32} />
                <p className="text-sm font-bold text-slate-500">You are offline</p>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="border-2 border-dashed border-emerald-200 bg-emerald-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48 animate-pulse">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                  <Power size={24} />
                </div>
                <p className="text-sm font-bold text-emerald-700">Listening for requests...</p>
                <p className="text-xs text-emerald-600 mt-1">Within {maxRadius} km radius</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredBookings.map((b: any) => (
                  <div key={b.id} className="p-4 border border-slate-200 rounded-xl flex flex-col gap-3 bg-slate-50 shadow-sm">
                    <div>
                      <span className="font-bold text-blue-700 uppercase text-xs bg-blue-100 px-2 py-0.5 rounded">{b.service_type || 'Ride'}</span>
                      <span className="text-sm font-bold text-slate-900 ml-3">SLE {b.fare_amount}</span>
                      <div className="text-xs text-slate-600 mt-2 flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5"><MapPin size={14} className="text-emerald-600" /> {b.pickup_location}</span>
                        <span className="flex items-center gap-1.5"><Navigation size={14} className="text-blue-600" /> {b.destination_location}</span>
                      </div>
                    </div>
                    {b.status === 'pending' && (
                      <button onClick={() => onAcceptBooking(b.id)} className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-emerald-700 transition">Accept Trip</button>
                    )}
                    {b.status === 'accepted' && (
                      <button onClick={() => onCompleteBooking(b.id)} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-blue-700 transition">Complete Trip</button>
                    )}
                    {b.status === 'completed' && (
                      <div className="w-full text-center text-xs font-bold text-emerald-600 bg-emerald-50 py-2 rounded-lg">Completed</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Map Area */}
        <div className="flex-1 bg-slate-200 relative min-h-[400px]">
          <iframe
            title="Driver Radar Map"
            width="100%"
            height="100%"
            className="absolute inset-0 border-0"
            src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=14&ie=UTF8&iwloc=&output=embed"
          ></iframe>
          
          <div className="absolute bottom-6 right-6 bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 border border-slate-200">
            <ShieldCheck className="text-emerald-600" size={18} />
            <span className="text-xs font-bold text-slate-700">MatMove GPS Protected</span>
          </div>
        </div>
      </div>
    </div>
  );
}