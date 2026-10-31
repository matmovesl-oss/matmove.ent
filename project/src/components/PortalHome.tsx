

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Briefcase, Car, CreditCard, Eye, EyeOff, Home, Loader2, MapPin, Navigation, RefreshCw, ShieldCheck, ShoppingBag, Store, Trash2, Wallet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { walletFetch } from '@/lib/apiFetch';
import {ArcadeGames} from '@/components/ArcadeGames';

type Place = { kind: 'home' | 'work'; address: string; latitude: number | null; longitude: number | null; version: number };
type CardReference = { id: string; nickname: string; brand: string; last_four: string };
type Preferences = { user_id: string; places: Place[]; cardReferences: CardReference[] };
type Props = { profile: any; onNavigate: (section: any) => void };

export default function PortalHome({ profile, onNavigate }: Props) {
  const [selectedGame,setSelectedGame]=useState<'spin'|'dice'|'fruity'|'crankling'|null>(null);
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
  const [panel, setPanel] = useState<'places' | 'cards' | 'travel' | null>(null);
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
      if(await sameIdentity() && mounted.current){setPreferences(data);return true;}
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
    void refreshPreferences(); void refreshWallets(); void refreshTrips();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') { void refreshWallets(); void refreshTrips(); }
    };
    const timer = window.setInterval(refreshVisible, 30000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { mounted.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [refreshPreferences, refreshWallets, refreshTrips]);

  const wallet = wallets?.[currency === 'SLE' ? 'sleWallet' : 'usdWallet'];
  const verifiedBalance = wallet?.user_id === uid && wallet?.balanceAvailable === true && typeof wallet.balance === 'number' && Number.isFinite(wallet.balance);
  const name = String(profile.first_name || profile.full_name || profile.business_name || 'there').split(' ')[0];
  const shortcuts = role === 'driver'
    ? [{ section: 'ride', label: 'Driver radar', detail: 'Go online and find requests', Icon: Navigation }, { section: 'trips', label: 'My trips', detail: 'View trip details and history', Icon: Car }]
    : [{ section: 'ride', label: 'Book a ride', detail: 'Choose pickup and destination', Icon: Car }, { section: role === 'merchant' ? 'inventory' : 'shop', label: role === 'merchant' ? 'My business' : 'Shop', detail: role === 'merchant' ? 'Manage products and orders' : 'Explore local products', Icon: role === 'merchant' ? Store : ShoppingBag }];

  if(selectedGame)return <ArcadeGames key={`${uid}:${selectedGame}`} userId={uid} initialGame={selectedGame} onBack={()=>setSelectedGame(null)}/>;
  return <main className="mm-home">
    <header className="mm-home-heading">
      <div className="mm-brand"><img src="/logo.jpg" alt="MatMove" width="40" height="40"/><span>Wi dey move<span className="mm-muted">Your everyday, connected.</span></span></div>
      <button className="mm-icon-button" type="button" aria-label="Open your account" onClick={() => onNavigate('account')}><ShieldCheck size={22}/></button>
    </header>
    <div className="mm-welcome"><p className="mm-eyebrow">{role === 'merchant' ? 'Business space' : role === 'driver' ? 'Driver space' : 'Your MatMove'}</p><h1>Hello, {name}.</h1><p>Where will today take you?</p></div>
    <div className="mm-home-grid">
      <section className={`mm-home-wallet mm-home-wallet-${currency.toLowerCase()}`} aria-label="Wallet overview">
        <div className="mm-row"><div className="mm-currency-tabs" aria-label="Wallet currency">{(['SLE','USD'] as const).map(c => <button key={c} type="button" aria-pressed={currency === c} onClick={() => { setCurrency(c); setVisible(false); }}>{c}</button>)}</div><button type="button" className="mm-glass-button" aria-label="Refresh balances" disabled={balanceLoading} onClick={() => void refreshWallets()}><RefreshCw size={18} className={balanceLoading ? 'animate-spin' : ''}/></button></div>
        <p className="mm-wallet-label">{currency === 'SLE' ? 'Leone wallet' : 'US dollar wallet'}</p>
        <div className="mm-balance-row"><strong aria-live="polite">{currency} {visible ? balanceLoading ? 'Loading…' : verifiedBalance ? wallet.balance.toFixed(2) : '—' : <span aria-label="Balance hidden">••••••</span>}</strong><button type="button" className="mm-glass-button" aria-label={visible ? 'Hide balance' : 'Show balance'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div>
        <p className="mm-wallet-caption">{balanceLoading ? 'Checking your wallet…' : balanceError ? 'Balance could not be loaded.' : wallet?.is_frozen || profile.is_wallet_frozen ? 'Wallet frozen · contact support' : !wallet ? 'Open Wallet to check setup.' : !verifiedBalance ? 'Open Wallet to check account status.' : 'Available balance · verified with your wallet provider'}</p>
        <button className="mm-wallet-open" type="button" onClick={() => onNavigate('wallet')}>Open wallet <ArrowRight size={17}/></button>
      </section>
      <section className="mm-services" aria-label="Quick actions">
        {shortcuts.map(({ section, label, detail, Icon }) => <button type="button" className="mm-service" key={section} onClick={() => onNavigate(section)}><span className="mm-service-icon"><Icon size={25}/></span><span><b>{label}</b><small>{detail}</small></span><ArrowRight size={18}/></button>)}
        <div className="mm-small-actions"><button type="button" onClick={() => onNavigate('wallet')}><Wallet size={18}/> Load with Mobile Money</button><button type="button" onClick={() => onNavigate('account')}><ShieldCheck size={18}/> My account</button></div>
      
      </section>
      <section className="mm-surface" aria-label="Travel & Bus Booking">
        <div className="mm-row">
          <h2>Travel to Ghana</h2>
          <span className="text-xs text-slate-500 font-bold">1st & 15th every month</span>
        </div>
        <p className="mb-3 text-sm text-slate-600">Sierra Leone to Ghana direct bus. Secure your seat instantly for 6,000 SLE.</p>
        <button type="button" onClick={() => setPanel('travel')} className="w-full min-h-24 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-900 to-indigo-900 p-4 text-left text-white shadow-sm flex items-center justify-between">
          <div>
             <b className="block text-lg font-bold">Freetown - Accra Direct</b>
             <span className="mt-1 block text-sm text-blue-100">Book up to 3 passengers. Departures 7:00 AM sharp.</span>
          </div>
          <ArrowRight size={24} className="text-blue-300"/>
        </button>
      </section>

    </div>
    {balanceError && <div role="alert" className="mm-alert">{balanceError} <button type="button" disabled={balanceLoading} onClick={() => void refreshWallets()}>Retry</button></div>}
    <section className="mm-surface" aria-label="MatMove games"><div className="mm-row"><h2>Play MatMove Games</h2><span className="text-xs text-slate-500">18+ · Play responsibly</span></div><p className="mb-3 text-sm text-slate-600">Explore the games and view the rules and possible prizes before playing. Account eligibility applies.</p><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([
      ['spin','Spin Wheel','🎡','Spin for a possible prize.'],
      ['dice','RICH DICE','🎲','Choose your prediction.'],
      ['fruity','Fruity Flue','🍍','Match all four fruits.'],
      ['crankling','CRANKLING','777','Match your chosen number.'],
    ] as const).map(([id,title,icon,description])=><button type="button" key={id} onClick={()=>setSelectedGame(id)} className="min-h-36 rounded-2xl border border-amber-300 bg-gradient-to-br from-slate-950 to-purple-950 p-4 text-left text-white"><span aria-hidden="true" className="text-3xl font-black text-amber-300">{icon}</span><b className="mt-3 block text-sm">{title}</b><span className="mt-1 block text-xs text-slate-200">{description}</span><span className="mt-3 block text-xs font-bold text-amber-300">Open game →</span></button>)}</div></section>
    <section className="mm-surface"><div className="mm-row"><h2>Your shortcuts</h2><button type="button" className="mm-text-button" onClick={() => setPanel(panel === 'places' ? null : 'places')}>{panel === 'places' ? 'Close' : 'Manage places'}</button></div>
      {preferencesLoading && !preferences ? <p role="status" className="mm-loading"><Loader2 size={17} className="animate-spin"/> Loading saved places…</p> : preferencesError ? <div role="alert" className="mm-alert">{preferencesError} <button type="button" onClick={() => void refreshPreferences()}>Retry</button></div> : <div className="mm-place-grid">{(['home','work'] as const).map(kind => { const place = preferences?.places.find(p => p.kind === kind); const Icon = kind === 'home' ? Home : Briefcase; return <button type="button" key={kind} className="mm-place-tile" onClick={() => setPanel('places')}><Icon size={20}/><span><b>{kind === 'home' ? 'Home' : 'Work'}</b><small>{place?.address || `Add your ${kind} address`}</small></span></button>; })}</div>}
    </section>
    {role !== 'driver' && <button type="button" className="mm-payment-link" aria-expanded={panel === 'cards'} onClick={() => setPanel(panel === 'cards' ? null : 'cards')}><CreditCard size={23}/><span><b>Payment methods</b><small>Mobile Money · optional card references</small></span><ArrowRight size={18}/></button>}
    {panel && panel !== 'travel' && <PersonalTools key={`${uid}:${panel}`} uid={uid} panel={panel} preferences={preferences} error={preferencesError} loading={preferencesLoading} refresh={refreshPreferences} onClose={() => setPanel(null)}/>}
    {panel === 'travel' && <TravelBookingPanel uid={uid} walletBalance={wallet?.balance || 0} refreshWallets={refreshWallets} onClose={() => setPanel(null)} />}
    <section className="mm-surface"><div className="mm-row"><h2>Recent trips</h2><button type="button" className="mm-text-button" onClick={() => onNavigate('trips')}>View all</button></div>
      {tripsLoading && !trips.length ? <p role="status" className="mm-loading"><Loader2 size={17} className="animate-spin"/> Loading trips…</p> : tripsError ? <div role="alert" className="mm-alert">{tripsError} <button type="button" onClick={() => void refreshTrips()}>Retry</button></div> : !trips.length ? <p className="mm-empty">Your trips will appear here after your first booking.</p> : trips.map(trip => <button type="button" className="mm-trip-row" key={trip.id} onClick={() => onNavigate('trips')}><MapPin size={19}/><span><b>{trip.destination_location || trip.service_type}</b><small>{trip.status} · {new Date(trip.created_at).toLocaleDateString()}</small></span><ArrowRight size={16}/></button>)}
    </section>
    <p className="mm-home-footer">Made for your everyday moves.</p>
  </main>;
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
      if(name==='matmove_save_place'&&(!result.data||result.data.kind!==params.p_kind||result.data.address!==params.p_address||!Number.isSafeInteger(result.data.version)))throw new Error('Address save was not confirmed. Reload your saved places.');
      if(name==='matmove_save_card_reference'&&(!result.data?.id||result.data.brand!==params.p_brand||result.data.last_four!==params.p_last_four))throw new Error('Card reference save was not confirmed. Reload your preferences.');
      if(name.startsWith('matmove_delete_')&&typeof result.data!=='boolean')throw new Error('Removal was not confirmed. Reload your preferences.');
      if (!active.current) return;
      dirty.current = false;
      const reloaded=await refresh();
      if(!reloaded)throw new Error('The save returned, but the updated list could not be loaded. Retry loading before making another change.');
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
      setNotice('Current location selected. Enter the matching street address before saving.'); setBusy(false);
    }, () => { mutex.current = false; if (active.current) { setBusy(false); setFailure('Could not get your location. Enter the address manually.'); } }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  const disabled = busy || loading || !preferences || !!error;
  return <section className="mm-surface mm-tools" aria-labelledby="mm-tools-heading">
    <div className="mm-row"><h2 id="mm-tools-heading" tabIndex={-1} ref={heading}>{panel === 'places' ? 'Saved places' : 'Payment methods'}</h2><button type="button" className="mm-icon-button" disabled={busy} onClick={onClose} aria-label="Close preferences"><X size={19}/></button></div>
    {loading && <p role="status" className="mm-loading">Loading preferences…</p>}
    {error && <div role="alert" className="mm-alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {panel === 'places' ? <>
      <div className="mm-toggle">{(['home','work'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => selectKind(value)}>{value === 'home' ? 'Home' : 'Work'}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_place', { p_kind: kind, p_address: address.trim(), p_latitude: coords?.[1] ?? null, p_longitude: coords?.[0] ?? null, p_expected: expected }, 'Address saved.'); }}>
        <label className="mm-field">{kind === 'home' ? 'Home address' : 'Work address'}<input autoComplete="street-address" maxLength={300} minLength={3} required disabled={disabled} value={address} onChange={e => { dirty.current = true; setAddress(e.target.value); setCoords(null); }}/></label>
        <p className="mm-muted">Your saved address is private. Coordinates are optional; confirm the exact map pin when booking.</p>
        <div className="mm-form-actions"><button type="button" disabled={disabled} onClick={locate} className="mm-secondary">Use current location</button><button type="submit" className="mm-primary" disabled={disabled || address.trim().length < 3}>{busy ? 'Saving…' : 'Save address'}</button>{expected != null && <button type="button" className="mm-danger" disabled={disabled} onClick={() => void mutate('matmove_delete_place', { p_kind: kind, p_expected: expected }, 'Address removed.')}><Trash2 size={16}/> Remove</button>}</div>
      </form>
    </> : <>
      <p className="mm-payment-status"><Wallet size={18}/> Mobile Money funds your MatMove wallet.</p>
      <p className="mm-info">Card payments are not active. You can keep a card reference for convenience; this does not link or verify a card and cannot be used to pay. Never enter a full card number, expiry date, PIN, or CVV here.</p>
      {preferences?.cardReferences.map(card => <div className="mm-card-reference" key={card.id}><CreditCard size={22}/><span><b>{card.nickname}</b><small>{card.brand} · •••• {card.last_four} · Reference only</small></span><button className="mm-icon-button" type="button" disabled={disabled} aria-label={`Remove ${card.nickname}`} onClick={() => void mutate('matmove_delete_card_reference', { p_id: card.id }, 'Card reference removed.')}><Trash2 size={17}/></button></div>)}
      <form onSubmit={e => { e.preventDefault(); void mutate('matmove_save_card_reference', { p_nickname: nickname.trim(), p_brand: brand, p_last_four: lastFour }, 'Card reference saved. Payments remain inactive.'); }}>
        <div className="mm-form-grid"><label className="mm-field">Nickname<input autoComplete="off" placeholder="Personal card" maxLength={40} required disabled={disabled} value={nickname} onChange={e => setNickname(e.target.value.replace(/[^\p{L} .'-]/gu, ''))}/></label><label className="mm-field">Card brand<select value={brand} disabled={disabled} onChange={e => setBrand(e.target.value)}>{['Visa','Mastercard','American Express','Other'].map(b => <option key={b}>{b}</option>)}</select></label><label className="mm-field">Last four digits only<input inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" placeholder="1234" required disabled={disabled} value={lastFour} onChange={e => setLastFour(e.target.value.replace(/\D/g, '').slice(0,4))}/></label></div>
        <button className="mm-primary" type="submit" disabled={disabled || !nickname.trim() || !/^\d{4}$/.test(lastFour) || (preferences?.cardReferences.length ?? 0) >= 5}>{busy ? 'Saving…' : 'Add card reference'}</button>
      </form>
    </>}
    {failure && <p className="mm-alert" role="alert">{failure}</p>}
    {notice && <p className="mm-success" role="status">{notice}</p>}
  </section>;
}


function TravelBookingPanel({ uid, walletBalance, onClose, refreshWallets }: { uid: string; walletBalance: number; onClose: () => void; refreshWallets: () => void }) {
  const [passengers, setPassengers] = useState<string[]>(['']); // Array of wallet IDs (at least 1 for the current user)
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const totalCost = passengers.length * 6000;

  const handleAddPassenger = () => {
    if (passengers.length < 3) setPassengers([...passengers, '']);
  };

  const handleUpdatePassenger = (index: number, val: string) => {
    const newPass = [...passengers];
    newPass[index] = val;
    setPassengers(newPass);
  };

  const handleRemovePassenger = (index: number) => {
    const newPass = [...passengers];
    newPass.splice(index, 1);
    setPassengers(newPass);
  };

  const handleBook = async () => {
    if (totalCost > walletBalance) {
      setFailure(`Insufficient balance. You need ${totalCost.toLocaleString()} SLE.`);
      return;
    }
    
    // Check if any wallet ID is empty (except the first one which can implicitly be the current user)
    if (passengers.some((p, i) => i > 0 && !p.trim())) {
      setFailure('Please provide valid Wallet IDs for all additional passengers.');
      return;
    }

    setBusy(true);
    setFailure('');
    setNotice('');

    try {
      // Direct checkout trigger to Travel Backend Account
      const res = await walletFetch('/api/create-monime-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalCost,
          destinationId: import.meta.env.VITE_MONIME_TRAVEL_ACCOUNT_ID || 'travel-backend-placeholder',
          description: `Travel Booking: Freetown to Accra for ${passengers.length} passengers. IDs: ${passengers.join(', ')}`
        })
      });
      
      if (!res.ok) throw new Error('Booking failed to process. Try again later.');
      
      setNotice('Booking successful! 6,000 SLE per passenger has been debited. Have a safe trip!');
      refreshWallets();
    } catch (err: any) {
      setFailure(err.message || 'An error occurred during booking.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mm-modal-overlay" onClick={onClose}>
      <div className="mm-modal-surface" onClick={e => e.stopPropagation()}>
        <div className="mm-row">
          <h2 className="text-xl font-bold">Freetown - Accra Direct</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20}/></button>
        </div>
        <p className="text-sm text-slate-600 mb-4">Departures on 1st & 15th every month. 6,000 SLE per passenger.</p>
        
        {failure && <div className="mm-alert bg-red-50 text-red-700 p-3 rounded-lg mb-4">{failure}</div>}
        {notice && <div className="mm-alert bg-green-50 text-green-700 p-3 rounded-lg mb-4">{notice}</div>}
        
        <div className="space-y-4 mb-6">
          {passengers.map((p, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-700 mb-1">Passenger {index + 1} {index === 0 ? '(You)' : 'Wallet ID'}</label>
                <input 
                  type="text" 
                  value={p}
                  onChange={(e) => handleUpdatePassenger(index, e.target.value)}
                  placeholder={index === 0 ? 'Your Wallet (Auto-charged)' : 'Enter MatMove Wallet ID'}
                  disabled={index === 0 || busy}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                />
              </div>
              {index > 0 && (
                <button type="button" onClick={() => handleRemovePassenger(index)} disabled={busy} className="mt-5 text-red-500 hover:text-red-700">
                  <Trash2 size={18}/>
                </button>
              )}
            </div>
          ))}
          
          {passengers.length < 3 && !busy && !notice && (
            <button type="button" onClick={handleAddPassenger} className="text-sm text-blue-600 font-bold hover:underline">
              + Add another passenger (Max 3)
            </button>
          )}
        </div>
        
        <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-500">Total Cost</p>
            <p className="text-lg font-bold">{totalCost.toLocaleString()} SLE</p>
          </div>
          {!notice ? (
            <button 
              type="button" 
              onClick={handleBook} 
              disabled={busy}
              className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
            >
              {busy ? 'Processing...' : 'Pay Now'}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="bg-slate-200 text-slate-800 font-bold py-2 px-6 rounded-lg">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
