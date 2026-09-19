// RIDER DASHBOARD (src/pages/RiderDashboard.tsx)
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, Package, MapPin, Navigation, ShieldCheck, Wallet, Loader2, Bell, RefreshCw, X, Map, Lock, ArrowUpRight, CalendarClock } from 'lucide-react';

type ServiceType = 'ride' | 'delivery' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

export function RiderDashboard({ profile }: any) {
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [monimeId, setMonimeId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Trip State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('ride');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [offerAmount, setOfferAmount] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  
  const [isRouting, setIsRouting] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Modals
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(data.balance);
      if (data.accountId) setMonimeId(data.accountId);
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-13.234, 8.484],
      zoom: 12
    });
  }, []);

  const previewRoute = async () => {
    if (!pickup || !destination || !map.current) return alert('Enter both pickup and destination locations.');
    setIsRouting(true);
    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      const pRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(pickup)}.json?access_token=${token}&country=sl`);
      const pData = await pRes.json();
      const pCoords = pData.features?.[0]?.center;
      
      const dRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(destination)}.json?access_token=${token}&country=sl`);
      const dData = await dRes.json();
      const dCoords = dData.features?.[0]?.center;

      if (!pCoords || !dCoords) throw new Error('Could not find locations.');

      markers.current.forEach(m => m.remove());
      markers.current = [];
      if (map.current.getSource('route')) {
        map.current.removeLayer('route');
        map.current.removeSource('route');
      }

      markers.current.push(new mapboxgl.Marker({ color: '#10B981' }).setLngLat(pCoords).addTo(map.current));
      markers.current.push(new mapboxgl.Marker({ color: '#3B82F6' }).setLngLat(dCoords).addTo(map.current));

      const dirRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${pCoords[0]},${pCoords[1]};${dCoords[0]},${dCoords[1]}?geometries=geojson&access_token=${token}`);
      const dirData = await dirRes.json();
      const route = dirData.routes?.[0]?.geometry;

      if (route) {
        map.current.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route } });
        map.current.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#2563EB', 'line-width': 4 }
        });
        const coordinates = route.coordinates;
        const bounds = coordinates.reduce((b: mapboxgl.LngLatBounds, c: [number, number]) => b.extend(c), new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
        map.current.fitBounds(bounds, { padding: 50 });
      }
    } catch (err: any) { alert('Routing Error: ' + err.message); } 
    finally { setIsRouting(false); }
  };

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase.channel(`booking-${activeBooking.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => setActiveBooking(payload.new)
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBooking]);

  const handleRequest = async () => {
    if (!pickup || !destination) return alert('Enter pickup and destination');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select a date and time for your scheduled ride.');
    if (serviceType !== 'scheduled' && (!offerAmount || Number(offerAmount) <= 0)) return alert('Enter a valid offer amount.');
    
    const estimate = serviceType === 'scheduled' ? 0 : Number(offerAmount);
    if (serviceType !== 'scheduled' && liveBalance < estimate) return alert('Insufficient funds. Please load your wallet.');

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
        rider_id: profile.id,
        service_type: serviceType,
        vehicle_type: serviceType === 'ride' ? vehicleType : null,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: estimate,
        scheduled_time: serviceType === 'scheduled' ? scheduledTime : null,
        status: 'pending_admin' // Flags it for the Admin Dashboard
      }).select().single();
      
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert('Failed to request: ' + err.message); } 
    finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  // Keep existing executeTopUp and executeWithdrawal functions exactly as they are...
  
  const firstName = profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search rides, destinations..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <div className="flex items-center gap-6">
          <button className="relative text-slate-400 hover:text-slate-600"><Bell size={20} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full uppercase">Rider</span>
            <span className="text-sm font-bold text-slate-800">{firstName}</span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Where to, {firstName}? 👋</h1>
            <p className="text-slate-500 mt-1">Book a ride, schedule a pickup, or request delivery.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-sm">+ Load Wallet</button>
            <button onClick={() => setIsWithdrawModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition shadow-sm">Withdraw</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 lg:col-span-2 bg-blue-700 rounded-3xl p-6 text-white relative overflow-hidden shadow-lg flex justify-between items-center">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Available Rider Wallet</span>
              <div className="text-4xl font-bold mt-1">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              {monimeId && <div className="mt-2 text-xs text-blue-200 font-mono bg-blue-800/50 px-2 py-1 rounded inline-block">Account ID: {monimeId}</div>}
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12 hidden sm:block"><Wallet size={36} className="text-white" /></div>
          </div>
          
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={32} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Journeys</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with live map tracking.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* REQUEST FORM */}
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4">
            <h3 className="font-bold text-lg">Request Service</h3>
            
            <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
              <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
              <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
            </div>

            {!activeBooking ? (
              <>
                <div className="space-y-3">
                  {serviceType === 'ride' && (
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {(['keke', 'bike', 'car', 'van'] as VehicleType[]).map(v => (
                        <button key={v} onClick={() => setVehicleType(v)} className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-600 ring-inset' : 'bg-slate-100 text-slate-500'}`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500">
                    <MapPin size={16} className="text-emerald-600 shrink-0" />
                    <input type="text" placeholder="Pickup Location" value={pickup} onChange={e => setPickup(e.target.value)} className="w-full outline-none text-sm bg-transparent" />
                  </div>
                  <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500">
                    <Navigation size={16} className="text-blue-600 shrink-0" />
                    <input type="text" placeholder="Destination" value={destination} onChange={e => setDestination(e.target.value)} className="w-full outline-none text-sm bg-transparent" />
                  </div>
                  
                  <div className="flex items-center justify-end">
                    <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                      {isRouting ? <Loader2 size={12} className="animate-spin"/> : <Map size={12} />} Preview Route
                    </button>
                  </div>

                  {serviceType !== 'scheduled' && (
                    <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500">
                      <span className="text-slate-500 font-bold text-sm">SLE</span>
                      <input type="number" placeholder="Offer Amount" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} className="w-full outline-none text-sm bg-transparent font-bold text-slate-900" />
                    </div>
                  )}

                  {serviceType === 'scheduled' && (
                    <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500">
                      <CalendarClock size={16} className="text-emerald-600 shrink-0" />
                      <input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-full outline-none text-sm bg-transparent text-slate-700" />
                    </div>
                  )}
                </div>
                
                <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4">
                  {isRequesting ? <Loader2 className="animate-spin mx-auto" /> : `Confirm ${serviceType === 'scheduled' ? 'Scheduled Request' : 'Request'}`}
                </button>
              </>
            ) : (
              <div className="text-center py-8 space-y-4">
                {activeBooking.status.includes('pending') && (
                  <>
                    <Loader2 className="animate-spin text-blue-600 mx-auto" size={32} />
                    <p className="font-bold text-slate-900">Broadcasting request...</p>
                    <button onClick={cancelTrip} className="text-red-500 text-sm font-bold hover:underline">Cancel Request</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* MAPBOX CONTAINER */}
          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[400px] border border-slate-200 shadow-inner">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}