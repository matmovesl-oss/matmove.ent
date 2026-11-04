import {RideLocationPicker} from '@/components/RideLocationPicker';
import ConciergeServices from '@/components/ConciergeServices';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Briefcase, Car, CreditCard, Eye, EyeOff, Home, Loader2, MapPin, Navigation, RefreshCw, ShieldCheck, ShoppingBag, Store, Trash2, Wallet, X, Bus, Ticket, Sparkles, CheckCircle2, Calendar, XCircle, Smartphone, Clock, Plane, Package, Ship, CalendarClock, Minus, Plus, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { walletFetch } from '@/lib/apiFetch';
import { ArcadeGames } from '@/components/ArcadeGames';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import ActiveTripMap, { tripPinFields } from '@/components/ActiveTripMap';
import { ProductGallery, catalogMoney, catalogCheckoutAllowed } from '@/components/ProductCatalog';
import FareNegotiation from '@/components/FareNegotiation';
import { useCustomerActiveRide } from '@/lib/useRideNegotiation';
import WalletCardsView from '@/components/WalletCards';
import TransactionHistory from '@/components/TransactionHistory';
import MerchantCheckout from '@/components/MerchantCheckout';
import TripHistory from '@/components/TripHistory';
import PayoutPanel from '@/components/PayoutPanel';
import { WalletTopUp } from '@/components/WalletTopUp';
import { TransactionModal } from '@/components/TransactionModal';
import { useWalletAccess } from '@/lib/useWalletAccess';
import { updateRide } from '@/services/rideService';
import { locationVoiceAvailable, startLocationVoice } from '@/lib/voiceLocation';
import 'mapbox-gl/dist/mapbox-gl.css';

const WHATSAPP_NUMBER = '23290330362';

// -----------------------------------------------------------------------------
// Shared Types & Maps Configuration
// -----------------------------------------------------------------------------
type Place = { kind: 'home' | 'work'; address: string; latitude: number | null; longitude: number | null; version: number };
type CardReference = { id: string; nickname: string; brand: string; last_four: string };
type Preferences = { user_id: string; places: Place[]; cardReferences: CardReference[] };
type Props = { profile: any; onNavigate: (section: any) => void };

