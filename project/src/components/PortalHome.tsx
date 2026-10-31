import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  ArrowRight, Briefcase, Car, CreditCard, Eye, EyeOff, 
  Home, MapPin, Navigation, RefreshCw, ShieldCheck, 
  ShoppingBag, Store, Trash2, Wallet, X, Bus, Ticket, Sparkles, CheckCircle2, Calendar 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { walletFetch } from '@/lib/apiFetch';
import { ArcadeGames } from '@/components/ArcadeGames';

type Place = { kind: 'home' | 'work'; address: string; latitude: number | null; longitude: number | null; version: number };
type CardReference = { id: string; nickname: string; brand: string; last_four: string };
type Preferences = { user_id: string; places: Place[]; cardReferences: CardReference[] };
type Props = { profile: any; onNavigate: (section: any) => void };

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
  const [panel, setPanel] = useState<'places' | 'cards' | 'travel' | 'events' | null>(null);

  // Travel Bus dynamic settings & booking state
  const [busSettings, setBusSettings] = useState<any>({ total_seats: 50, price_usd: 100, price_sle: 2400 });
  const [confirmedSeats, setConfirmedSeats] = useState(0);
  const [existingBooking, setExistingBooking] = useState<any>(null);

  // Events Hub state
  const [events, setEvents] = useState<any[]>([]);

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
      if (data?.user_id !== uid || !Array.isArray(data.places) || !Array.isArray(data.cardReferences)) throw new Error('Preferences could not be verified.');
      if (await sameIdentity() && mounted.current) { setPreferences(data); return true; }
      return false;
    } catch (error: any) {
      if (mounted.current) setPreferencesError(error.message || 'Could not load preferences.');
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

  const fetchTravelAndEvents = useCallback(async () => {
    try {
      const { data: sData } = await supabase.from('travel_settings').select('*').eq('id', 'bus_ghana').maybeSingle();
      if (sData) setBusSettings(sData);

      const { data: bData } = await supabase.from('travel_bookings').select('passengers_count, is_paid, status');
      if (bData) {
        const total = bData.filter(b => b.is_paid || b.status === 'boarded').reduce((acc, curr) => acc + (curr.passengers_count || 1), 0);
        setConfirmedSeats(total);
      }

      const { data: userBooking } = await supabase.from('travel_bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle();
      setExistingBooking(userBooking);

      const { data: evtData } = await supabase.from('platform_events').select('*').eq('is_active', true).order('event_date', { ascending: true });
      if (evtData) setEvents(evtData);
    } catch {
      // Handled silently
    }
  }, [uid]);

  useEffect(() => {
    mounted.current = true;
    void refreshPreferences();
    void refreshWallets();
    void refreshTrips();
    void fetchTravelAndEvents();

    const refreshVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshWallets();
        void refreshTrips();
        void fetchTravelAndEvents();
      }
    };
    const timer = window.setInterval(refreshVisible, 30000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refreshPreferences, refreshWallets, refreshTrips, fetchTravelAndEvents]);

  const wallet = wallets?.[currency === 'SLE' ? 'sleWallet' : 'usdWallet'];
  const verifiedBalance = wallet?.user_id === uid && wallet?.balanceAvailable === true && typeof wallet.balance === 'number' && Number.isFinite(wallet.balance);
  const name = String(profile.first_name || profile.full_name || profile.business_name || 'there').split(' ')[0];

  const shortcuts = role === 'driver'
    ? [{ section: 'ride', label: 'Driver radar', detail: 'Go online and find requests', Icon: Navigation }, { section: 'trips', label: 'My trips', detail: 'View trip details and history', Icon: Car }]
    : [{ section: 'ride', label: 'Book a ride', detail: 'Choose pickup and destination', Icon: Car }, { section: role === 'merchant' ? 'inventory' : 'shop', label: role === 'merchant' ? 'My business' : 'Shop', detail: role === 'merchant' ? 'Manage products and orders' : 'Explore local products', Icon: role === 'merchant' ? Store : ShoppingBag }];

  const availableSeats = Math.max(0, (busSettings.total_seats || 50) - confirmedSeats);
  const isBusFull = availableSeats <= 0;

  if (selectedGame) return <ArcadeGames key={`${uid}:${selectedGame}`} userId={uid} initialGame={selectedGame} onBack={() => setSelectedGame(null)} />;

  return (
    <main className="mm-home">
      <header className="mm-home-heading">
        <div className="mm-brand">
          <img src="/logo.jpg" alt="MatMove" width="40" height="40"/>
          <span>Wi dey move<span className="mm-muted">Your everyday, connected.</span></span>
        </div>
        <button className="mm-icon-button" type="button" aria-label="Open your account" onClick={() => onNavigate('account')}>
          <ShieldCheck size={22}/>
        </button>
      </header>

      <div className="mm-welcome">
        <p className="mm-eyebrow">{role === 'merchant' ? 'Business space' : role === 'driver' ? 'Driver space' : 'Your MatMove'}</p>
        <h1>Hello, {name}.</h1>
        <p>Where will today take you?</p>
      </div>

      <div className="mm-home-grid">
        {/* Wallet Overview with SLE and USD currency switcher */}
        <section className={`mm-home-wallet mm-home-wallet-${currency.toLowerCase()}`} aria-label="Wallet overview">
          <div className="mm-row">
            <div className="mm-currency-tabs" aria-label="Wallet currency">
              {(['SLE','USD'] as const).map(c => (
                <button key={c} type="button" aria-pressed={currency === c} onClick={() => { setCurrency(c); setVisible(false); }}>
                  {c}
                </button>
              ))}
            </div>
            <button type="button" className="mm-glass-button" aria-label="Refresh balances" disabled={balanceLoading} onClick={() => void refreshWallets()}>
              <RefreshCw size={18} className={balanceLoading ? 'animate-spin' : ''}/>
            </button>
          </div>

          <p className="mm-wallet-label">{currency === 'SLE' ? 'Leone wallet' : 'US dollar wallet'}</p>

          <div className="mm-balance-row">
            <strong aria-live="polite">
              {currency} {visible ? balanceLoading ? (
                <span className="inline-block h-6 w-24 bg-white/20 rounded animate-pulse"></span>
              ) : verifiedBalance ? wallet.balance.toFixed(2) : '—' : <span aria-label="Balance hidden">••••••</span>}
            </strong>
            <button type="button" className="mm-glass-button" aria-label={visible ? 'Hide balance' : 'Show balance'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>
              {visible ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>
          </div>

          <p className="mm-wallet-caption">
            {balanceLoading ? 'Checking your wallet…' : balanceError ? 'Balance could not be loaded.' : wallet?.is_frozen || profile.is_wallet_frozen ? 'Wallet frozen · contact support' : !wallet ? 'Open Wallet to check setup.' : !verifiedBalance ? 'Open Wallet to check account status.' : 'Available balance · verified with your wallet provider'}
          </p>

          <button className="mm-wallet-open" type="button" onClick={() => onNavigate('wallet')}>
            Open wallet <ArrowRight size={17}/>
          </button>
        </section>

        {/* Shortcuts */}
        <section className="mm-services" aria-label="Quick actions">
          {shortcuts.map(({ section, label, detail, Icon }) => (
            <button type="button" className="mm-service" key={section} onClick={() => onNavigate(section)}>
              <span className="mm-service-icon"><Icon size={25}/></span>
              <span><b>{label}</b><small>{detail}</small></span>
              <ArrowRight size={18}/>
            </button>
          ))}
          <div className="mm-small-actions">
            <button type="button" onClick={() => onNavigate('wallet')}><Wallet size={18}/> Load with Mobile Money</button>
            <button type="button" onClick={() => onNavigate('account')}><ShieldCheck size={18}/> My account</button>
          </div>
        </section>

        {/* Travel to Ghana Section with Live Bus Capacity & Pricing */}
        <section className="mm-surface" aria-label="Travel & Bus Booking">
          <div className="mm-row">
            <h2>Travel to Ghana</h2>
            <span className="text-xs text-slate-500 font-bold">1st & 15th every month</span>
          </div>
          <p className="mb-2 text-sm text-slate-600">
            Freetown to Accra Direct Bus. Price: <b>${busSettings.price_usd || 100} / SLE {Number(busSettings.price_sle || 2400).toLocaleString()}</b> per seat.
          </p>

          <div className="mb-3 flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Seat Capacity: {busSettings.total_seats || 50} Seats</span>
            <span className={isBusFull ? 'text-rose-600' : 'text-emerald-700'}>
              {isBusFull ? 'BUS FULL' : `${availableSeats} Seats Available`}
            </span>
          </div>

          {existingBooking ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-500 uppercase">Your Reservation</span>
                <span className={`px-2.5 py-0.5 rounded-full font-bold ${
                  existingBooking.is_paid ? 'bg-emerald-100 text-emerald-800' :
                  existingBooking.status === 'approved' ? 'bg-indigo-100 text-indigo-800' :
                  existingBooking.status === 'boarded' ? 'bg-purple-100 text-purple-800' :
                  existingBooking.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {existingBooking.is_paid ? 'Paid & Confirmed' : existingBooking.status === 'approved' ? 'Approved (Ready to Pay)' : existingBooking.status}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                Freetown – Accra Direct ({existingBooking.passengers_count} Seat{existingBooking.passengers_count > 1 ? 's' : ''})
              </p>
              {existingBooking.status === 'approved' && !existingBooking.is_paid && (
                <button
                  type="button"
                  onClick={() => setPanel('travel')}
                  className="w-full mt-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500"
                >
                  Confirm & Pay SLE {Number(existingBooking.fare_amount).toLocaleString()}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={isBusFull}
              onClick={() => setPanel('travel')}
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
                  {isBusFull ? 'All 50 seats occupied. Next session opens soon.' : 'Book up to 3 passengers. Departures 7:00 AM sharp.'}
                </span>
              </div>
              <ArrowRight size={24} className={isBusFull ? 'text-slate-300' : 'text-blue-300'}/>
            </button>
          )}
        </section>

        {/* Upcoming Events Hub Card */}
        <section className="mm-surface" aria-label="Upcoming Events Hub">
          <div className="mm-row">
            <h2 className="flex items-center gap-2">
              <Ticket className="text-sky-600" size={20} /> Events & Ticket Gate
            </h2>
            <button type="button" className="mm-text-button" onClick={() => setPanel('events')}>View all</button>
          </div>
          <p className="mb-3 text-sm text-slate-600">Official tickets with single checkout for up to 3 passes.</p>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">No active events posted yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {events.slice(0, 2).map(evt => (
                <div key={evt.id} className="rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between p-3 bg-slate-50">
                  <div>
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
      </div>

      {balanceError && (
        <div role="alert" className="mm-alert">
          {balanceError} <button type="button" disabled={balanceLoading} onClick={() => void refreshWallets()}>Retry</button>
        </div>
      )}

      {/* Arcade Games Section (Spin Wheel, RICH DICE, Fruity Flue, CRANKLING)[cite: 24] */}
      <section className="mm-surface" aria-label="MatMove games">
        <div className="mm-row">
          <h2>Play MatMove Games</h2>
          <span className="text-xs text-slate-500">18+ · Play responsibly</span>
        </div>
        <p className="mb-3 text-sm text-slate-600">Explore the games and view the rules and possible prizes before playing.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            ['spin','Spin Wheel','🎡','Spin for a possible prize.'],
            ['dice','RICH DICE','🎲','Choose your prediction.'],
            ['fruity','Fruity Flue','🍍','Match all four fruits.'],
            ['crankling','CRANKLING','777','Match your chosen number.'],
          ] as const).map(([id,title,icon,description]) => (
            <button type="button" key={id} onClick={() => setSelectedGame(id)} className="min-h-36 rounded-2xl border border-amber-300 bg-gradient-to-br from-slate-950 to-purple-950 p-4 text-left text-white">
              <span aria-hidden="true" className="text-3xl font-black text-amber-300">{icon}</span>
              <b className="mt-3 block text-sm">{title}</b>
              <span className="mt-1 block text-xs text-slate-200">{description}</span>
              <span className="mt-3 block text-xs font-bold text-amber-300">Open game →</span>
            </button>
          ))}
        </div>
      </section>

      {/* Shortcuts & Saved Places[cite: 24] */}
      <section className="mm-surface">
        <div className="mm-row">
          <h2>Your shortcuts</h2>
          <button type="button" className="mm-text-button" onClick={() => setPanel(panel === 'places' ? null : 'places')}>
            {panel === 'places' ? 'Close' : 'Manage places'}
          </button>
        </div>
        {preferencesLoading && !preferences ? (
          <div className="space-y-2 animate-pulse"><div className="h-12 bg-slate-100 rounded-xl"></div></div>
        ) : preferencesError ? (
          <div role="alert" className="mm-alert">{preferencesError} <button type="button" onClick={() => void refreshPreferences()}>Retry</button></div>
        ) : (
          <div className="mm-place-grid">
            {(['home','work'] as const).map(kind => {
              const place = preferences?.places.find(p => p.kind === kind);
              const Icon = kind === 'home' ? Home : Briefcase;
              return (
                <button type="button" key={kind} className="mm-place-tile" onClick={() => setPanel('places')}>
                  <Icon size={20}/>
                  <span><b>{kind === 'home' ? 'Home' : 'Work'}</b><small>{place?.address || `Add your ${kind} address`}</small></span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {role !== 'driver' && (
        <button type="button" className="mm-payment-link" aria-expanded={panel === 'cards'} onClick={() => setPanel(panel === 'cards' ? null : 'cards')}>
          <CreditCard size={23}/>
          <span><b>Payment methods</b><small>Mobile Money · optional card references</small></span>
          <ArrowRight size={18}/>
        </button>
      )}

      {/* Panels for Places and Cards */}
      {panel && panel !== 'travel' && panel !== 'events' && (
        <PersonalTools key={`${uid}:${panel}`} uid={uid} panel={panel as any} preferences={preferences} error={preferencesError} loading={preferencesLoading} refresh={refreshPreferences} onClose={() => setPanel(null)}/>
      )}

      {/* Travel Modal */}
      {panel === 'travel' && (
        <TravelBookingModal
          uid={uid}
          userName={profile.full_name || ''}
          userPhone={profile.phone || ''}
          walletBalance={Number(wallet?.balance || 0)}
          priceSle={Number(busSettings.price_sle || 2400)}
          availableSeats={availableSeats}
          existingBooking={existingBooking}
          onSuccess={() => {
            fetchTravelAndEvents();
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {/* Events Modal */}
      {panel === 'events' && (
        <EventsModal
          uid={uid}
          userPhone={profile.phone || ''}
          walletBalance={Number(wallet?.balance || 0)}
          events={events}
          onClose={() => setPanel(null)}
        />
      )}

      {/* Recent Trips[cite: 24] */}
      <section className="mm-surface">
        <div className="mm-row">
          <h2>Recent trips</h2>
          <button type="button" className="mm-text-button" onClick={() => onNavigate('trips')}>View all</button>
        </div>
        {tripsLoading && !trips.length ? (
          <div className="space-y-2 animate-pulse"><div className="h-14 bg-slate-100 rounded-xl"></div></div>
        ) : tripsError ? (
          <div role="alert" className="mm-alert">{tripsError} <button type="button" onClick={() => void refreshTrips()}>Retry</button></div>
        ) : !trips.length ? (
          <p className="mm-empty">Your trips will appear here after your first booking.</p>
        ) : (
          trips.map(trip => (
            <button type="button" className="mm-trip-row" key={trip.id} onClick={() => onNavigate('trips')}>
              <MapPin size={19}/>
              <span><b>{trip.destination_location || trip.service_type}</b><small>{trip.status} · {new Date(trip.created_at).toLocaleDateString()}</small></span>
              <ArrowRight size={16}/>
            </button>
          ))
        )}
      </section>

      <p className="mm-home-footer">Made for your everyday moves.</p>
    </main>
  );
}

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
      if (active.current) { setNotice(success); if (panel === 'cards') { setNickname(''); setLastFour(''); } }
      await refresh();
    } catch (e: any) {
      if (active.current) setFailure(e.message || 'Could not save.');
    } finally {
      mutex.current = false; if (active.current) setBusy(false);
    }
  }

  function locate() {
    if (busy || !navigator.geolocation) { setFailure('Location is not available.'); return; }
    mutex.current = true; setBusy(true); setFailure('');
    navigator.geolocation.getCurrentPosition(position => {
      mutex.current = false;
      if (!active.current) return;
      dirty.current = true; setCoords([position.coords.longitude, position.coords.latitude]);
      setNotice('Current location selected.'); setBusy(false);
    }, () => { mutex.current = false; if (active.current) { setBusy(false); setFailure('Could not get location.'); } }, { enableHighAccuracy: true, timeout: 10000 });
  }

  const disabled = busy || loading || !preferences || !!error;
  return (
    <section className="mm-surface mm-tools" aria-labelledby="mm-tools-heading">
      <div className="mm-row">
        <h2 id="mm-tools-heading" tabIndex={-1} ref={heading}>{panel === 'places' ? 'Saved places' : 'Payment methods'}</h2>
        <button type="button" className="mm-icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X size={19}/></button>
      </div>
      {panel === 'places' ? (
        <>
          <div className="mm-toggle">
            {(['home','work'] as const).map(value => (
              <button type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => selectKind(value)}>{value === 'home' ? 'Home' : 'Work'}</button>
            ))}
          </div>
          <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_place', { p_kind: kind, p_address: address.trim(), p_latitude: coords?.[1] ?? null, p_longitude: coords?.[0] ?? null, p_expected: expected }, 'Address saved.'); }}>
            <label className="mm-field">{kind === 'home' ? 'Home address' : 'Work address'}<input maxLength={300} minLength={3} required disabled={disabled} value={address} onChange={e => { dirty.current = true; setAddress(e.target.value); setCoords(null); }}/></label>
            <div className="mm-form-actions">
              <button type="button" disabled={disabled} onClick={locate} className="mm-secondary">Use current location</button>
              <button type="submit" className="mm-primary" disabled={disabled || address.trim().length < 3}>{busy ? 'Saving…' : 'Save address'}</button>
              {expected != null && <button type="button" className="mm-danger" disabled={disabled} onClick={() => void mutate('matmove_delete_place', { p_kind: kind, p_expected: expected }, 'Address removed.')}><Trash2 size={16}/> Remove</button>}
            </div>
          </form>
        </>
      ) : (
        <>
          <p className="mm-payment-status"><Wallet size={18}/> Mobile Money funds your MatMove wallet.</p>
          {preferences?.cardReferences.map(card => (
            <div className="mm-card-reference" key={card.id}>
              <CreditCard size={22}/>
              <span><b>{card.nickname}</b><small>{card.brand} · •••• {card.last_four} · Reference only</small></span>
              <button className="mm-icon-button" type="button" disabled={disabled} onClick={() => void mutate('matmove_delete_card_reference', { p_id: card.id }, 'Card reference removed.')}><Trash2 size={17}/></button>
            </div>
          ))}
          <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_card_reference', { p_nickname: nickname.trim(), p_brand: brand, p_last_four: lastFour }, 'Card saved.'); }}>
            <div className="mm-form-grid">
              <label className="mm-field">Nickname<input placeholder="Personal card" required disabled={disabled} value={nickname} onChange={e => setNickname(e.target.value)}/></label>
              <label className="mm-field">Brand<select value={brand} disabled={disabled} onChange={e => setBrand(e.target.value)}>{['Visa','Mastercard','Other'].map(b => <option key={b}>{b}</option>)}</select></label>
              <label className="mm-field">Last 4 digits<input maxLength={4} pattern="[0-9]{4}" placeholder="1234" required disabled={disabled} value={lastFour} onChange={e => setLastFour(e.target.value.replace(/\D/g, '').slice(0,4))}/></label>
            </div>
            <button className="mm-primary" type="submit" disabled={disabled || !nickname.trim() || !/^\d{4}$/.test(lastFour)}>{busy ? 'Saving…' : 'Add card'}</button>
          </form>
        </>
      )}
      {failure && <p className="mm-alert" role="alert">{failure}</p>}
      {notice && <p className="mm-success" role="status">{notice}</p>}
    </section>
  );
}

function TravelBookingModal({ uid, userName, userPhone, walletBalance, priceSle, availableSeats, existingBooking, onSuccess, onClose }: any) {
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
    if (!agreed) {
      setError('You must accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest regulations.');
      return;
    }
    if (passengerCount > availableSeats) {
      setError(`Only ${availableSeats} seat(s) remain on this departure.`);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const { error: insertError } = await supabase.from('travel_bookings').insert({
        user_id: uid,
        passenger_name: fullName,
        passenger_phone: phone,
        passenger_address: address,
        emergency_name: emergencyName,
        emergency_phone: emergencyPhone,
        passengers_count: passengerCount,
        fare_amount: totalCost,
        status: 'pending_approval',
        is_paid: false
      });

      if (insertError) throw insertError;
      setSuccess('Travel request submitted. Dispatch is reviewing seat availability.');
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) {
      setError(err.message || 'Submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePayApproved = async () => {
    if (walletBalance < (existingBooking.fare_amount || priceSle)) {
      setError(`Insufficient wallet balance. You need SLE ${(existingBooking.fare_amount || priceSle).toLocaleString()}`);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const res = await walletFetch('/api/create-monime-transfer', {
        amount: existingBooking.fare_amount,
        target: 'travel',
        description: `Travel Payment Freetown-Accra (${existingBooking.passengers_count} seat)`
      });

      if (!res.response.ok) throw new Error(res.data?.error || 'Payment debit failed.');

      await supabase.from('travel_bookings').update({ is_paid: true }).eq('id', existingBooking.id);
      setSuccess('Paid in full! Seats are officially confirmed.');
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900">Freetown – Accra Direct Bus</h2>
        <p className="text-xs text-slate-500 mt-0.5">Departures 1st & 15th every month · SLE {priceSle.toLocaleString()} / seat</p>

        {error && <div className="mt-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">{error}</div>}
        {success && <div className="mt-4 p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">{success}</div>}

        {existingBooking && existingBooking.status === 'approved' && !existingBooking.is_paid ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <p className="text-sm font-bold text-emerald-900">Seats Approved by Dispatch!</p>
              <div className="text-2xl font-black text-slate-900 mt-2">SLE {Number(existingBooking.fare_amount).toLocaleString()}</div>
            </div>
            <button onClick={handlePayApproved} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl text-sm">
              {busy ? 'Processing…' : 'Debit Wallet & Confirm Seats'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Seats to Book (Max 3)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(num => (
                  <button
                    type="button"
                    key={num}
                    onClick={() => setPassengerCount(num)}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${
                      passengerCount === num ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {num} Seat{num > 1 ? 's' : ''} (SLE {(num * priceSle).toLocaleString()})
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Lead Passenger Name</label>
                <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone</label>
                <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Residential Address (Sierra Leone)</label>
              <input type="text" required placeholder="Street / Community" value={address} onChange={e => setAddress(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border space-y-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Emergency Family Contact</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" required placeholder="Family Member Name" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
                <input type="text" required placeholder="Family Phone" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
              <input type="checkbox" id="policy" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              <label htmlFor="policy" className="text-[11px] text-amber-900 leading-relaxed cursor-pointer">
                I accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest regulations.
              </label>
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

function EventsModal({ uid, userPhone, walletBalance, events, onClose }: any) {
  const [selectedTicketCount, setSelectedTicketCount] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

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
        target: 'event',
        description: `Ticket Purchase (${count} pass): ${evt.title}`
      });

      if (!res.response.ok) throw new Error(res.data?.error || 'Payment rejected.');

      await supabase.from('event_tickets').insert({
        event_id: evt.id,
        user_id: uid,
        user_phone: userPhone,
        tickets_count: count,
        amount_paid: total,
        ticket_code: `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        status: 'confirmed'
      });

      setNotice(`Purchased ${count} ticket(s) successfully!`);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto space-y-4">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Sparkles className="text-sky-600" size={22} /> MatMove Events Hub
        </h2>
        <p className="text-xs text-slate-500">Book up to 3 tickets per event in one direct payment</p>

        {error && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">{error}</div>}
        {notice && <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">{notice}</div>}

        <div className="space-y-4">
          {events.map(evt => {
            const count = selectedTicketCount[evt.id] || 1;
            const total = Number(evt.ticket_price) * count;

            return (
              <div key={evt.id} className="border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center">
                <img src={evt.flyer_url || '/logo.png'} alt={evt.title} className="w-full sm:w-28 h-28 rounded-xl object-cover bg-slate-100" />
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 text-sm">{evt.title}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{evt.venue} · {new Date(evt.event_date).toLocaleDateString()}</p>
                  
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs font-bold text-slate-600">Quantity:</span>
                    {[1, 2, 3].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setSelectedTicketCount({ ...selectedTicketCount, [evt.id]: n })}
                        className={`w-7 h-7 rounded-lg text-xs font-bold border ${
                          count === n ? 'bg-sky-600 text-white border-sky-600' : 'bg-slate-50 text-slate-700 border-slate-200'
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
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
                  >
                    Buy {count} Ticket{count > 1 ? 's' : ''}
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