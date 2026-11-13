import {locationVoiceAvailable,startLocationVoice} from '@/lib/voiceLocation';


import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Point = { coords: [number, number]; address: string };
type Target = 'pickup' | 'destination';
type Prediction = google.maps.places.PlacePrediction;
const validCoords=(coords:[number,number])=>Number.isFinite(coords[0])&&Number.isFinite(coords[1])&&Math.abs(coords[0])<=180&&Math.abs(coords[1])<=90;
type SavedPlace = { kind: 'home' | 'work'; address: string; latitude: number | null; longitude: number | null; version: number };
export type TripLocations = { pickup: Point | null; destination: Point | null; distanceKm: number | null };
const CENTER = { lat: 8.4808, lng: -13.2290 };
let sdkPromise: Promise<void> | null = null;

// Shared by the booking map and driver radar: never inject competing SDK scripts.
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

export function RideLocationPicker({ onChange, userId, layout = 'default', onBack, bookingReady = false, onRouteEditingChange }: { onChange: (value: TripLocations) => void; userId?: string; layout?: 'default' | 'map-first'; onBack?: () => void; bookingReady?: boolean; onRouteEditingChange?: (editing: boolean) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<Partial<Record<Target, google.maps.Marker>>>({});
  const renderer = useRef<google.maps.DirectionsRenderer | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const value = useRef<TripLocations>({ pickup: null, destination: null, distanceKm: null });
  const generation = useRef(0);
  const tokens = useRef({ pickup: 0, destination: 0, route: 0 });
  const textsRef = useRef({ pickup: '', destination: '' });
  const pinRef = useRef<Target | null>(null);
  const timers = useRef(new Set<number>());
  const debounce=useRef<number|null>(null);
  const automaticRoute=useRef<number|null>(null);
  const voiceCancel=useRef<(()=>void)|null>(null);
  const [listening,setListening]=useState<Target|null>(null);
  const [voiceAvailable,setVoiceAvailable]=useState(false);
  const stopVoice=()=>{voiceCancel.current?.();voiceCancel.current=null;setListening(null);};
  const searchEpoch=useRef(0);
  const placesLibrary=useRef<Promise<google.maps.PlacesLibrary>|null>(null);
  const sessions=useRef<Partial<Record<Target,google.maps.places.AutocompleteSessionToken>>>({});
  const [suggestions,setSuggestions]=useState<{target:Target;items:Prediction[]}|null>(null);
  const [activeSuggestion,setActiveSuggestion]=useState(-1);
  const savedRef = useRef<SavedPlace[]>([]);
  const saveBusy = useRef(false);
  const [texts, setTexts] = useState({ pickup: '', destination: '' });
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mapError, setMapError] = useState('');
  const [locationPanelExpanded,setLocationPanelExpanded]=useState(true);
  const [editingRoute,setEditingRoute]=useState(true);
  const [locationDragDelta,setLocationDragDelta]=useState(0);
  const locationDragStart=useRef<number|null>(null);
  const locationDragged=useRef(false);
  const [message, setMessage] = useState('');
  const [distance, setDistance] = useState<number | null>(null);
  const [routing, setRouting] = useState(false);
  const [searching, setSearching] = useState<Target | null>(null);
  const [results, setResults] = useState<{ target: Target; items: google.maps.GeocoderResult[] } | null>(null);
  const [pinTarget, setPinTarget] = useState<Target | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [savedLoading, setSavedLoading] = useState(!!userId);
  const [savedError, setSavedError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preferencesRetry, setPreferencesRetry] = useState(0);

  const emit = () => onChangeRef.current({ ...value.current });

  useEffect(()=>{
    if(bookingReady){setEditingRoute(false);setLocationPanelExpanded(false);onRouteEditingChange?.(false);}
    else{setEditingRoute(true);onRouteEditingChange?.(true);}
  },[bookingReady]);
  const clearRoute = () => {
    if(automaticRoute.current!==null){window.clearTimeout(automaticRoute.current);timers.current.delete(automaticRoute.current);automaticRoute.current=null;}
    tokens.current.route++; value.current.distanceKm = null;
    setDistance(null); setRouting(false); renderer.current?.setMap(null);
  };
  const invalidate = (target: Target, text: string) => {
    stopVoice();
    searchEpoch.current++;
    if(debounce.current!==null){window.clearTimeout(debounce.current);timers.current.delete(debounce.current);debounce.current=null;}
    setSuggestions(null);setActiveSuggestion(-1);
    tokens.current[target]++; value.current[target] = null;
    textsRef.current[target] = text;
    setTexts({ ...textsRef.current }); setResults(null); setSearching(null);
    markers.current[target]?.setMap(null); clearRoute(); emit();
  };
  function later(callback: () => void, ms = 12000) {
    const id = window.setTimeout(() => { timers.current.delete(id); callback(); }, ms);
    timers.current.add(id); return () => { window.clearTimeout(id); timers.current.delete(id); };
  }
  function putPoint(target: Target, point: Point) {
    stopVoice();
    if(!validCoords(point.coords)){setMessage('This location has invalid coordinates. Choose another result or place a map pin.');return;}
    searchEpoch.current++;
    if(debounce.current!==null){window.clearTimeout(debounce.current);timers.current.delete(debounce.current);debounce.current=null;}
    setSuggestions(null);setActiveSuggestion(-1);
    tokens.current[target]++;
    value.current[target] = point; textsRef.current[target] = point.address;
    setTexts({ ...textsRef.current }); setResults(null); setSearching(null); clearRoute();
    const position = { lat: point.coords[1], lng: point.coords[0] };
    if (!markers.current[target]) {
      const markerColour = target === 'pickup' ? '#059669' : '#0f172a';
      const markerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="60" viewBox="0 0 52 60"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#0f172a" flood-opacity=".24"/></filter></defs><path filter="url(#s)" d="M26 2C12.75 2 2 12.75 2 26c0 17 24 32 24 32s24-15 24-32C50 12.75 39.25 2 26 2Z" fill="${markerColour}" stroke="#fff" stroke-width="3"/><circle cx="26" cy="25" r="10" fill="#fff"/><circle cx="26" cy="25" r="4" fill="${markerColour}"/></svg>`;
      const marker = new google.maps.Marker({
        map: map.current,
        position,
        draggable: true,
        title: target === 'pickup' ? 'Pickup location' : 'Destination location',
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(markerSvg),
          scaledSize: new google.maps.Size(44, 52),
          anchor: new google.maps.Point(22, 49)
        },
        zIndex: target === 'destination' ? 20 : 10
      });
      const ownGeneration = generation.current;
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        if (generation.current === ownGeneration && event.latLng) selectCoordinates(target, [event.latLng.lng(), event.latLng.lat()]);
      });
      markers.current[target] = marker;
    } else { markers.current[target]!.setMap(map.current); markers.current[target]!.setPosition(position); }
    map.current?.panTo(position); emit();
    if(value.current.pickup&&value.current.destination){
      const ownGeneration=generation.current,token=tokens.current.route;
      const id=window.setTimeout(()=>{timers.current.delete(id);automaticRoute.current=null;if(generation.current===ownGeneration&&tokens.current.route===token)previewRoute();},400);
      automaticRoute.current=id;timers.current.add(id);
    }
  }
  function selectCoordinates(target: Target, coords: [number, number]) {
    if(!validCoords(coords)){setMessage('Your location could not be confirmed. Search or place a map pin.');return;}
    const fallback = `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;
    putPoint(target, { coords, address: fallback });
    const ownGeneration = generation.current, token = tokens.current[target];
    geocoder.current?.geocode({ location: { lat: coords[1], lng: coords[0] } }, (items, status) => {
      if (generation.current !== ownGeneration || tokens.current[target] !== token) return;
      if (status === 'OK' && items?.[0]) {
        value.current[target] = { coords, address: items[0].formatted_address };
        textsRef.current[target] = items[0].formatted_address;
        setTexts({ ...textsRef.current }); emit();
      }
    });
  }
  function locate(explicit: boolean) {
    if (!navigator.geolocation) { if (explicit) setMessage('Location is not supported. Search for an address or place a pin.'); return; }
    const ownGeneration = generation.current;
    const token = ++tokens.current.pickup;
    if (explicit) setMessage('Finding your current location…');
    navigator.geolocation.getCurrentPosition(position => {
      if (generation.current !== ownGeneration || tokens.current.pickup !== token) return;
      if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > 1000) { setMessage('Your location is approximate. Search for your street or place an exact map pin.'); return; }
      selectCoordinates('pickup', [position.coords.longitude, position.coords.latitude]);
      if (explicit) setMessage('Pickup selected. Check the pin before requesting.');
    }, () => { if (generation.current === ownGeneration && tokens.current.pickup === token && explicit) setMessage('Location permission was not available. Search for an address or place a pin.'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
  }

  useEffect(()=>{setVoiceAvailable(locationVoiceAvailable());return()=>{voiceCancel.current?.();voiceCancel.current=null;};},[userId]);
  function speak(target:Target){
    if(listening===target){stopVoice();return;}
    stopVoice();invalidate(target,textsRef.current[target]);pinRef.current=null;setPinTarget(null);
    const ownGeneration=generation.current,token=tokens.current[target];
    setListening(target);setMessage(`Listening for ${target}… Say the street, area or landmark.`);
    voiceCancel.current=startLocationVoice({onText:text=>{if(generation.current!==ownGeneration||tokens.current[target]!==token)return;typeAddress(target,text);},onMessage:text=>{if(generation.current===ownGeneration)setMessage(text);},onEnd:()=>{if(generation.current===ownGeneration)setListening(null);}});
  }

  useEffect(() => {
    const ownGeneration = ++generation.current;
    let disposed = false;
    setReady(false); setMapError('');
    loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').then(() => {
      if (disposed || !mapElement.current) return;
      map.current = new google.maps.Map(mapElement.current, { center: CENTER, zoom: 13, minZoom: 11, maxZoom: 19, disableDefaultUI: true, zoomControl: true, zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM }, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, keyboardShortcuts: false, clickableIcons: false, gestureHandling: 'greedy', backgroundColor: '#e8eef2' });
      geocoder.current = new google.maps.Geocoder();
      renderer.current = new google.maps.DirectionsRenderer({ suppressMarkers: true, polylineOptions: { strokeColor: '#14765d', strokeWeight: 5 } });
      map.current.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (generation.current !== ownGeneration || !pinRef.current || !event.latLng) return;
        selectCoordinates(pinRef.current, [event.latLng.lng(), event.latLng.lat()]);
        pinRef.current = null; setPinTarget(null); setMessage('Pin selected. Your route previews automatically once both pins are selected.');
      });
      // Recreate existing selections after an explicit map retry.
      for (const target of ['pickup','destination'] as Target[]) if (value.current[target]) putPoint(target, value.current[target]!);
      setReady(true);
      if (!value.current.pickup && !textsRef.current.pickup) locate(false);
    }).catch(error => { if (!disposed) setMapError(error.message || 'Could not load the map. Retry when connected.'); });
    return () => {
      voiceCancel.current?.();voiceCancel.current=null;
      disposed = true; generation.current++;
      tokens.current.pickup++; tokens.current.destination++; tokens.current.route++;
      for (const timer of timers.current) window.clearTimeout(timer); timers.current.clear();
      renderer.current?.setMap(null); renderer.current = null;
      for (const marker of Object.values(markers.current)) if (marker) { google.maps.event.clearInstanceListeners(marker); marker.setMap(null); }
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      markers.current = {}; geocoder.current = null; map.current = null;
      sessions.current={};setSuggestions(null);setSearching(null);
    };
  }, [retry]);

  useEffect(() => {
    let disposed = false;
    savedRef.current = []; setSaved([]); setSavedLoading(!!userId); setSavedError('');
    if (!userId) return;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('matmove_home_preferences', { p_user_id: userId });
        if (error) throw error;
        const { data: session } = await supabase.auth.getSession();
        if (data?.user_id !== userId || session.session?.user.id !== userId || !Array.isArray(data.places)) throw new Error('Sign in again to load your saved places.');
        if (!disposed) { savedRef.current = data.places; setSaved(data.places); }
      } catch(error:any) { if (!disposed) setSavedError(`Could not load saved places. ${error?.message || 'Check your connection and retry.'}`); }
      finally { if (!disposed) setSavedLoading(false); }
    })();
    return () => { disposed = true; };
  }, [userId, preferencesRetry]);

  function suggest(target:Target,query:string) {
    if(!ready||query.trim().length<3)return;
    const token=tokens.current[target],ownGeneration=generation.current,epoch=searchEpoch.current;
    const valid=()=>generation.current===ownGeneration&&searchEpoch.current===epoch&&tokens.current[target]===token&&textsRef.current[target]===query;
    setSearching(target);setMessage('Looking for matching places…');
    let completed=false;
    const stopTimeout=later(()=>{completed=true;if(valid()){setSearching(null);setMessage('Suggestions timed out. Press Find or choose a map pin.');}},10000);
    void(async()=>{
      try{
        if(!placesLibrary.current)placesLibrary.current=google.maps.importLibrary('places') as Promise<google.maps.PlacesLibrary>;
        const lib=await placesLibrary.current;
        if(completed||!valid())return;
        sessions.current[target]??=new lib.AutocompleteSessionToken();
        const {suggestions:found}=await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({input:query.trim(),sessionToken:sessions.current[target],includedRegionCodes:['sl'],locationBias:{center:CENTER,radius:30000},region:'sl',language:'en'});
        if(completed||!valid())return;
        const items=found.map(s=>s.placePrediction).filter((p):p is Prediction=>!!p).slice(0,5);
        setSuggestions({target,items});setActiveSuggestion(-1);
        setMessage(items.length?'Choose a suggested place to confirm its map pin.':'No suggestions found. Include your area, press Find, or choose a map pin.');
      }catch{
        placesLibrary.current=null;
        if(!completed&&valid())setMessage('Live suggestions are unavailable. Press Find for address search or choose a map pin.');
      }finally{stopTimeout();if(!completed&&valid())setSearching(null);completed=true;}
    })();
  }
  function typeAddress(target:Target,text:string){
    invalidate(target,text);pinRef.current=null;setPinTarget(null);setMessage(text.trim().length<3?'Type at least three characters to search places.':'Looking for matching places…');
    if(!ready||text.trim().length<3)return;
    const id=window.setTimeout(()=>{timers.current.delete(id);debounce.current=null;suggest(target,text);},350);
    debounce.current=id;timers.current.add(id);
  }
  async function chooseSuggestion(target:Target,prediction:Prediction){
    const token=++tokens.current[target],ownGeneration=generation.current,epoch=++searchEpoch.current;
    setSuggestions(null);setActiveSuggestion(-1);setSearching(target);setMessage('Confirming selected location…');
    let completed=false;
    const valid=()=>generation.current===ownGeneration&&searchEpoch.current===epoch&&tokens.current[target]===token;
    const stopTimeout=later(()=>{completed=true;if(valid()){setSearching(null);setMessage('Place details timed out. Choose the result again, press Find, or place a map pin.');}},10000);
    try{
      const place=prediction.toPlace();
      await place.fetchFields({fields:['location','formattedAddress','displayName']});
      if(completed||!valid())return;
      const location=place.location;
      if(!location)throw new Error('No map coordinates were returned.');
      const coords:[number,number]=[location.lng(),location.lat()];
      if(!validCoords(coords))throw new Error('The returned map coordinates are invalid.');
      const address=place.formattedAddress||place.displayName||prediction.text.toString();
      putPoint(target,{coords,address});setMessage('Location selected. Your route previews automatically once both pins are selected.');
    }catch{if(!completed&&valid())setMessage('Could not confirm this place. Press Find or choose its exact map pin.');}
    finally{stopTimeout();delete sessions.current[target];if(!completed&&valid())setSearching(null);completed=true;}
  }

  function searchAddress(target: Target, savedPlace?: SavedPlace) {
    if (!ready || !geocoder.current) return;
    const query = savedPlace?.address || textsRef.current[target];
    if (query.trim().length < 3) { setMessage('Enter at least three characters, including the area or street.'); return; }
    invalidate(target, query);
    const token = tokens.current[target], ownGeneration = generation.current;
    setSearching(target); setMessage('');
    let completed = false;
    const stopTimeout = later(() => {
      if (generation.current === ownGeneration && tokens.current[target] === token) { completed = true; setSearching(null); setMessage('Address search timed out. Retry or place a map pin.'); }
    });
    geocoder.current.geocode({ address: query, componentRestrictions: { country: 'SL' }, region: 'SL', bounds: new google.maps.LatLngBounds({ lat: 8.35, lng: -13.33 }, { lat: 8.55, lng: -13.10 }) }, (items, status) => {
      stopTimeout();
      if (completed || generation.current !== ownGeneration || tokens.current[target] !== token) return;
      completed = true; setSearching(null);
      if (status === 'OK' && items?.length) {
        setResults({ target, items: items.slice(0,5) });
        setMessage(savedPlace ? 'Choose the matching saved address below and confirm its pin.' : 'Choose an address below and confirm its pin.');
      } else setMessage(status === 'ZERO_RESULTS' ? 'No matching address found. Include the area or place a map pin.' : 'Address search could not complete. Retry or place a map pin.');
    });
  }
  function useSaved(target: Target, place: SavedPlace) {
    pinRef.current = null; setPinTarget(null);
    if (place.latitude !== null && place.longitude !== null && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
      putPoint(target, { address: place.address, coords: [place.longitude, place.latitude] });
      setMessage(`${place.kind === 'home' ? 'Home' : 'Work'} selected for ${target}. Check the pin. Your route previews automatically once both locations are selected.`);
    } else searchAddress(target, place);
  }
  async function savePlace(target: Target, kind: 'home' | 'work') {
    const point = value.current[target];
    if (!userId || !point || saveBusy.current || savedLoading || savedError) return;
    saveBusy.current = true; setSaving(true); const ownGeneration = generation.current;
    try {
      const { data: session } = await supabase.auth.getSession();
      if (session.session?.user.id !== userId) throw new Error('Your account changed. Reopen the booking screen.');
      const old = savedRef.current.find(p => p.kind === kind);
      const { data, error } = await supabase.rpc('matmove_save_place', { p_user_id: userId, p_kind: kind, p_address: point.address, p_latitude: point.coords[1], p_longitude: point.coords[0], p_expected: old?.version ?? null });
      if (error) throw error;
      if (generation.current !== ownGeneration) return;
      if (!data || data.kind !== kind) throw new Error('Address save could not be confirmed. Reload saved places before retrying.');
      savedRef.current = [...savedRef.current.filter(p => p.kind !== kind), data]; setSaved(savedRef.current);
      setMessage(`${kind === 'home' ? 'Home' : 'Work'} saved. You can edit it from Home → Manage places.`);
    } catch (error: any) {
      if (generation.current === ownGeneration) { setSavedError(error.message || 'Could not save the address.'); setMessage('Your trip locations remain selected. Reload saved places before saving again.'); }
    } finally { saveBusy.current = false; if (generation.current === ownGeneration) setSaving(false); }
  }
  function previewRoute() {
    const { pickup, destination } = value.current;
    if (!map.current || !renderer.current || !pickup || !destination || !validCoords(pickup.coords) || !validCoords(destination.coords)) { setMessage('Choose pickup and destination first.'); return; }
    clearRoute(); emit(); const token = tokens.current.route, ownGeneration = generation.current;
    setRouting(true); setMessage('Previewing your driving route…'); let completed = false;
    const stopTimeout = later(() => {
      if (generation.current === ownGeneration && tokens.current.route === token) { completed = true; setRouting(false); setMessage('Route lookup timed out. Please retry.'); }
    }, 15000);
    try {new google.maps.DirectionsService().route({ origin: { lat: pickup.coords[1], lng: pickup.coords[0] }, destination: { lat: destination.coords[1], lng: destination.coords[0] }, travelMode: google.maps.TravelMode.DRIVING }, (result, status) => {
      stopTimeout();
      if (completed || generation.current !== ownGeneration || tokens.current.route !== token) return;
      completed = true; setRouting(false);
      const meters = result?.routes?.[0]?.legs?.[0]?.distance?.value;
      if (status === 'OK' && result && typeof meters === 'number' && Number.isFinite(meters) && meters > 0) {
        renderer.current?.setMap(map.current); renderer.current?.setDirections(result);
        value.current.distanceKm = meters / 1000; setDistance(meters / 1000);setMessage('Route preview ready. Check both pins and the fare before requesting.'); emit();
      } else setMessage(status==='REQUEST_DENIED'?'Route service is unavailable. Contact MatMove support or retry after the map configuration is corrected.':'Could not calculate this driving route. Check both pins and retry.');
    });}catch{stopTimeout();completed=true;setRouting(false);setMessage('Route service could not start. Check your connection and retry the preview.');}
  }

  const mapFirst=layout==='map-first';
  return <section className={mapFirst?"fixed inset-0 z-10 min-h-[100dvh] bg-[#e9eef1]":"w-full min-w-0 space-y-3 rounded-2xl border bg-white p-3 sm:p-4"} aria-label="Trip locations">
    {mapFirst&&<div className="absolute inset-0 bg-[#e9eef1]"><div ref={mapElement} aria-label="Choose pickup and destination on the map" style={{height:'100dvh',minHeight:'100dvh'}} className="w-full bg-[#e9eef1]"/><div className="pointer-events-none absolute left-4 top-20 rounded-full border border-white/70 bg-white/95 px-3 py-2 text-[11px] font-extrabold tracking-wide text-slate-700 shadow-md"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500"/>FREETOWN · LIVE MAP</div></div>}
    {mapFirst&&<button type="button" onClick={()=>onBack?.()} aria-label="Back to MatMove home" className="fixed left-4 top-[calc(env(safe-area-inset-top)+14px)] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white text-slate-900 shadow-lg transition hover:bg-slate-50"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>}
    {mapFirst&&bookingReady&&!editingRoute&&<div className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)+70px)] z-20 mx-auto max-w-xl rounded-2xl border border-white/80 bg-white/95 p-3 shadow-lg backdrop-blur"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Your route</p><p className="truncate text-xs font-bold text-slate-800">From: {textsRef.current.pickup||'Pickup selected'}</p><p className="truncate text-xs text-slate-500">To: {textsRef.current.destination||'Destination selected'}</p></div><button type="button" onClick={()=>{setEditingRoute(true);setLocationPanelExpanded(true);onRouteEditingChange?.(true);}} className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Change locations</button></div></div>}
    {(!mapFirst||!bookingReady||editingRoute)&&<div className={mapFirst?`fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-5xl overflow-x-hidden rounded-t-[28px] border border-slate-200 bg-white px-4 pb-5 pt-2 shadow-[0_-16px_45px_rgba(15,35,50,.2)] sm:px-6 ${locationPanelExpanded?'max-h-[min(74dvh,720px)]':'max-h-[290px]'} overflow-y-auto`:"relative z-20 space-y-3"}>
      {mapFirst&&<button type="button" aria-label="Drag or tap to expand or collapse ride locations" aria-expanded={locationPanelExpanded} onPointerDown={event=>{locationDragged.current=false;locationDragStart.current=event.clientY;event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(locationDragStart.current!==null)setLocationDragDelta(Math.max(-180,Math.min(240,event.clientY-locationDragStart.current)));}} onPointerUp={event=>{const start=locationDragStart.current;if(start===null)return;const delta=event.clientY-start;if(Math.abs(delta)>28){locationDragged.current=true;if(delta<0)setLocationPanelExpanded(true);else setLocationPanelExpanded(false);}locationDragStart.current=null;setLocationDragDelta(0);}} onPointerCancel={()=>{locationDragStart.current=null;setLocationDragDelta(0);}} onClick={()=>{if(locationDragged.current){locationDragged.current=false;return;}setLocationPanelExpanded(value=>!value);}} style={{transform:locationDragDelta? `translateY(${Math.max(-110,Math.min(170,locationDragDelta))}px)`:undefined,transition:locationDragStart.current===null?'transform 220ms cubic-bezier(.2,.8,.2,1)':'none'}} className="mx-auto mb-2 flex h-7 w-16 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"><span className="h-1.5 w-12 rounded-full bg-slate-300"/></button>}
      {mapFirst&&<div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-emerald-700">MatMove · Freetown</p><h2 className="mt-0.5 text-lg font-black text-slate-950">Plan your ride</h2></div><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-800">Pickup & destination</span></div>}
    {userId && <div className="rounded-xl bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2"><b>Saved Home & Work</b></div>{savedLoading ? <p role="status" className="mt-1 text-slate-600">Loading saved places…</p> : savedError ? <p role="alert" className="mt-1 text-red-700">{savedError} <button type="button" className="min-h-10 underline" onClick={() => setPreferencesRetry(n => n+1)}>Reload saved places</button></p> : !saved.length ? <p className="mt-1 text-xs text-slate-600">Choose a location, then save it as Home or Work.</p> : <p className="mt-1 text-xs text-slate-600">Your saved places are ready below.</p>}</div>}
    <p className="text-xs text-slate-600">Enter both locations, choose a suggestion, or pin them directly on the map. Voice entry is optional. {!voiceAvailable&&'Typing and map pins are available.'}</p>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {(['pickup','destination'] as Target[]).map(target => <div key={target} className="min-w-0">
        <label className="block text-sm font-bold capitalize">{target}<input aria-label={target === 'pickup' ? 'Pickup address' : 'Destination address'} role="combobox" aria-autocomplete="list" aria-expanded={suggestions?.target===target&&suggestions.items.length>0} aria-controls={`mm-${target}-suggestions`} aria-activedescendant={suggestions?.target===target&&activeSuggestion>=0?`mm-${target}-suggestion-${activeSuggestion}`:undefined} autoComplete="off" value={texts[target]} maxLength={300} placeholder={target==='pickup'?'Enter pickup location':'Where are you going?'} onChange={e => typeAddress(target,e.target.value)} onKeyDown={e=>{const items=suggestions?.target===target?suggestions.items:[];if(e.key==='Escape'){tokens.current[target]++;setSuggestions(null);setSearching(null);setActiveSuggestion(-1);}else if(items.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setActiveSuggestion(i=>(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length);}else if(e.key==='Enter'){e.preventDefault();if(items.length&&activeSuggestion>=0)void chooseSuggestion(target,items[activeSuggestion]);else searchAddress(target);}}} className="mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-base font-normal outline-none focus:border-emerald-600 focus:bg-white"/></label>
        {suggestions?.target===target&&suggestions.items.length>0&&<div className="mt-2 rounded-xl border bg-white shadow-lg"><ul id={`mm-${target}-suggestions`} role="listbox" aria-label={`${target} place suggestions`} className="max-h-48 overflow-y-auto">{suggestions.items.map((item,index)=><li key={item.placeId} id={`mm-${target}-suggestion-${index}`} role="option" aria-selected={activeSuggestion===index}><button type="button" onClick={()=>void chooseSuggestion(target,item)} className={`min-h-11 w-full border-b p-3 text-left text-sm ${activeSuggestion===index?'bg-emerald-50':''}`}>{item.text.toString()}</button></li>)}</ul><p className="px-3 py-2 text-right text-xs text-slate-500">Google Maps</p></div>}
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!ready||!voiceAvailable} aria-pressed={listening===target} onClick={()=>speak(target)} className="min-h-9 rounded-lg border px-3 text-xs font-bold disabled:opacity-50">{listening===target?'Stop microphone':`Speak ${target}`}</button><button type="button" disabled={!ready || searching === target || texts[target].trim().length < 3} className="min-h-9 rounded-lg border px-3 text-xs font-bold disabled:opacity-50" onClick={() => searchAddress(target)}>{searching === target ? 'Searching…' : `Find ${target}`}</button>{saved.map(place => <button key={place.kind} type="button" disabled={!ready || saving || savedLoading || !!savedError} onClick={() => useSaved(target,place)} className="min-h-9 rounded-lg bg-emerald-50 px-3 text-xs font-bold capitalize text-emerald-800">{place.kind}</button>)}</div>
        {results?.target === target && <ul aria-label={`${target} address matches`} className="mt-2 max-h-44 overflow-y-auto rounded-xl border bg-white">{results.items.map((item,index) => <li key={item.place_id || index}><button type="button" className="w-full border-b p-3 text-left text-sm" onClick={() => { const location=item.geometry.location; putPoint(target,{address:item.formatted_address,coords:[location.lng(),location.lat()]}); setMessage('Location selected. Your route previews automatically once both pins are selected.'); }}>{item.formatted_address}</button></li>)}</ul>}
        {userId && value.current[target] && <div className="mt-2 flex flex-wrap gap-2">{(['home','work'] as const).map(kind => <button key={kind} type="button" disabled={saving || savedLoading || !!savedError} className="min-h-9 rounded-lg px-2 text-xs text-blue-700 underline disabled:opacity-50" onClick={() => void savePlace(target,kind)}>Save {target} as {kind}</button>)}</div>}
      </div>)}
    </div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={!ready} onClick={() => {stopVoice();locate(true);}} className="min-h-10 rounded-xl border px-3 text-xs font-bold disabled:opacity-50">Use live location</button>{(['pickup','destination'] as Target[]).map(target => <button type="button" key={target} disabled={!ready} aria-pressed={pinTarget === target} onClick={() => { stopVoice();tokens.current.pickup++; tokens.current.destination++; setSearching(null); setResults(null); pinRef.current=target; setPinTarget(target); setMessage(`Tap the map to choose ${target}. Drag the pin to adjust it.`); }} className={`min-h-10 rounded-xl border px-3 text-xs font-bold disabled:opacity-50 ${pinTarget === target ? 'bg-blue-700 text-white' : ''}`}>Pin {target}</button>)}<button type="button" onClick={()=>previewRoute()} disabled={!ready || routing || !value.current.pickup || !value.current.destination} className="min-h-10 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-50">{routing ? 'Finding route…' : 'Preview route'}</button></div>
    {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    {distance !== null && <p className="text-sm font-bold text-emerald-700">Route distance: {distance.toFixed(1)} km</p>}
    {mapError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{mapError} <button type="button" className="min-h-10 px-2 font-bold underline" onClick={() => setRetry(n => n+1)}>Retry map</button></p> : !ready && <p role="status" className="p-3 text-sm text-slate-600">Loading map…</p>}
    </div>}
    {mapFirst&&bookingReady&&!editingRoute&&<div className="fixed bottom-[calc(82px+env(safe-area-inset-bottom))] left-4 right-4 z-20 mx-auto max-w-xl text-center"><span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/90 px-4 py-2 text-xs font-bold text-slate-700 shadow-md"><span className="h-2 w-2 rounded-full bg-emerald-500"/>{distance!==null?`Route ready · ${distance.toFixed(1)} km`:'Route selected'} · Review your fare below</span></div>}
    {!mapFirst&&<div ref={mapElement} aria-label="Choose pickup and destination on the map" style={{height:'clamp(260px,42dvh,440px)',minHeight:260}} className="w-full rounded-xl bg-slate-100"/>}
  </section>;