type Point = { coords: [number, number]; address: string };
type Target = 'pickup' | 'destination';
type Prediction = google.maps.places.PlacePrediction;
const validCoords = (coords: [number, number]) => Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
type SavedPlace = { kind: 'home' | 'work'; address: string; latitude: number | null; longitude: number | null; version: number };
export type TripLocations = { pickup: Point | null; destination: Point | null; distanceKm: number | null };
const CENTER = { lat: 8.4808, lng: -13.2290 };
let sdkPromise: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps?.Map && window.google.maps.Geocoder) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  if (!apiKey) return Promise.reject(new Error('Map setup is incomplete. Contact MatMove support.'));
  sdkPromise = new Promise<void>((resolve, reject) => {
    let done = false;
    let script = document.querySelector<HTMLScriptElement>('script[src^="https://maps.googleapis.com/maps/api/js"]');
    if (script?.dataset.matmoveFailed === 'true') { script.remove(); script = null; }
    const element = script || document.createElement('script');
    const finish = (error?: Error) => {
      if (done) return;
      done = true; window.clearTimeout(timeout); window.clearInterval(check);
      element.removeEventListener('load', loaded); element.removeEventListener('error', failed);
      if (error) { element.dataset.matmoveFailed = 'true'; reject(error); } else resolve();
    };
    const loaded = () => { if (window.google?.maps?.Map && window.google.maps.Geocoder) finish(); };
    const failed = () => finish(new Error('Could not load the map. Check your connection and retry.'));
    const timeout = window.setTimeout(failed, 15000);
    const check = window.setInterval(loaded, 100);
    element.addEventListener('load', loaded); element.addEventListener('error', failed);
    if (!script) {
      element.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
      element.async = true; element.defer = true;
      document.head.appendChild(element);
    }
    loaded();
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}

export function RiderDashboard(props: any) {
  if (props.activeSection === 'shop') {
    return <RiderShop profile={props.profile} wallet={props.wallet} />;
  }
  if (props.activeSection === 'trips') {
    return <RiderTrips profile={props.profile} />;
  }
  return <RiderMain key={props.profile?.id || 'rider-main'} {...props} />;
}

export default function PortalHome({ profile, onNavigate }: Props) {
  const [selectedGame, setSelectedGame] = useState<'spin'|'dice'|'fruity'|'crankling'|null>(null);
  const [currency, setCurrency] = useState<'SLE' | 'USD'>('SLE');
  const [visible, setVisible] = useState(false);
  const [wallets, setWallets] = useState<any>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState('');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState('');
  const [trips, setTrips] = useState<any[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState('');
  const [panel, setPanel] = useState<'places' | 'cards' | 'travel' | 'events' | 'cancel_travel' | null>(null);
  const [busSettings, setBusSettings] = useState<any>({ id: 'bus_ghana', total_seats: 50, price_usd: 100, price_sle: 2400 });
  const [confirmedSeats, setConfirmedSeats] = useState(0);
  const [existingBooking, setExistingBooking] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [travelLoading, setTravelLoading] = useState(true);
  const [travelError, setTravelError] = useState('');
  const travelBusy = useRef(false);
  const travelRefreshQueued = useRef(false);
  const mounted = useRef(false);
  const balanceBusy = useRef(false);
  const preferencesBusy = useRef(false);
  const tripsBusy = useRef(false);
  const uid = profile.id as string;
  const role = profile.role as string;

  const sameIdentity = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session?.user.id === uid;
  }, [uid]);

  const refreshPreferences = useCallback(async () => {
    if (preferencesBusy.current) return false;
    preferencesBusy.current = true;
    if (mounted.current) { setPreferencesLoading(true); setPreferencesError(''); }
    try {
      const { data, error } = await supabase.rpc('matmove_home_preferences', { p_user_id: uid });
      if (error) throw new Error(error.message);
      if (data?.user_id !== uid || !Array.isArray(data.places) || !Array.isArray(data.cardReferences)) throw new Error('Your saved preferences could not be verified.');
      if (await sameIdentity() && mounted.current) { setPreferences(data); return true; }
      return false;
    } catch (error: any) {
      if (mounted.current) setPreferencesError(error.message || 'Could not load preferences. Try again.');
      return false;
    } finally {
      preferencesBusy.current = false;
      if (mounted.current) setPreferencesLoading(false);
    }
  }, [uid, sameIdentity]);

  const refreshWallets = useCallback(async () => {
    if (balanceBusy.current) return;
    balanceBusy.current = true;
    if (mounted.current) setBalanceLoading(true);
    try {
      if (!await sameIdentity()) throw new Error('Please sign in again.');
      const { response, data, finish } = await walletFetch('/api/get-live-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Could not load balances.');
      if (mounted.current && await sameIdentity()) {
        setWallets(data);
        setBalanceError('');
        finish();
      }
    } catch (error: any) {
      if (mounted.current) { setWallets(null); setBalanceError(error.message || 'Could not load balances.'); }
    } finally {
      balanceBusy.current = false;
      if (mounted.current) setBalanceLoading(false);
    }
  }, [sameIdentity]);

  const fetchTravelAndEvents = useCallback(async () => {
    if (travelBusy.current) { travelRefreshQueued.current = true; return; }
    travelBusy.current = true;
    if (mounted.current) {
      setTravelLoading(true); setTravelError('');
      setEventsLoading(true); setEventsError('');
    }
    try {
      const [availabilityResult, ownBookingResult, eventsResult] = await Promise.all([
        supabase.rpc('matmove_get_travel_availability'),
        supabase.from('travel_bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('platform_events').select('*').eq('is_active', true).order('event_date', { ascending: true }),
      ]);
      if (!mounted.current || !await sameIdentity()) return;

      if (availabilityResult.error) {
        setTravelError(availabilityResult.error.message || 'Travel availability is unavailable.');
      } else {
        const availability = Array.isArray(availabilityResult.data) ? availabilityResult.data[0] : availabilityResult.data;
        if (!availability) setTravelError('Travel pricing and seat availability have not been configured.');
        else {
          setBusSettings({ id: 'bus_ghana', ...availability });
          setConfirmedSeats(Number(availability.held_seats) || 0);
        }
      }
      if (ownBookingResult.error) setTravelError(current => current || ownBookingResult.error.message || 'Your travel booking could not be loaded.');
      else setExistingBooking(ownBookingResult.data);

      if (eventsResult.error) setEventsError(eventsResult.error.message || 'Events could not be loaded.');
      else setEvents(eventsResult.data || []);
    } catch (error: any) {
      if (mounted.current) setTravelError(error?.message || 'Travel availability could not be refreshed.');
    } finally {
      travelBusy.current = false;
      if (mounted.current) { setTravelLoading(false); setEventsLoading(false); }
      if (travelRefreshQueued.current && mounted.current) {
        travelRefreshQueued.current = false;
        window.setTimeout(() => { if (mounted.current) void fetchTravelAndEvents(); }, 0);
      }
    }
  }, [uid, sameIdentity]);

  const refreshTrips = useCallback(async () => {
    if (tripsBusy.current) return;
    tripsBusy.current = true;
    if (mounted.current) { setTripsLoading(true); setTripsError(''); }
    try {
      const { data, error } = await supabase.from('bookings')
        .select('id,service_type,pickup_location,destination_location,status,created_at')
        .eq(role === 'driver' ? 'driver_id' : 'rider_id', uid)
        .order('created_at', { ascending: false }).limit(3);
      if (error) throw new Error(error.message);
      if (mounted.current && await sameIdentity()) setTrips(data || []);
    } catch {
      if (mounted.current) setTripsError('Could not load recent trips.');
    } finally {
      tripsBusy.current = false;
      if (mounted.current) setTripsLoading(false);
    }
  }, [uid, role, sameIdentity]);

  useEffect(() => {
    mounted.current = true;
    void refreshPreferences(); void refreshWallets(); void refreshTrips(); void fetchTravelAndEvents();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') { void refreshWallets(); void refreshTrips(); void fetchTravelAndEvents(); }
    };
    const timer = window.setInterval(refreshVisible, 30000);
    const liveChannel = supabase.channel(`customer-travel-events-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'travel_settings', filter: 'id=eq.bus_ghana' }, () => { void fetchTravelAndEvents(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'travel_bookings' }, () => { void fetchTravelAndEvents(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_events' }, () => { void fetchTravelAndEvents(); })
      .subscribe();
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { mounted.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); void supabase.removeChannel(liveChannel); };
  }, [refreshPreferences, refreshWallets, refreshTrips, fetchTravelAndEvents, uid]);

  const handleWithdrawUnpaidBooking = async () => {
    if (!existingBooking) return;
    const confirmed = window.confirm("Are you sure you want to cancel this booking and start a fresh one?");
    if (!confirmed) return;
    
    try {
      const { error } = await supabase.from('travel_bookings').delete().eq('id', existingBooking.id);
      if (error) throw error;
      setExistingBooking(null);
      setPanel(null);
      void fetchTravelAndEvents();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel the booking.');
    }
  };

  const openWhatsApp = (message: string) => {
    const text = encodeURIComponent(message);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank');
  };

  const wallet = wallets?.[currency === 'SLE' ? 'sleWallet' : 'usdWallet'];
  const verifiedBalance = wallet?.user_id === uid && wallet?.balanceAvailable === true && typeof wallet.balance === 'number' && Number.isFinite(wallet.balance);
  const name = String(profile.first_name || profile.full_name || profile.business_name || 'there').split(' ')[0];
  const shortcuts = role === 'driver'
    ? [{ section: 'ride', label: 'Driver radar', detail: 'Go online and find requests', Icon: Navigation }, { section: 'trips', label: 'My trips', detail: 'View trip details and history', Icon: Car }]
    : [{ section: 'ride', label: 'Book a ride', detail: 'Choose pickup and destination', Icon: Car }, { section: role === 'merchant' ? 'inventory' : 'shop', label: role === 'merchant' ? 'My business' : 'Shop', detail: role === 'merchant' ? 'Manage products and orders' : 'Explore local products', Icon: role === 'merchant' ? Store : ShoppingBag }];

  const availableSeats = Math.max(0, Number(busSettings.total_seats || 50) - confirmedSeats);
  const sleWalletForTravel = wallets?.sleWallet;
  const travelWalletBalance = sleWalletForTravel?.user_id === uid && sleWalletForTravel?.balanceAvailable === true && typeof sleWalletForTravel.balance === 'number' ? sleWalletForTravel.balance : 0;
  const userPhone = String(profile.phone || profile.phone_number || '');
  const isBusFull = availableSeats <= 0;

  if (selectedGame) return <ArcadeGames key={`${uid}:${selectedGame}`} userId={uid} initialGame={selectedGame} onBack={() => setSelectedGame(null)} />;
  
  return (
    <main className="mm-home overflow-hidden mx-auto max-w-[100vw]">
      <header className="mm-home-heading">
        <div className="mm-brand"><img src="/logo.jpg" alt="MatMove" width="40" height="40"/><span>Wi dey move<span className="mm-muted">Your everyday, connected.</span></span></div>
        <button className="mm-icon-button" type="button" aria-label="Open your account" onClick={() => onNavigate('account')}><ShieldCheck size={22}/></button>
      </header>
      <div className="mm-welcome"><p className="mm-eyebrow">{role === 'merchant' ? 'Business space' : role === 'driver' ? 'Driver space' : 'Your MatMove'}</p><h1>Hello, {name}.</h1><p>Where will today take you?</p></div>
      <div className="mm-home-grid">
        <section className={`mm-home-wallet mm-home-wallet-${currency.toLowerCase()}`} aria-label="Wallet overview">
          <div className="mm-row"><div className="mm-currency-tabs" aria-label="Wallet currency">{(['SLE','USD'] as const).map(c => <button key={c} type="button" aria-pressed={currency === c} onClick={() => { setCurrency(c); setVisible(false); }}>{c}</button>)}</div><button type="button" className="mm-glass-button" aria-label="Refresh balances" disabled={balanceLoading} onClick={() => void refreshWallets()}><RefreshCw size={18} className={balanceLoading ? 'animate-spin' : ''}/></button></div>
          <p className="mm-wallet-label">{currency === 'SLE' ? 'Leone wallet' : 'US dollar wallet'}</p>
          <div className="mm-balance-row"><strong aria-live="polite">{currency} {visible ? balanceLoading ? <span className="inline-block h-6 w-24 bg-white/20 rounded animate-pulse"></span> : verifiedBalance ? wallet.balance.toFixed(2) : '—' : <span aria-label="Balance hidden">••••••</span>}</strong><button type="button" className="mm-glass-button" aria-label={visible ? 'Hide balance' : 'Show balance'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div>
          <p className="mm-wallet-caption">{balanceLoading ? <span className="inline-block h-3 w-36 rounded bg-white/20 animate-pulse align-middle" aria-label="Loading wallet status" /> : balanceError ? 'Balance could not be loaded.' : wallet?.is_frozen || profile.is_wallet_frozen ? 'Wallet frozen · contact support' : !wallet ? 'Open Wallet to check setup.' : !verifiedBalance ? 'Open Wallet to check account status.' : 'Available balance · verified with your wallet provider'}</p>
          <button className="mm-wallet-open" type="button" onClick={() => onNavigate('wallet')}>Open wallet <ArrowRight size={17}/></button>
        </section>

        <ConciergeServices userId={uid}/>

        {/* Travel to Ghana */}
        <section className="mm-surface" aria-label="Travel & Bus Booking">
          <div className="mm-row">
            <h2 className="flex items-center gap-2"><Bus className="text-blue-600" size={20} /> Travel to Ghana</h2>
            <span className="text-xs text-slate-500 font-bold">1st & 15th every month</span>
          </div>
          {travelLoading ? <div role="status" aria-label="Loading travel details" className="mt-4 space-y-3 animate-pulse"><SkeletonBlock className="h-4 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="h-24 w-full" /></div> : travelError ? <p role="alert" className="mm-alert">{travelError} <button type="button" onClick={() => void fetchTravelAndEvents()}>Retry</button></p> : <>
            <p className="mb-2 text-sm text-slate-600">
              Freetown to Accra Direct Bus. Price: <b>${Number(busSettings.price_usd || 100).toLocaleString()} / SLE {Number(busSettings.price_sle || 2400).toLocaleString()}</b> per seat.
            </p>

            <div className="mb-3 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Seat Capacity: {Number(busSettings.total_seats || 50).toLocaleString()} Seats</span>
              <span className={isBusFull ? 'text-rose-600' : 'text-emerald-700'}>
                {isBusFull ? 'BUS FULL' : `${availableSeats} Seats Available`}
              </span>
            </div>

            {existingBooking && existingBooking.status !== 'cancelled' ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-500 uppercase">Your Reservation</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    existingBooking.status === 'cancel_requested' ? 'bg-rose-100 text-rose-800 animate-pulse' :
                    existingBooking.status === 'cancelled' ? 'bg-slate-200 text-slate-700' :
                    existingBooking.is_paid ? 'bg-emerald-100 text-emerald-800' :
                    existingBooking.status === 'approved' ? 'bg-indigo-100 text-indigo-800' :
                    existingBooking.status === 'boarded' ? 'bg-purple-100 text-purple-800' :
                    existingBooking.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {existingBooking.status === 'cancel_requested' ? 'Cancel Requested' : existingBooking.is_paid ? 'Paid & Confirmed' : existingBooking.status === 'approved' ? 'Approved (Ready to Pay)' : existingBooking.status}
                  </span>
                </div>
                <p className="text-sm font-bold text-slate-900">
                  Freetown – Accra Direct ({existingBooking.passengers_count} Seat{existingBooking.passengers_count > 1 ? 's' : ''})
                </p>

                {existingBooking.status === 'approved' && !existingBooking.is_paid && (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPanel('travel')}
                      className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500"
                    >
                      Confirm & Pay SLE {Number(existingBooking.fare_amount).toLocaleString()}
                    </button>
                    <button
                      type="button"
                      onClick={handleWithdrawUnpaidBooking}
                      className="px-4 py-2.5 rounded-xl border border-rose-300 text-rose-700 font-bold text-xs hover:bg-rose-50"
                    >
                      Cancel & Start Fresh
                    </button>
                  </div>
                )}

                {existingBooking.status === 'pending_approval' && (
                  <button
                    type="button"
                    onClick={handleWithdrawUnpaidBooking}
                    className="w-full mt-2 rounded-xl border border-slate-300 text-slate-600 font-bold text-xs py-2 hover:bg-slate-100"
                  >
                    Withdraw Booking & Start Fresh
                  </button>
                )}

                {existingBooking.is_paid && !['cancel_requested', 'cancelled'].includes(existingBooking.status) && (
                  <button
                    type="button"
                    onClick={() => setPanel('cancel_travel')}
                    className="w-full mt-2 rounded-xl border border-rose-300 text-rose-700 font-bold text-xs py-2 hover:bg-rose-50"
                  >
                    Request Cancellation (Refund)
                  </button>
                )}

                {existingBooking.status === 'cancel_requested' && (
                  <p className="text-[11px] text-rose-700 font-medium pt-1">
                    Your cancellation request is pending dispatch review. Reason: {existingBooking.cancel_reason}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {existingBooking?.status === 'cancelled' && (
                  <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                    <span>Previous reservation cancelled.</span>
                    <button onClick={() => setExistingBooking(null)} className="font-bold underline text-indigo-600">Dismiss</button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={isBusFull}
                  onClick={() => { setExistingBooking(null); setPanel('travel'); }}
                  className={`w-full min-h-24 rounded-2xl border p-4 text-left shadow-sm flex items-center justify-between transition ${
                    isBusFull 
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'border-blue-200 bg-gradient-to-r from-blue-900 to-indigo-900 text-white hover:opacity-95'
                  }`}
                >
                  <div>
                    <b className="block text-lg font-bold">
                      {isBusFull ? 'Bus is Full for this Departure' : 'Freetown - Accra Direct'}
                    </b>
                    <span className="mt-1 block text-sm opacity-90">
                      {isBusFull ? `All ${Number(busSettings.total_seats || 50).toLocaleString()} seats reserved.` : 'Book up to 3 passengers. Departures 7:00 AM sharp.'}
                    </span>
                  </div>
                  <ArrowRight size={24} className={isBusFull ? 'text-slate-300' : 'text-blue-300'}/>
                </button>
              </div>
            )}
          </>}
        </section>

        {/* Events Hub Card */}
        <section className="mm-surface" aria-label="Upcoming Events Hub">
          <div className="mm-row">
            <h2 className="flex items-center gap-2">
              <Ticket className="text-sky-600" size={20} /> Events & Ticket Gate
            </h2>
            <button type="button" className="mm-text-button" onClick={() => setPanel('events')}>View all</button>
          </div>
          <p className="mb-3 text-sm text-slate-600">Official tickets with single checkout for up to 3 passes.</p>
          {eventsLoading ? <div role="status" aria-label="Loading events" className="grid gap-3 sm:grid-cols-2 animate-pulse"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-28" /></div> : eventsError ? <p role="alert" className="mm-alert">{eventsError} <button type="button" onClick={() => void fetchTravelAndEvents()}>Retry</button></p> : events.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">No active events posted yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {events.slice(0, 2).map(evt => (
                <div key={evt.id} className="rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between p-3 bg-slate-50">
                  <div>
                    <img src={evt.flyer_url || '/logo.jpg'} alt={`${evt.title} event flyer`} loading="lazy" className="mb-3 h-28 w-full rounded-xl bg-slate-100 object-cover" />
                    <h4 className="font-bold text-slate-900 text-sm line-clamp-1">{evt.title}</h4>
                    <p className="text-xs text-slate-500 mt-1">{evt.venue} · {new Date(evt.event_date).toLocaleDateString()}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200">
                    <span className="font-black text-sky-600 text-sm">SLE {Number(evt.ticket_price).toLocaleString()}</span>
                    <button type="button" onClick={() => setPanel('events')} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">
                      Book Ticket
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mm-services" aria-label="Quick actions">
          {shortcuts.map(({ section, label, detail, Icon }) => <button type="button" className="mm-service" key={section} onClick={() => onNavigate(section)}><span className="mm-service-icon"><Icon size={25}/></span><span><b>{label}</b><small>{detail}</small></span><ArrowRight size={18}/></button>)}
          <div className="mm-small-actions"><button type="button" onClick={() => onNavigate('wallet')}><Wallet size={18}/> Load with Mobile Money</button><button type="button" onClick={() => onNavigate('account')}><ShieldCheck size={18}/> My account</button></div>
        </section>
      </div>

      {balanceError && <div role="alert" className="mm-alert">{balanceError} <button type="button" disabled={balanceLoading} onClick={() => void refreshWallets()}>Retry</button></div>}
      
      <section className="mm-surface" aria-label="MatMove games">
        <div className="mm-row"><h2>Play MatMove Games</h2><span className="text-xs text-slate-500">18+ · Play responsibly</span></div>
        <p className="mb-3 text-sm text-slate-600">Explore the games and view the rules and possible prizes before playing. Account eligibility applies.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([
          ['spin','Spin Wheel','🎡','Spin for a possible prize.'],
          ['dice','RICH DICE','🎲','Choose your prediction.'],
          ['fruity','Fruity Flue','🍍','Match all four fruits.'],
          ['crankling','CRANKLING','777','Match your chosen number.'],
        ] as const).map(([id,title,icon,description])=><button type="button" key={id} onClick={()=>setSelectedGame(id as any)} className="min-h-36 rounded-2xl border border-amber-300 bg-gradient-to-br from-slate-950 to-purple-950 p-4 text-left text-white"><span aria-hidden="true" className="text-3xl font-black text-amber-300">{icon}</span><b className="mt-3 block text-sm">{title}</b><span className="mt-1 block text-xs text-slate-200">{description}</span><span className="mt-3 block text-xs font-bold text-amber-300">Open game →</span></button>)}</div>
      </section>

      <section className="mm-surface"><div className="mm-row"><h2>Your shortcuts</h2><button type="button" className="mm-text-button" onClick={() => setPanel(panel === 'places' ? null : 'places')}>{panel === 'places' ? 'Close' : 'Manage places'}</button></div>
        {preferencesLoading && !preferences ? <div role="status" aria-label="Loading saved places" className="space-y-2 animate-pulse"><div className="h-12 bg-slate-100 rounded-xl"></div></div> : preferencesError ? <div role="alert" className="mm-alert">{preferencesError} <button type="button" onClick={() => void refreshPreferences()}>Retry</button></div> : <div className="mm-place-grid">{(['home','work'] as const).map(kind => { const place = preferences?.places.find(p => p.kind === kind); const Icon = kind === 'home' ? Home : Briefcase; return <button type="button" key={kind} className="mm-place-tile" onClick={() => setPanel('places')}><Icon size={20}/><span><b>{kind === 'home' ? 'Home' : 'Work'}</b><small>{place?.address || `Add your ${kind} address`}</small></span></button>; })}</div>}
      </section>

      {role !== 'driver' && <button type="button" className="mm-payment-link" aria-expanded={panel === 'cards'} onClick={() => setPanel(panel === 'cards' ? null : 'cards')}><CreditCard size={23}/><span><b>Payment methods</b><small>Mobile Money · optional card references</small></span><ArrowRight size={18}/></button>}
      
      {(panel === 'places' || panel === 'cards') && <PersonalTools key={`${uid}:${panel}`} uid={uid} panel={panel} preferences={preferences} error={preferencesError} loading={preferencesLoading} refresh={refreshPreferences} onClose={() => setPanel(null)}/>}
      {panel === 'travel' && <TravelBookingModal uid={uid} userName={profile.full_name || profile.first_name || ''} userPhone={userPhone} walletBalance={travelWalletBalance} priceSle={Number(busSettings.price_sle || 2400)} departureDate={busSettings.departure_date} availableSeats={availableSeats} existingBooking={existingBooking} onSuccess={() => { setPanel(null); void fetchTravelAndEvents(); void refreshWallets(); }} onClose={() => setPanel(null)} />}
      {panel === 'cancel_travel' && existingBooking && <CancelTravelModal booking={existingBooking} onSuccess={() => { setPanel(null); void fetchTravelAndEvents(); }} onClose={() => setPanel(null)} />}
      {panel === 'events' && <EventsModal uid={uid} userPhone={userPhone} walletBalance={travelWalletBalance} events={events} eventsError={eventsError} onRetry={fetchTravelAndEvents} onWalletRefresh={refreshWallets} onClose={() => setPanel(null)} />}
      
      <section className="mm-surface"><div className="mm-row"><h2>Recent trips</h2><button type="button" className="mm-text-button" onClick={() => onNavigate('trips')}>View all</button></div>
        {tripsLoading && !trips.length ? <SkeletonList count={2} /> : tripsError ? <div role="alert" className="mm-alert">{tripsError} <button type="button" onClick={() => void refreshTrips()}>Retry</button></div> : !trips.length ? <p className="mm-empty">Your trips will appear here after your first booking.</p> : trips.map(trip => <button type="button" className="mm-trip-row" key={trip.id} onClick={() => onNavigate('trips')}><MapPin size={19}/><span><b>{trip.destination_location || trip.service_type}</b><small>{trip.status} · {new Date(trip.created_at).toLocaleDateString()}</small></span><ArrowRight size={16}/></button>)}
      </section>
      <p className="mm-home-footer">Made for your everyday moves.</p>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Component: RiderMain (Map & Booking Flow)
// -----------------------------------------------------------------------------
function RiderMain({ profile, wallet, activeSection }: any) {
  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [rideNotice, setRideNotice] = useState('');
  const [walletNotice, setWalletNotice] = useState('');
  const balanceBusy = useRef(false);
  const setupBusy = useRef(false);
  const [isSettingUpWallet, setIsSettingUpWallet] = useState(false);
  const [walletSetupError, setWalletSetupError] = useState('');
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<any>(null);

  const defaultPricing = {
    bike: { min: 15, perKm: 3 },
    keke: { min: 20, perKm: 5 },
    car: { min: 30, perKm: 8 },
    van: { min: 50, perKm: 15 }
  };

  const [pricingRates, setPricingRates] = useState<any>(defaultPricing);
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);

  const [viewMode, setViewMode] = useState<'active' | 'new'>('active');
  const [serviceType, setServiceType] = useState<'ride' | 'delivery' | 'scheduled'>('ride');
  const [vehicleType, setVehicleType] = useState<'keke' | 'bike' | 'car' | 'van'>('car');
  const [offerAmount, setOfferAmount] = useState('');
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [passengerCount, setPassengerCount] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const {
    booking: activeBooking,
    setBooking: setActiveBooking,
    loading: tripLoading,
    error: tripError,
    retry: retryTrip,
    applySnapshot: applyFareSnapshot
  } = useCustomerActiveRide(profile?.id);

  useEffect(() => {
    let timer: any;
    if (activeBooking && activeBooking.status === 'accepted' && activeBooking.accepted_at) {
      const updateElapsed = () => {
        const diff = Math.floor((Date.now() - new Date(activeBooking.accepted_at).getTime()) / 1000);
        setElapsedSeconds(diff >= 0 ? diff : 0);
      };
      updateElapsed();
      timer = setInterval(updateElapsed, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [activeBooking]);

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferCurrency, setTransferCurrency] = useState<'SLE' | 'USD'>('SLE');
  const [transferError, setTransferError] = useState('');
  const [transferNotice, setTransferNotice] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const [showPolicy, setShowPolicy] = useState(false);

  const { frozen: isFrozen, approved: isApproved } = useWalletAccess(profile?.id);
  const canLoad = !isFrozen && profile?.role === 'rider';
  const canSend = canLoad && isApproved;

  useEffect(() => {
    if (tripDistanceKm === null) return;
    const rate = pricingRates?.[vehicleType] || defaultPricing[vehicleType] || { min: 15, perKm: 3 };
    setOfferAmount(
      Math.max(
        rate.min,
        Math.ceil((rate.min + tripDistanceKm * rate.perKm) / 5) * 5
      ).toString()
    );
  }, [tripDistanceKm, vehicleType, pricingRates]);

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    supabase
      .from('pricing_settings')
      .select('*')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const rates: any = {};
          data.forEach(r => {
            rates[r.vehicle_type] = {
              min: Number(r.min_fare),
              perKm: Number(r.per_km_rate)
            };
          });
          setPricingRates(rates);
        }
      });
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    const accepted = localStorage.getItem(`matmove_policy_${profile.id}`);
    if (!accepted) setShowPolicy(true);
  }, [profile?.id]);

  const handleAcceptPolicy = () => {
    if (profile?.id) {
      localStorage.setItem(`matmove_policy_${profile.id}`, 'true');
    }
    setShowPolicy(false);
  };

  const fetchLiveBalance = async () => {
    if (!profile?.id || balanceBusy.current) return;
    balanceBusy.current = true;
    setIsRefreshing(true);
    try {
      const { response, data } = await walletFetch('/api/get-live-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to read wallet balances.');

      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      if (data.transactions) setTransactions(data.transactions);
      setWalletNotice(data.sleWallet?.balanceAvailable === false ? data.sleWallet.balanceError || 'Balance unavailable.' : (data.warnings || []).join(' '));
    } catch (err: any) {
      setWalletNotice(err.message || 'Wallet refresh failed.');
      setSleWallet((previous: any) => previous ? { ...previous, balanceAvailable: false } : null);
    } finally {
      balanceBusy.current = false;
      setIsRefreshing(false);
    }
  };

  const hasSleAccount = /^fac-[A-Za-z0-9_-]+$/.test(String(sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || ''));
  const setupSleWallet = async () => {
    if (!canLoad || setupBusy.current) return;
    setupBusy.current = true;
    setIsSettingUpWallet(true);
    setWalletSetupError('');
    try {
      const { response, data, finish } = await walletFetch('/api/create-monime-wallet', {});
      if (!response.ok || !/^fac-[A-Za-z0-9_-]+$/.test(String(data.wallet?.monime_account_id || ''))) {
        throw new Error(data.error || 'Wallet setup was not confirmed. Retry without creating another account.');
      }
      finish();
      setSleWallet({ ...data.wallet, balance: null, balanceAvailable: false });
      await fetchLiveBalance();
    } catch (error: any) {
      setWalletSetupError(error.message || 'Wallet setup is unavailable. Please retry.');
    } finally {
      setupBusy.current = false;
      setIsSettingUpWallet(false);
    }
  };

  useEffect(() => {
    if (canLoad && !hasSleAccount) void setupSleWallet();
  }, [profile?.id, canLoad]);

  const walletSetupPanel = canLoad && !hasSleAccount ? (
    <section role="status" className="m-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <p className="font-bold">{isSettingUpWallet ? 'Setting up your SLE wallet…' : 'Finish wallet setup'}</p>
      <p className="mt-1 text-sm">Your dashboard is available. Loading becomes available when your wallet account is ready.</p>
      {walletSetupError && <p role="alert" className="mt-2 text-red-700">{walletSetupError}</p>}
      <button type="button" disabled={isSettingUpWallet} onClick={() => void setupSleWallet()} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{isSettingUpWallet ? 'Setting up…' : 'Retry wallet setup'}</button>
    </section>
  ) : null;

  useEffect(() => {
    fetchLiveBalance();
  }, [profile?.id]);

  const handleCreateUsdWallet = async () => {
    if (!canLoad || isCreatingUsd) { setWalletNotice('Wallet access is unavailable.'); return; }
    setIsCreatingUsd(true);
    try {
      const { response, data, finish } = await walletFetch('/api/create-usd-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to create USD wallet.');

      finish();
      setWalletNotice('USD wallet created successfully.');
      fetchLiveBalance();
    } catch (err: any) {
      setWalletNotice(err.message || 'Unable to create USD wallet.');
    } finally {
      setIsCreatingUsd(false);
    }
  };

  const handleRequest = async () => {
    if (tripLoading || tripError || activeBooking || isRequesting) return;
    if (!pickupCoords || !destinationCoords) {
      return alert('Please select pickup and destination using address search or map pins.');
    }

    if (serviceType === 'scheduled' && !scheduledTime) {
      return alert('Select time for scheduled request.');
    }

    const finalAmount = Number(offerAmount);
    const finalStatus = serviceType === 'scheduled' ? 'pending_admin' : 'pending';
    if (!/^\d+(\.\d{1,2})?$/.test(offerAmount.trim()) || !Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > 1000000) {
      return alert('Enter and review a positive fare with at most two decimal places, up to SLE 1,000,000.');
    }
    const minFare = pricingRates?.[vehicleType]?.min || defaultPricing[vehicleType].min;
    if (finalAmount < minFare) return alert(`Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minFare}`);

    if ((sleWallet?.balance || 0) < finalAmount) {
      return alert(`Insufficient Balance. You need SLE ${finalAmount} to request this trip. Please Load your wallet.`);
    }

    setIsRequesting(true);

    try {
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          ...tripPinFields(pickupCoords, destinationCoords),
          rider_id: profile.id,
          service_type: serviceType,
          vehicle_type: vehicleType,
          passengers_count: passengerCount,
          pickup_location: pickup,
          destination_location: destination,
          fare_amount: finalAmount,
          scheduled_time: serviceType === 'scheduled' ? new Date(scheduledTime).toISOString() : null,
          status: finalStatus
        })
        .select()
        .single();

      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) {
      alert('Request failed: ' + err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const cancelTrip = async () => {
    if (!activeBooking || isRequesting) return;
    
    const isAfterFiveMinutes = elapsedSeconds > 300;
    const penaltyAmount = Number(activeBooking.fare_amount || 0) * 0.01;
    const driverShare = penaltyAmount * 0.5;
    const escrowShare = penaltyAmount * 0.5;

    if (activeBooking.status === 'accepted' && isAfterFiveMinutes) {
      const confirmed = window.confirm(
        `It has been over 5 minutes since driver acceptance. Cancelling now incurs a 1% dispatch fee (SLE ${penaltyAmount.toFixed(2)}), split 50/50 between the driver (SLE ${driverShare.toFixed(2)}) and escrow (SLE ${escrowShare.toFixed(2)}). Continue?`
      );
      if (!confirmed) return;
    }

    setIsRequesting(true);
    setRideNotice('');
    try {
      const result = await updateRide('cancel', activeBooking.id);
      
      if (activeBooking.status === 'accepted') {
        setRideNotice(
          isAfterFiveMinutes
            ? `Trip cancelled. A 1% dispatch fee of SLE ${penaltyAmount.toFixed(2)} was split 50/50 between driver and escrow.`
            : 'Trip cancelled within the 5-minute free window. Full refund returned to your wallet.'
        );
      } else {
        setRideNotice(result.pending ? 'Refund is processing. The cancellation is not settled yet.' : 'Trip cancelled. Any held fare has been returned to your wallet.');
      }
      
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) {
      setRideNotice(err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const executeRidePayment = async () => {
    if (!activeBooking || isRequesting) return;
    setIsRequesting(true);
    setRideNotice('');
    try {
      const result = await updateRide('complete', activeBooking.id);
      if (!result.pending && result.payment?.settled !== true) throw new Error('Driver credit is not confirmed.');
      const driverLeg = result.payment?.transfers?.find((leg: any) => leg.kind === 'driver');
      setRideNotice(`Driver credited SLE ${Number(result.payment.driverEarnings).toFixed(2)}. Receipt: ${driverLeg?.transferId || 'Settled'}.`);
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) {
      setRideNotice(err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const closeModals = () => {
    setIsLoadModalOpen(false);
    setIsPayoutModalOpen(false);
    setIsTransferModalOpen(false);
    setIsProcessingPayout(false);
    setIsProcessingTransfer(false);
    setPayoutAmount('');
    setTransferAmount('');
    setTransferRecipient('');
    setPayoutPhone('');
  };

  const executeTransfer = async () => {
    if (isProcessingTransfer) return;
    if (!canSend) {
      setTransferError(isFrozen ? 'Your wallet is unavailable.' : 'Verify your identity before transferring.');
      return;
    }
    if (!/^fac-[A-Za-z0-9_-]+$/.test(transferRecipient.trim())) {
      setTransferError('Enter a valid recipient account ID.');
      return;
    }

    setIsProcessingTransfer(true);
    setTransferError('');
    setTransferNotice('');

    try {
      const { response, data, finish } = await walletFetch('/api/create-monime-transfer', {
        amount: transferAmount,
        currency: transferCurrency,
        recipientAccountId: transferRecipient.trim()
      });

      if (!response.ok) throw new Error(data.error || 'Transfer could not be submitted.');

      const status = String(data?.status || data?.data?.status || 'completed').toLowerCase();
      setTransferNotice(status === 'completed' ? 'Transfer completed successfully.' : `Transfer ${status}.`);

      if (status === 'completed' || status === 'failed') {
        finish?.();
        setTransferAmount('');
        setTransferRecipient('');
      }

      await fetchLiveBalance();
    } catch (err: any) {
      setTransferError(err.message || 'Transfer failed.');
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  const WalletCards = (
    <WalletCardsView
      sleWallet={sleWallet}
      usdWallet={usdWallet}
      refresh={fetchLiveBalance}
      refreshing={isRefreshing}
      createUsd={handleCreateUsdWallet}
      creatingUsd={isCreatingUsd}
    />
  );

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Where to, {profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider'}? 👋
          </h1>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} disabled={!canLoad || !hasSleAccount || isSettingUpWallet} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Load</button>
          <button onClick={() => setIsPayoutModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Payout</button>
          <button onClick={() => setIsTransferModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Transfer</button>
        </div>
      </header>

      {(rideNotice || walletNotice) && (
        <div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          {rideNotice && <p>{rideNotice}</p>}
          {walletNotice && <p>{walletNotice}</p>}
        </div>
      )}

      {walletSetupPanel}

      <div className="p-4 max-w-6xl mx-auto space-y-4">
        {(activeSection === 'home' || activeSection === 'ride' || !activeSection) && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] gap-4">
            <div className="min-w-0 bg-white p-4 rounded-2xl border shadow-sm space-y-3 h-fit">
              <p className="text-xs text-slate-500">Book your ride, keke, bike, or delivery below.</p>
              <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-2">
                <button onClick={() => setViewMode('active')} className={`font-bold ${viewMode === 'active' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>Active Request</button>
                <button onClick={() => setViewMode('new')} className={`font-bold ${viewMode === 'new' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>Create New</button>
              </div>

              {tripError && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                  {tripError} <button type="button" onClick={retryTrip} className="min-h-11 px-2 font-bold underline">Retry trip</button>
                </p>
              )}

              {tripLoading && !activeBooking && viewMode === 'active' ? (
                <div className="grid grid-cols-1 gap-4 animate-pulse">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4">
                    <div className="h-6 bg-slate-200 rounded w-1/2"></div>
                    <div className="h-12 bg-slate-100 rounded-xl"></div>
                    <div className="h-12 bg-slate-100 rounded-xl"></div>
                  </div>
                </div>
              ) : null}

              {viewMode === 'new' || (!activeBooking && viewMode === 'active') ? (
                <>
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Seats / Passengers (Max 3)</label>
                    <div className="flex gap-2">
                      {[1, 2, 3].map(count => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setPassengerCount(count)}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${
                            passengerCount === count
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                          }`}
                        >
                          {count} Seat{count > 1 ? 's' : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setServiceType('ride')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Car size={16} /> Ride
                    </button>
                    <button
                      onClick={() => setServiceType('delivery')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Package size={16} /> Delivery
                    </button>
                    <button
                      onClick={() => setServiceType('scheduled')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <CalendarClock size={16} /> Schedule
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {(['keke', 'bike', 'car', 'van'] as const).map(v => (
                        <button
                          key={v}
                          onClick={() => setVehicleType(v)}
                          className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-600' : 'bg-slate-100 text-slate-500'}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs text-slate-600">
                      Choose your pickup and destination on the map to calculate the distance.
                    </p>

                    <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-slate-500 font-bold text-sm px-2">Total Fare (SLE)</span>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={offerAmount}
                          onChange={e => setOfferAmount(e.target.value)}
                          className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => setOfferAmount(prev => Math.max(pricingRates[vehicleType]?.min || 1, (Number(prev) || 1) - 5).toString())}
                            className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                          >
                            <Minus size={16} />
                          </button>
                          <button
                            onClick={() => setOfferAmount(prev => ((Number(prev) || 1) + 5).toString())}
                            className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>

                      {Number(offerAmount) > 0 && (
                        <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm mt-2">
                          <div className="text-[11px] font-bold text-emerald-600">Driver Earns: SLE {(Number(offerAmount) * 0.85).toFixed(2)}</div>
                          <div className="text-[11px] font-bold text-rose-500">Platform Fee: SLE {(Number(offerAmount) * 0.15).toFixed(2)}</div>
                        </div>
                      )}
                    </div>

                    {serviceType === 'scheduled' && (
                      <div className="flex items-center gap-2 border p-3 rounded-xl">
                        <CalendarClock size={16} className="text-emerald-600" />
                        <input
                          type="datetime-local"
                          value={scheduledTime}
                          onChange={e => setScheduledTime(e.target.value)}
                          className="w-full outline-none text-sm bg-transparent"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRequest}
                    disabled={isRequesting}
                    className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4"
                  >
                    {isRequesting ? <Loader2 size={20} className="animate-spin mx-auto" /> : 'Confirm Request'}
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  {activeBooking && (activeBooking.status === 'accepted' || activeBooking.status === 'in_progress') ? (
                    <>
                      <Car size={44} className="text-emerald-600 mx-auto mb-3" />
                      <h4 className="font-bold text-lg text-slate-900">
                        {activeBooking.status === 'in_progress' ? 'Trip in Progress!' : 'Driver is on the way!'}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Fare (SLE {Number(activeBooking.fare_amount || 0).toLocaleString()}) held securely in Escrow.
                      </p>

                      {activeBooking.driver && (
                        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-left mb-4">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Assigned Driver</span>
                          <span className="font-bold text-slate-900 block text-sm">{activeBooking.driver.full_name}</span>
                          <span className="text-xs text-slate-600 flex items-center gap-1 mt-0.5"><Smartphone size={13} /> {activeBooking.driver.phone}</span>
                        </div>
                      )}

                      {activeBooking.status === 'accepted' && (
                        <div className={`p-3 rounded-2xl border text-xs mb-3 space-y-1 ${elapsedSeconds <= 300 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                          <div className="flex items-center gap-1.5 font-bold">
                            <Clock size={15} />
                            {elapsedSeconds <= 300 ? (
                              <span>Free Cancellation: {Math.floor((300 - elapsedSeconds) / 60)}:{(300 - elapsedSeconds) % 60 < 10 ? '0' : ''}{(300 - elapsedSeconds) % 60}</span>
                            ) : (
                              <span>Late Cancellation: 1% Fee Applies (Split 50/50)</span>
                            )}
                          </div>
                        </div>
                      )}

                      {activeBooking.status === 'accepted' && (
                        <button onClick={cancelTrip} disabled={isRequesting} className="mb-2 text-rose-600 font-bold border border-rose-200 bg-rose-50 p-2.5 rounded-xl w-full text-xs">
                          Cancel Trip & Release Hold
                        </button>
                      )}

                      {activeBooking.status === 'in_progress' && (
                        <button
                          onClick={executeRidePayment}
                          disabled={isRequesting}
                          className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl text-xs hover:bg-emerald-700 transition shadow-lg flex items-center justify-center gap-2"
                        >
                          {isRequesting ? <Loader2 size={18} className="animate-spin" /> : 'Confirm Arrival & Release Driver Payment'}
                        </button>
                      )}
                    </>
                  ) : activeBooking ? (
                    <>
                      <Loader2 size={36} className="animate-spin text-orange-600 mx-auto mb-3" />
                      <h4 className="font-bold text-base text-slate-900">
                        {activeBooking.status === 'pending_admin' ? 'Request sent to Dispatch...' : 'Searching for Drivers...'}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">Please wait while nearby drivers review your request.</p>
                      <button onClick={cancelTrip} className="text-rose-600 text-xs font-bold hover:underline mt-3">Cancel Request</button>
                    </>
                  ) : null}

                  {activeBooking && ['pending', 'pending_admin'].includes(activeBooking.status) && ['ride', 'delivery'].includes(activeBooking.service_type) && (
                    <div className="mt-3 text-left">
                      <FareNegotiation key={`${profile?.id}:${activeBooking.id}`} userId={profile?.id} bookingId={activeBooking.id} role="rider" onFareChange={applyFareSnapshot} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="min-w-0">
              {activeBooking && ['accepted', 'in_progress'].includes(activeBooking.status) ? (
                <ActiveTripMap key={activeBooking.id} userId={profile?.id} bookingId={activeBooking.id} />
              ) : (
                <RideLocationPicker
                  key={profile?.id || 'location-picker'}
                  userId={profile?.id}
                  onChange={(selection: TripLocations) => {
                    setPickup(selection.pickup?.address || '');
                    setDestination(selection.destination?.address || '');
                    setPickupCoords(selection.pickup?.coords || null);
                    setDestinationCoords(selection.destination?.coords || null);
                    setTripDistanceKm(selection.distanceKm);

                    if (selection.distanceKm !== null) {
                      const rate = pricingRates?.[vehicleType] || defaultPricing[vehicleType] || { min: 15, perKm: 3 };
                      setOfferAmount(
                        Math.max(
                          rate.min,
                          Math.ceil((rate.min + selection.distanceKm * rate.perKm) / 5) * 5
                        ).toString()
                      );
                    } else {
                      setOfferAmount('');
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}

        {activeSection === 'wallet' && (
          <div className="w-full space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">My Wallets</h2>
            {WalletCards}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
              <h3 className="text-xl font-bold text-slate-900 mb-2">Wallet Actions</h3>
              <p className="text-sm text-slate-500 mb-8">Load your wallet anytime. Verify your identity to transfer or withdraw.</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full">
                <button
                  onClick={() => setIsLoadModalOpen(true)}
                  disabled={!canLoad || !hasSleAccount || isSettingUpWallet}
                  className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm"><ArrowRight size={24} className="rotate-135" /></div>
                  Load
                </button>

                <button
                  onClick={() => setIsPayoutModalOpen(true)}
                  disabled={!canSend || !hasSleAccount}
                  className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm"><ArrowRight size={24} className="-rotate-45" /></div>
                  Withdraw
                </button>

                <button
                  onClick={() => setIsTransferModalOpen(true)}
                  disabled={!canSend || !hasSleAccount}
                  className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm"><Users size={24} /></div>
                  Transfer
                </button>
              </div>
            </div>

            <TransactionHistory transactions={transactions} onSelect={setSelectedTx} />
          </div>
        )}
      </div>

      {selectedTx && <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      {isLoadModalOpen && (
        <WalletTopUp userId={profile?.id} allowed={canLoad && hasSleAccount} onClose={() => setIsLoadModalOpen(false)} onPaid={fetchLiveBalance} />
      )}
      {isPayoutModalOpen && (
        <PayoutPanel userId={profile?.id} allowed={canSend && hasSleAccount} onClose={() => setIsPayoutModalOpen(false)} onBalanceChange={fetchLiveBalance} />
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} disabled={isProcessingTransfer} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Account Transfer</h2>
            <label className="block my-4 text-sm font-bold">
              Send from
              <select
                value={transferCurrency}
                disabled={isProcessingTransfer}
                onChange={e => { setTransferCurrency(e.target.value as 'SLE' | 'USD'); setTransferError(''); setTransferNotice(''); }}
                className="block w-full rounded-xl border p-3 mt-2"
              >
                <option value="SLE">SLE wallet → SLE account</option>
                <option value="USD">USD wallet → USD account</option>
              </select>
            </label>

            {transferError && <p role="alert" className="mb-3 text-sm text-red-700 font-bold">{transferError}</p>}
            {transferNotice && <p role="status" className="mb-3 text-sm text-emerald-700 font-bold">{transferNotice}</p>}

            <div className="space-y-4 mb-6">
              <input
                type="number"
                placeholder={`Amount (${transferCurrency})`}
                value={transferAmount}
                disabled={isProcessingTransfer}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500"
              />
              <input
                type="text"
                disabled={isProcessingTransfer}
                placeholder="Recipient Account ID (e.g. fac-k6V8...)"
                value={transferRecipient}
                onChange={e => setTransferRecipient(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500"
              />
            </div>

            <button
              onClick={executeTransfer}
              disabled={!canSend || !hasSleAccount || isProcessingTransfer || !transferAmount || !transferRecipient}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50"
            >
              {isProcessingTransfer ? <Loader2 size={20} className="animate-spin" /> : <Users size={20} />}
              Send Transfer
            </button>
          </div>
        </div>
      )}

      {showPolicy && <PolicyModal onAccept={handleAcceptPolicy} />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// PersonalTools Component
// -----------------------------------------------------------------------------
function PersonalTools({ uid, panel, preferences, error, loading, refresh, onClose }: {
  uid: string; panel: 'places' | 'cards'; preferences: Preferences | null; error: string; loading: boolean; refresh: () => Promise<boolean>; onClose: () => void;
}) {
  const [kind, setKind] = useState<'home' | 'work'>('home');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [expected, setExpected] = useState<number | null>(null);
  const [nickname, setNickname] = useState('');
  const [brand, setBrand] = useState('Visa');
  const [lastFour, setLastFour] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const mutex = useRef(false);
  const active = useRef(true);
  const dirty = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { active.current = true; heading.current?.focus(); return () => { active.current = false; }; }, []);
  const selectKind = (next: 'home' | 'work') => {
    const saved = preferences?.places.find(p => p.kind === next);
    setKind(next); setAddress(saved?.address || ''); setExpected(saved?.version ?? null);
    setCoords(saved?.latitude != null && saved?.longitude != null ? [saved.longitude, saved.latitude] : null);
    dirty.current = false; setFailure(''); setNotice('');
  };
  useEffect(() => { if (!dirty.current && preferences) selectKind(kind); }, [preferences]);

  async function mutate(name: string, params: Record<string, unknown>, success: string) {
    if (mutex.current || !preferences || loading || error) return;
    mutex.current = true; setBusy(true); setFailure(''); setNotice('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user.id !== uid) throw new Error('Your account changed. Reopen this screen.');
      const result = await supabase.rpc(name, { p_user_id: uid, ...params });
      if (result.error) throw new Error(result.error.message);
      if (name==='matmove_save_place'&&(!result.data||result.data.kind!==params.p_kind||result.data.address!==params.p_address||!Number.isSafeInteger(result.data.version))) throw new Error('Address save was not confirmed.');
      if (name==='matmove_save_card_reference'&&(!result.data?.id||result.data.brand!==params.p_brand||result.data.last_four!==params.p_last_four)) throw new Error('Card reference save was not confirmed.');
      if (name.startsWith('matmove_delete_')&&typeof result.data!=='boolean') throw new Error('Removal was not confirmed.');
      if (!active.current) return;
      dirty.current = false;
      const reloaded = await refresh();
      if (!reloaded) throw new Error('Save completed, but preferences could not be reloaded.');
      if (active.current) { setNotice(success); if (panel === 'cards') { setNickname(''); setLastFour(''); } }
    } catch (e: any) { if (active.current) setFailure(e.message || 'Could not save. Try again.'); }
    finally { mutex.current = false; if (active.current) setBusy(false); }
  }

  function locate() {
    if (busy || !navigator.geolocation) { setFailure('Location is not available. Enter an address instead.'); return; }
    mutex.current = true; setBusy(true); setFailure('');
    navigator.geolocation.getCurrentPosition(position => {
      mutex.current = false;
      if (!active.current) return;
      dirty.current = true; setCoords([position.coords.longitude, position.coords.latitude]);
      setNotice('Current location selected. Confirm street address before saving.'); setBusy(false);
    }, () => { mutex.current = false; if (active.current) { setBusy(false); setFailure('Could not get location. Enter address manually.'); } }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }

  const disabled = busy || loading || !preferences || !!error;
  return (
    <section className="mm-surface mm-tools" aria-labelledby="mm-tools-heading">
      <div className="mm-row"><h2 id="mm-tools-heading" tabIndex={-1} ref={heading}>{panel === 'places' ? 'Saved places' : 'Payment methods'}</h2><button type="button" className="mm-icon-button" disabled={busy} onClick={onClose} aria-label="Close preferences"><X size={19}/></button></div>
      {loading && <p role="status" className="mm-loading">Loading preferences…</p>}
      {error && <div role="alert" className="mm-alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {panel === 'places' ? <>
        <div className="mm-toggle">{(['home','work'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => selectKind(value)}>{value === 'home' ? 'Home' : 'Work'}</button>)}</div>
        <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_place', { p_kind: kind, p_address: address.trim(), p_latitude: coords?.[1] ?? null, p_longitude: coords?.[0] ?? null, p_expected: expected }, 'Address saved.'); }}>
          <label className="mm-field">{kind === 'home' ? 'Home address' : 'Work address'}<input autoComplete="street-address" maxLength={300} minLength={3} required disabled={disabled} value={address} onChange={e => { dirty.current = true; setAddress(e.target.value); setCoords(null); }}/></label>
          <div className="mm-form-actions"><button type="button" disabled={disabled} onClick={locate} className="mm-secondary">Use current location</button><button type="submit" className="mm-primary" disabled={disabled || address.trim().length < 3}>{busy ? 'Saving…' : 'Save address'}</button>{expected != null && <button type="button" className="mm-danger" disabled={disabled} onClick={() => void mutate('matmove_delete_place', { p_kind: kind, p_expected: expected }, 'Address removed.')}><Trash2 size={16}/> Remove</button>}</div>
        </form>
      </> : <>
        <p className="mm-payment-status"><Wallet size={18}/> Mobile Money funds your MatMove wallet.</p>
        <p className="mm-info">Card payments are not active. You can keep a card reference for convenience. Never enter a full card number, CVV or PIN here.</p>
        {preferences?.cardReferences.map(card => <div className="mm-card-reference" key={card.id}><CreditCard size={22}/><span><b>{card.nickname}</b><small>{card.brand} · •••• {card.last_four}</small></span><button className="mm-icon-button" type="button" disabled={disabled} aria-label={`Remove ${card.nickname}`} onClick={() => void mutate('matmove_delete_card_reference', { p_id: card.id }, 'Card reference removed.')}><Trash2 size={17}/></button></div>)}
        <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_card_reference', { p_nickname: nickname.trim(), p_brand: brand, p_last_four: lastFour }, 'Card reference saved.'); }}>
          <div className="mm-form-grid"><label className="mm-field">Nickname<input autoComplete="off" placeholder="Personal card" maxLength={40} required disabled={disabled} value={nickname} onChange={e => setNickname(e.target.value)}/></label><label className="mm-field">Brand<select value={brand} disabled={disabled} onChange={e => setBrand(e.target.value)}>{['Visa','Mastercard','Other'].map(b => <option key={b}>{b}</option>)}</select></label><label className="mm-field">Last 4 digits<input inputMode="numeric" maxLength={4} pattern="[0-9]{4}" placeholder="1234" required disabled={disabled} value={lastFour} onChange={e => setLastFour(e.target.value.replace(/\D/g, '').slice(0,4))}/></label></div>
          <button className="mm-primary" type="submit" disabled={disabled || !nickname.trim() || !/^\d{4}$/.test(lastFour)}>{busy ? 'Saving…' : 'Add card reference'}</button>
        </form>
      </>}
      {failure && <p className="mm-alert" role="alert">{failure}</p>}
      {notice && <p className="mm-success" role="status">{notice}</p>}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Travel Booking Components
// -----------------------------------------------------------------------------
function CancelTravelModal({ booking, onSuccess, onClose }: any) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { setError('Please enter a cancellation reason.'); return; }
    setBusy(true);
    setError('');

    try {
      const { error: cancelError } = await supabase.from('travel_bookings').update({
        status: 'cancel_requested',
        cancel_reason: reason.trim(),
        cancel_requested_at: new Date().toISOString()
      }).eq('id', booking.id);

      if (cancelError) throw cancelError;
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to submit cancellation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <XCircle className="text-rose-600" size={18} /> Cancel Travel Booking
          </h3>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Are you sure you want to cancel your Freetown – Accra travel booking? Please provide a reason for Dispatch review:
        </p>

        {error && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl font-bold">{error}</div>}

        <form onSubmit={handleConfirmCancel} className="space-y-4">
          <textarea
            required
            rows={3}
            placeholder="e.g. Change of schedule, unable to travel on this date..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full p-3 border border-slate-200 rounded-xl text-xs outline-none focus:border-rose-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !reason.trim()}
              className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Submit Cancellation'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs"
            >
              Keep Booking
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TravelBookingModal({ uid, userName, userPhone, walletBalance, priceSle, departureDate, availableSeats, existingBooking, onSuccess, onClose }: any) {
  const [passengerCount, setPassengerCount] = useState(1);
  const [fullName, setFullName] = useState(userName);
  const [phone, setPhone] = useState(userPhone);
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totalCost = passengerCount * priceSle;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) { setError('You must accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest regulations.'); return; }
    if (passengerCount > availableSeats) { setError(`Only ${availableSeats} seat(s) remain on this departure.`); return; }

    setBusy(true); setError('');
    try {
      const { error: insertError } = await supabase.from('travel_bookings').insert({
        user_id: uid,
        passenger_name: fullName,
        passenger_phone: phone,
        passenger_address: address,
        emergency_name: emergencyName,
        emergency_phone: emergencyPhone,
        passengers_count: passengerCount,
        departure_date: departureDate || undefined,
        fare_amount: totalCost,
        status: 'pending_approval',
        is_paid: false
      });
      if (insertError) throw insertError;
      setSuccess('Travel request submitted. Dispatch is reviewing seat availability.');
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) { setError(err.message || 'Submission failed.'); }
    finally { setBusy(false); }
  };

  const handlePayApproved = async () => {
    if (walletBalance < (existingBooking.fare_amount || priceSle)) {
      setError(`Insufficient wallet balance. You need SLE ${(existingBooking.fare_amount || priceSle).toLocaleString()}`);
      return;
    }

    setBusy(true); setError(''); setSuccess('');
    try {
      const res = await walletFetch('/api/create-monime-transfer', {
        amount: existingBooking.fare_amount,
        currency: 'SLE',
        target: 'travel',
        bookingId: existingBooking.id,
        description: `Travel Payment Freetown-Accra (${existingBooking.passengers_count} seats)`
      });

      if (!res.response.ok || !res.data?.success) {
        throw new Error(res.data?.error || 'Payment processing failed.');
      }

      res.finish?.();
      setSuccess(`Payment confirmed! Ref: ${res.data.paymentId || 'Settled'}. Seats are officially booked.`);
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) { setError(err.message || 'Payment processing failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900">Freetown – Accra Direct Bus</h2>
        <p className="text-xs text-slate-500 mt-0.5">Departures 1st & 15th every month · SLE {priceSle.toLocaleString()} / seat</p>

        {error && <div className="mt-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl font-bold">{error}</div>}
        {success && <div className="mt-4 p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">{success}</div>}

        {existingBooking && existingBooking.status === 'approved' && !existingBooking.is_paid ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <p className="text-sm font-bold text-emerald-900">Seats Approved by Dispatch!</p>
              <div className="text-2xl font-black text-slate-900 mt-2">SLE {Number(existingBooking.fare_amount).toLocaleString()}</div>
            </div>
            <button onClick={handlePayApproved} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl text-sm disabled:opacity-50 shadow-md">
              {busy ? 'Processing Payment…' : 'Debit Wallet & Confirm Seats'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Seats to Book (Max 3)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(num => (
                  <button key={num} type="button" onClick={() => setPassengerCount(num)} className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${passengerCount === num ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                    {num} Seat{num > 1 ? 's' : ''} (SLE {(num * priceSle).toLocaleString()})
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Passenger Name</label><input type="text" required value={fullName} onChange={e => setFullName(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" /></div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Phone</label><input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" /></div>
            </div>

            <div><label className="block text-xs font-bold text-slate-700 mb-1">Address</label><input type="text" required placeholder="Street / Community" value={address} onChange={e => setAddress(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" /></div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border space-y-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Emergency Contact</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" required placeholder="Contact Name" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
                <input type="text" required placeholder="Contact Phone" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
              <input type="checkbox" id="policy" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              <label htmlFor="policy" className="text-[11px] text-amber-900 leading-relaxed cursor-pointer">I accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest regulations.</label>
            </div>

            <button type="submit" disabled={busy || availableSeats <= 0} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl text-sm disabled:opacity-50">
              {busy ? 'Submitting…' : availableSeats <= 0 ? 'Bus is Full' : 'Submit Booking Request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function EventsModal({ uid, userPhone, walletBalance, events, eventsError, onRetry, onWalletRefresh, onClose }: any) {
  const [selectedTicketCount, setSelectedTicketCount] = useState<Record<string, number>>({});
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const fetchMyTickets = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('event_tickets')
        .select('*, event:platform_events(title, venue, event_date)')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (data) setMyTickets(data);
    } catch {
      // Handled silently
    }
  }, [uid]);

  useEffect(() => {
    void fetchMyTickets();
  }, [fetchMyTickets]);

  const handleBuyTickets = async (evt: any) => {
    const count = selectedTicketCount[evt.id] || 1;
    const total = Number(evt.ticket_price) * count;

    if (walletBalance < total) {
      setError(`Insufficient balance. You need SLE ${total.toLocaleString()}`);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const res = await walletFetch('/api/create-monime-transfer', {
        amount: total,
        currency: 'SLE',
        target: 'event',
        eventId: evt.id,
        quantity: count,
        userPhone: userPhone,
        description: `Ticket Purchase (${count} pass): ${evt.title}`
      });

      if (!res.response.ok || !res.data?.success) {
        throw new Error(res.data?.error || 'Payment failed.');
      }

      res.finish?.();
      setNotice(`Payment Confirmed! Ticket Code: ${res.data.ticketCode} (Payment ID: ${res.data.paymentId}). Your pass is ready for gate check-in.`);
      void fetchMyTickets();
      onWalletRefresh?.();
    } catch (err: any) {
      setError(err.message || 'Payment processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto space-y-4">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Sparkles className="text-sky-600" size={22} /> MatMove Events Hub
        </h2>
        <p className="text-xs text-slate-500">Official event tickets verified through Monime ledger</p>

        {error && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl font-bold">{error}</div>}
        {notice && <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-2xl leading-relaxed">{notice}</div>}
        {eventsError && <div role="alert" className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">{eventsError} <button type="button" className="underline font-bold" onClick={() => void onRetry?.()}>Retry</button></div>}

        {/* User's Verified Tickets */}
        {myTickets.length > 0 && (
          <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-3">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Your Verified Gate Passes</span>
            <div className="space-y-2">
              {myTickets.map(t => (
                <div key={t.id} className="p-3 bg-slate-800 rounded-xl flex items-center justify-between text-xs border border-slate-700">
                  <div>
                    <span className="font-mono text-emerald-400 font-black block text-sm">{t.ticket_code}</span>
                    <span className="font-bold text-slate-200">{t.event?.title || 'Event'}</span>
                    <span className="text-slate-400 block text-[11px]">{t.tickets_count} Pass(es) · Payment ID: {t.payment_id?.slice(0, 8)}…</span>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${t.status === 'used' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {t.status === 'used' ? 'Admitted' : 'Ready to Scan'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 pt-2">
          <span className="text-xs font-bold text-slate-700 block">Available Events</span>
          {events.map((evt: any) => {
            const count = selectedTicketCount[evt.id] || 1;
            const total = Number(evt.ticket_price) * count;

            return (
              <div key={evt.id} className="border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center bg-slate-50">
                <img src={evt.flyer_url || '/logo.png'} alt={evt.title} className="w-full sm:w-28 h-28 rounded-xl object-cover bg-slate-200" />
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 text-sm">{evt.title}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{evt.venue} · {new Date(evt.event_date).toLocaleDateString()}</p>
                  
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs font-bold text-slate-600">Quantity:</span>
                    {[1, 2, 3].map(n => (
                      <button
                        key={n}
                        type="button"
                        disabled={busy}
                        onClick={() => setSelectedTicketCount({ ...selectedTicketCount, [evt.id]: n })}
                        className={`w-7 h-7 rounded-lg text-xs font-bold border transition ${
                          count === n ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-base font-black text-sky-600 block mb-2">SLE {total.toLocaleString()}</span>
                  <button
                    disabled={busy}
                    onClick={() => handleBuyTickets(evt)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
                  >
                    {busy ? 'Processing…' : `Buy ${count} Ticket${count > 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Other Extracted Helper Components (RiderShop, RiderTrips, PolicyModal, CustomerTripSwitcher)
// -----------------------------------------------------------------------------
function RiderShop({ profile, wallet }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [orderQty, setOrderQty] = useState(1);
  const checkoutDialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = checkoutDialog.current;
    if (orderModalOpen && dialog && !dialog.open) dialog.showModal();
    else if (!orderModalOpen && dialog?.open) dialog.close();
  }, [orderModalOpen]);
  const cartWriteLock = useRef(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [cartNotice, setCartNotice] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');

  const fetchShopProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError('');
    try {
      let result = await supabase.from('products').select('*, merchant:merchant_id(business_name, whatsapp_number)').order('created_at', { ascending: false });
      if (result.error) result = await supabase.from('products').select('*').order('created_at', { ascending: false });
      if (result.error) throw result.error;
      setProducts(result.data || []);
    } catch {
      setProductsError('Could not load shop products.');
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShopProducts();
  }, [fetchShopProducts]);

  const handleAddToCart = async (product: any) => {
    if (cartWriteLock.current || !catalogCheckoutAllowed(product)) return;
    cartWriteLock.current = true; setCartBusy(true);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) throw new Error('Sign in again.');
      const { error } = await supabase.from('cart_items').insert({
        rider_id: profile.id,
        product_id: product.id,
        quantity: 1
      });
      if (error) throw error;
      setCartNotice(`${product.name} added to cart.`);
    } catch (e: any) {
      setCartNotice(e.message || 'Could not update cart.');
    } finally {
      cartWriteLock.current = false; setCartBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingBag className="text-blue-600" size={28} />
        <h1 className="text-3xl font-bold text-slate-900">Shop Marketplace</h1>
      </div>
      {cartNotice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm">{cartNotice}</p>}
      {productsLoading ? (
        <div className="py-12 text-center text-sm text-slate-500"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> Loading products…</div>
      ) : productsError ? (
        <div className="p-4 bg-red-50 text-red-800 text-sm rounded-xl">{productsError}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shadow-sm">
              <ProductGallery product={p} />
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-base text-slate-900">{p.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                </div>
                <div className="mt-4 pt-3 border-t">
                  <span className="text-lg font-black text-blue-600 block mb-3">{catalogMoney(p.price, p.currency ?? 'SLE')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={cartBusy || !catalogCheckoutAllowed(p)}
                      onClick={() => handleAddToCart(p)}
                      className="bg-slate-100 text-slate-700 text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <ShoppingBag size={14} /> Add to Cart
                    </button>
                    <button
                      disabled={!catalogCheckoutAllowed(p)}
                      onClick={() => { setSelectedProduct(p); setOrderQty(1); setOrderModalOpen(true); }}
                      className="bg-blue-600 text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <ArrowRight size={14} /> Order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <dialog ref={checkoutDialog} onClose={() => setOrderModalOpen(false)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border-0 bg-white p-5 shadow-2xl backdrop:bg-slate-950/60">
        <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-xl font-bold">{selectedProduct?.name || 'Order Checkout'}</h2><button type="button" className="text-slate-400" onClick={() => setOrderModalOpen(false)}><X size={20} /></button></div>
        {selectedProduct && (
          <label className="block text-xs font-bold text-slate-700 mb-3">
            Quantity
            <input type="number" min="1" max="100" value={orderQty} onChange={e => setOrderQty(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border rounded-xl p-2.5 text-sm" />
          </label>
        )}
        <MerchantCheckout userId={profile?.id} items={selectedProduct ? [{ productId: selectedProduct.id, quantity: orderQty }] : []} initialPhone={profile?.phone || profile?.phone_number || ''} />
      </dialog>
    </div>
  );
}

function RiderTrips({ profile }: any) {
  return <TripHistory userId={profile?.id} role="rider" />;
}

function PolicyModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="bg-slate-900 p-6 text-white shrink-0">
          <h2 className="text-xl font-bold">MatMove Safety & Compliance Policy</h2>
          <p className="text-xs text-slate-400 mt-1">Sierra Leone Road Safety Authority (SLRSA) Guidelines</p>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-sm text-slate-600 space-y-4">
          <p><strong>1. Compliance with SLRSA:</strong> All users must strictly adhere to road traffic regulations set forth by SLRSA.</p>
          <p><strong>2. Liability:</strong> MatMove operates as a technology platform connecting users and is not liable for traffic accidents or road delays.</p>
          <p><strong>3. Vehicle Safety:</strong> All vehicles must be inspected, insured, and licensed.</p>
        </div>
        <div className="p-4 border-t bg-slate-50 shrink-0">
          <button onClick={onAccept} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md">
            I Accept & Agree
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomerTripSwitcher({bookings,selectedId,creating,canCreate,busy,onSelect,onNew}:any){
  if(!bookings?.length)return null;
  return (
    <section aria-label="Your active requests" className="m-3 space-y-3 rounded-xl border bg-white p-3">
      <h3 className="font-bold">Your active requests</h3>
      <div className="flex flex-wrap gap-2">
        {bookings.map((b:any)=>(
          <button 
            type="button" 
            key={b.id} 
            disabled={busy} 
            aria-pressed={!creating&&selectedId===b.id} 
            onClick={()=>onSelect(b.id)} 
            className="min-h-11 rounded-lg border px-3 text-left text-sm"
          >
            <span className="font-bold">{b.service_type||'Ride'} · {b.status.replace(/_/g,' ')}</span><br/>
            <span>{b.destination_location||b.id}</span>
          </button>
        ))}
      </div>
      <button type="button" disabled={busy||!canCreate||creating} onClick={onNew} className="min-h-11 rounded-lg bg-blue-700 px-3 font-bold text-white disabled:opacity-50">
        Book another trip
      </button>
      <p className="text-xs text-slate-600">
        Existing trips remain active. Each request has its own fare and payment. Confirm the previous request before retrying an uncertain submission.
        {!canCreate?' Resolve your pending request or reload after a read error before creating another.':''}
      </p>
    </section>
  );
}