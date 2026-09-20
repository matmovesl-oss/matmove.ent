import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, MapPin, Navigation, Power, User, Phone } from 'lucide-react';

export function DriverDashboard({ profile, activeSection }: any) {
  if (activeSection === 'trips') return <DriverTrips profile={profile} />;

  const [isOnline, setIsOnline] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const isApproved = profile?.kyc_status === 'approved';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-13.234, 8.484], zoom: 13 });
  }, []);

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*, rider:profiles!rider_id(full_name, phone, phone_number)').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();
    const channel = supabase.channel('driver-radar').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetchInitialRequests).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    try { await supabase.from('bookings').update({ status: 'accepted', driver_id: profile.id }).eq('id', booking.id); } catch (err: any) { alert('Failed: ' + err.message); }
  };

  const handleCompleteBooking = async (booking: any) => {
    try { await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id); alert(`Trip completed! Collection recorded.`); } catch (err: any) { alert('Failed to complete: ' + err.message); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsOnline(!isOnline)} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div><h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2></div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          <h3 className="font-bold text-xl text-slate-900 pt-2">Dispatch Radar</h3>
          {!isOnline ? (
            <div className="border-2 border-dashed border-slate-300 bg-slate-100 rounded-3xl p-12 text-center text-slate-400">
              <Power size={48} className="mx-auto mb-4" />
              <p>Go online to receive live ride and delivery requests.</p>
            </div>
          ) : activeRequests.length === 0 ? (
            <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-3xl p-12 text-center text-emerald-600 animate-pulse">
               <Car size={48} className="mx-auto mb-4" />
               <p className="font-bold">Listening for nearby requests...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeRequests.map(r => (
                <div key={r.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md space-y-3">
                   <div className="flex justify-between items-start">
                     <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">{r.service_type}</span>
                     <div>
                       <span className="text-2xl font-bold text-slate-900 block text-right">SLE {r.fare_amount}</span>
                       <span className="text-[10px] font-bold text-slate-400 block text-right">Fee: SLE {(r.fare_amount * 0.15).toFixed(2)}</span>
                     </div>
                   </div>

                   <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-2">
                     <div className="flex items-center gap-2 font-semibold text-slate-800"><MapPin size={14} className="text-emerald-500 shrink-0"/> Pickup: {r.pickup_location}</div>
                     <div className="flex items-center gap-2 font-semibold text-slate-800"><Navigation size={14} className="text-blue-500 shrink-0"/> Dropoff: {r.destination_location}</div>
                   </div>

                   <div className="flex items-center justify-between text-xs font-bold text-slate-600 pt-1 border-t border-slate-100">
                     <span className="flex items-center gap-1.5"><User size={14} className="text-slate-400"/> {r.rider?.full_name || 'Rider Customer'}</span>
                     <span className="flex items-center gap-1.5"><Phone size={14} className="text-slate-400"/> {r.rider?.phone || r.rider?.phone_number || 'No Phone'}</span>
                   </div>

                   {r.status === 'pending' && <button onClick={() => handleAcceptBooking(r)} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800">Accept Request</button>}
                   {r.status === 'accepted' && r.driver_id === profile.id && <button onClick={() => handleCompleteBooking(r)} className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700">Complete & Collect Fare</button>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 bg-slate-200 relative min-h-[450px]">
          <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        </div>
      </div>
    </div>
  );
}

function DriverTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { supabase.from('bookings').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); }, [profile.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Earnings History</h1>
      {trips.length === 0 ? <div className="text-center text-slate-500 py-10">No trips completed yet.</div> : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div><div className="font-bold text-slate-900 capitalize">{t.service_type}</div><div className="text-xs text-slate-500 mt-1">{new Date(t.created_at).toLocaleDateString()}</div></div>
          <div className="text-right"><div className="font-bold text-lg text-emerald-600">+ SLE {t.fare_amount}</div><div className="text-[10px] text-slate-500 font-bold uppercase mt-1">{t.status}</div></div>
        </div>
      ))}
    </div>
  );
}