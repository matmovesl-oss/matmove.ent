import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {portalIsUnlocked,onPortalPrivacyChange} from '@/lib/portalPrivacy';
import {loadGoogleMaps} from '@/components/RideLocationPicker';
type Point={lat:number;lng:number};
type Snapshot={bookingId:string;viewerId:string;riderId:string;driverId:string;status:'accepted'|'in_progress';pickup:Point|null;destination:Point|null;position:(Point&{accuracy:number;observedAt:string;receivedAt:string})|null;locationState:'fresh'|'waiting'|'stale';serverTime:string};
const pageVisible=(userId?:string)=>document.visibilityState!=='hidden'&&(!userId||portalIsUnlocked(userId));
const point=(p:any)=>p&&typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
export function tripPinFields(pickup:[number,number],destination:[number,number]){
 if(!Array.isArray(pickup)||pickup.length!==2||!Array.isArray(destination)||destination.length!==2||!point({lng:pickup[0],lat:pickup[1]})||!point({lng:destination[0],lat:destination[1]}))throw Error('Confirm both map locations before requesting.');
 return{matmove_pickup_lat:pickup[1],matmove_pickup_lng:pickup[0],matmove_destination_lat:destination[1],matmove_destination_lng:destination[0]};
}
export function validateTripSnapshot(data:any,userId:string,bookingId:string,driver:boolean):Snapshot{
 if(data?.bookingId!==bookingId||data.viewerId!==userId||typeof data.riderId!=='string'||typeof data.driverId!=='string'||data.riderId===data.driverId||(driver?data.driverId:data.riderId)!==userId||!['accepted','in_progress'].includes(data.status)||!['fresh','waiting','stale'].includes(data.locationState)||!Number.isFinite(Date.parse(data.serverTime))||
  (data.pickup!==null&&!point(data.pickup))||(data.destination!==null&&!point(data.destination))||
  (data.position!==null&&(!point(data.position)||typeof data.position.accuracy!=='number'||!Number.isFinite(data.position.accuracy)||data.position.accuracy<0||data.position.accuracy>150||!Number.isFinite(Date.parse(data.position.observedAt))||!Number.isFinite(Date.parse(data.position.receivedAt))))||
  (data.locationState==='fresh')!==(data.position!==null))throw Error('Trip location could not be verified. Retry the trip map.');
 return data;
}
export async function tripLocationRpc(userId:string,bookingId:string,action:'read'|'start'|'publish'|'clear',sample?:{lat:number;lng:number;accuracy:number;observed:string},shareKey?:string,customer=false){
 const before=await supabase.auth.getSession();if(before.error||before.data.session?.user.id!==userId||!before.data.session.access_token)throw Error('Your sign-in changed. Reopen your trip.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const {data,error}=await supabase.rpc(customer?'matmove_customer_trip_location':'matmove_trip_location',{p_booking:bookingId,p_action:action,...(shareKey?{p_share:shareKey}:{}),...(sample?{p_lat:sample.lat,p_lng:sample.lng,p_accuracy:sample.accuracy,p_observed:sample.observed}:{})}).setHeader('Authorization',`Bearer ${before.data.session.access_token}`).abortSignal(controller.signal);
  if(error)throw Error('Trip location is unavailable. Retry after checking your connection.');const after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==userId)throw Error('Your sign-in changed. Reopen your trip.');return data;
 }finally{clearTimeout(timer);}
}
export default function ActiveTripMap({userId,bookingId,driver=false}:{userId:string;bookingId:string;driver?:boolean}){
 const [customerSnapshot,setCustomerSnapshot]=useState<Snapshot|null>(null),[customerLocationError,setCustomerLocationError]=useState('');
 const wantsSharing=useRef(false);
 const [navigating,setNavigating]=useState(false),[routeText,setRouteText]=useState(''),[routeSteps,setRouteSteps]=useState<string[]>([]);
 const routeRenderer=useRef<google.maps.DirectionsRenderer|null>(null),routeAttempt=useRef(0),routeTimer=useRef<ReturnType<typeof setTimeout>|null>(null),lastRoute=useRef({key:'',time:0});
 const snapshotNow=useRef<Snapshot|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[sharing,setSharing]=useState(false),[gpsError,setGpsError]=useState(''),[mapError,setMapError]=useState(''),[mapReady,setMapReady]=useState(false),[mapRetry,setMapRetry]=useState(0);
 const host=useRef<HTMLDivElement>(null),map=useRef<google.maps.Map|null>(null),markers=useRef<Record<string,google.maps.Marker>>({}),centered=useRef(false),latest=useRef({userId,bookingId});latest.current={userId,bookingId};
 snapshotNow.current=snapshot;
 const acceptSnapshot=(d:Snapshot)=>setSnapshot(old=>!old||Date.parse(d.serverTime)>=Date.parse(old.serverTime)?d:old);
 useEffect(()=>{let live=true,busy=false,epoch=0;setSnapshot(null);setError('');setLoading(true);setSharing(false);wantsSharing.current=false;setGpsError('');setCustomerSnapshot(null);setCustomerLocationError('');
  async function read(){if(!live||!pageVisible(userId))return;setSnapshot(old=>old?.position&&Date.now()-Date.parse(old.position.receivedAt)>45000?{...old,position:null,locationState:'stale'}:old);setCustomerSnapshot(old=>old?.position&&Date.now()-Date.parse(old.position.receivedAt)>45000?{...old,position:null,locationState:'stale'}:old);if(busy)return;busy=true;const ownEpoch=epoch;
   try{const d=validateTripSnapshot(await tripLocationRpc(userId,bookingId,'read'),userId,bookingId,driver);if(live&&epoch===ownEpoch&&pageVisible(userId)){acceptSnapshot(d);setError('');}
    if(!live||epoch!==ownEpoch||!pageVisible(userId))return;
    try{const customer=validateTripSnapshot(await tripLocationRpc(userId,bookingId,'read',undefined,undefined,true),userId,bookingId,driver);if(live&&epoch===ownEpoch&&pageVisible(userId)){setCustomerSnapshot(customer);setCustomerLocationError('');}}catch{if(live&&epoch===ownEpoch){setCustomerSnapshot(null);setCustomerLocationError('Customer location is unavailable. Check the customer tracking setup or retry.');}}}
   catch(e){if(live){setSnapshot(null);setError(e instanceof Error?e.message:'Trip location unavailable.');}}
   finally{busy=false;if(live)setLoading(false);}
  }
  const visibility=()=>{if(!pageVisible(userId)){epoch++;setSnapshot(null);setCustomerSnapshot(null);setSharing(false);}else{void read();if(wantsSharing.current)setSharing(true);}};
  const stopPrivacy=onPortalPrivacyChange(id=>{if(id===userId)visibility();});
  void read();const interval=window.setInterval(()=>void read(),5000);document.addEventListener('visibilitychange',visibility);
  return()=>{live=false;stopPrivacy();window.clearInterval(interval);document.removeEventListener('visibilitychange',visibility);};
 },[userId,bookingId,driver,retry]);
 useEffect(()=>{if(!sharing)return;let live=true,watch:number|undefined,publishing=false,lastSent=0,shareKey:string|undefined;setGpsError('');
  const valid=()=>live&&pageVisible(userId)&&latest.current.userId===userId&&latest.current.bookingId===bookingId;
  const fail=(message:string)=>{if(live){wantsSharing.current=false;setGpsError(message);setSharing(false);}};
  if(!navigator.geolocation){fail('Live GPS is unavailable. You can still use the saved trip pins.');return;}
  void(async()=>{
   try{const raw=await tripLocationRpc(userId,bookingId,'start',undefined,undefined,!driver);if(typeof raw?.shareKey!=='string'||!/^[-0-9a-f]{36}$/i.test(raw.shareKey))throw Error('Sharing session was not confirmed.');shareKey=raw.shareKey;const d=validateTripSnapshot(raw,userId,bookingId,driver);if(!valid()){void tripLocationRpc(userId,bookingId,'clear',undefined,shareKey,!driver).catch(()=>{});return;}if(driver)acceptSnapshot(d);else setCustomerSnapshot(d);
    watch=navigator.geolocation.watchPosition(position=>{
     if(!valid()||publishing||Date.now()-lastSent<5000)return;
     const {latitude:lat,longitude:lng,accuracy}=position.coords;
     if(!point({lat,lng})||!Number.isFinite(accuracy)||accuracy<0||accuracy>150||!Number.isFinite(position.timestamp)||Date.now()-position.timestamp>60000||position.timestamp-Date.now()>15000){setGpsError('GPS is approximate or stale. Move to a clearer signal; your old position is not sent.');return;}
     publishing=true;lastSent=Date.now();
     void tripLocationRpc(userId,bookingId,'publish',{lat,lng,accuracy,observed:new Date(position.timestamp).toISOString()},shareKey,!driver).then(raw=>{const d=validateTripSnapshot(raw,userId,bookingId,driver);if(valid()){if(driver)acceptSnapshot(d);else setCustomerSnapshot(d);setError('');setGpsError('');}}).catch(()=>fail('Location sharing could not be confirmed. Check your connection and choose Share live location again.')).finally(()=>{publishing=false;});
    },()=>fail('Location permission was unavailable. You can still use the saved trip pins.'),{enableHighAccuracy:true,timeout:10000,maximumAge:5000});
   }catch{fail('Could not confirm your assigned trip. Reload before sharing GPS.');}
  })();
  return()=>{live=false;if(watch!==undefined)navigator.geolocation.clearWatch(watch);if(shareKey)void tripLocationRpc(userId,bookingId,'clear',undefined,shareKey,!driver).catch(()=>{});};
 },[userId,bookingId,driver,sharing]);
 useEffect(()=>{let live=true;setMapReady(false);setMapError('');centered.current=false;
  void loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY||'').then(()=>{if(!live||!host.current)return;map.current=new google.maps.Map(host.current,{center:{lat:8.4808,lng:-13.2290},zoom:14,disableDefaultUI:true,zoomControl:true,gestureHandling:'greedy'});setMapReady(true);}).catch(()=>{if(live)setMapError('Could not load the trip map. Retry when connected.');});
  return()=>{live=false;for(const m of Object.values(markers.current)){google.maps.event.clearInstanceListeners(m);m.setMap(null);}markers.current={};routeAttempt.current++;if(routeTimer.current)clearTimeout(routeTimer.current);routeRenderer.current?.setMap(null);routeRenderer.current=null;if(map.current)google.maps.event.clearInstanceListeners(map.current);map.current=null;};
 },[bookingId,mapRetry]);
 useEffect(()=>{if(!map.current||!mapReady)return;
  const positions:Record<string,Point|null>={pickup:snapshot?.pickup||null,destination:snapshot?.destination||null,driver:snapshot?.position||null,customer:customerSnapshot?.position||null};
  for(const name of Object.keys(positions)){const p=positions[name];if(!p){markers.current[name]?.setMap(null);continue;}
   if(!markers.current[name])markers.current[name]=new google.maps.Marker({position:p,map:map.current,title:name==='driver'?'Assigned driver':name==='customer'?'Trip customer':name==='pickup'?'Pickup':'Destination',label:name==='driver'?'D':name==='customer'?'C':name==='pickup'?'A':'B'});
   else{markers.current[name].setMap(map.current);markers.current[name].setPosition(p);}
  }
  if(snapshot&&!centered.current){const p=snapshot.position||snapshot.pickup||snapshot.destination;if(p){map.current.panTo(p);centered.current=true;}}
 },[snapshot,customerSnapshot,mapReady]);
 useEffect(()=>{
  const trip=snapshot,position=trip?.locationState==='fresh'?trip.position:null;
  const target=trip?.status==='accepted'?trip.pickup:trip?.destination;
  if(!trip||!navigating||!driver||!mapReady||!position||!target||!pageVisible(userId)){
   routeAttempt.current++;if(routeTimer.current)clearTimeout(routeTimer.current);routeRenderer.current?.setMap(null);lastRoute.current={key:'',time:0};setRouteSteps([]);setRouteText(navigating?'Waiting for a fresh shared GPS location and saved trip pins.':'');return;
  }
  const key=`${bookingId}:${trip.status}:${target.lat}:${target.lng}`;
  if(lastRoute.current.key===key&&Date.now()-lastRoute.current.time<30000)return;
  lastRoute.current={key,time:Date.now()};const attempt=++routeAttempt.current;
  if(routeTimer.current)clearTimeout(routeTimer.current);setRouteText('Loading your route inside MatMove…');
  routeTimer.current=setTimeout(()=>{if(routeAttempt.current===attempt){routeAttempt.current++;setRouteText('Route request timed out. Stop and restart navigation to retry.');}},15000);
  try{
   new google.maps.DirectionsService().route({origin:{lat:position.lat,lng:position.lng},destination:target,travelMode:google.maps.TravelMode.DRIVING},(result,status)=>{
    if(routeAttempt.current!==attempt||latest.current.userId!==userId||latest.current.bookingId!==bookingId||!pageVisible(userId)||snapshotNow.current?.status!==trip.status)return;
    if(routeTimer.current)clearTimeout(routeTimer.current);
    const leg=result?.routes?.[0]?.legs?.[0];if(status!=='OK'||!result||!leg){setRouteText('Route unavailable. Check your connection and restart navigation.');return;}
    if(!routeRenderer.current)routeRenderer.current=new google.maps.DirectionsRenderer({suppressMarkers:true,preserveViewport:true});
    routeRenderer.current.setMap(map.current);routeRenderer.current.setDirections(result);
    setRouteText(`${leg.distance?.text||'Distance unavailable'} · ${leg.duration?.text||'Time unavailable'} to ${trip.status==='accepted'?'pickup':'destination'}`);
    setRouteSteps((leg.steps||[]).slice(0,30).map(step=>String(step.instructions||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()).filter(Boolean));
   });
  }catch{if(routeTimer.current)clearTimeout(routeTimer.current);setRouteText('Route guidance is unavailable. Check the map service configuration.');}
 },[navigating,driver,mapReady,snapshot,userId,bookingId]);
 useEffect(()=>{if(navigating&&snapshot?.locationState==='fresh'&&snapshot.position&&map.current)map.current.panTo(snapshot.position);},[navigating,snapshot]);
 const fresh=snapshot?.locationState==='fresh'&&snapshot.position;
 const destination=driver?(snapshot?.status==='accepted'?snapshot.pickup:snapshot?.destination):null;
 return <section aria-label="Active trip map" className="min-w-0 space-y-3 rounded-2xl border bg-white p-3">
  <h3 className="font-bold">{driver?'Your assigned trip':'Your driver’s location'}</h3>
  {loading&&!snapshot?<p role="status" className="text-sm">Loading private trip location…</p>:error?<p role="alert" className="text-sm text-red-700">{error}<button type="button" onClick={()=>setRetry(n=>n+1)} className="min-h-11 px-2 font-bold underline">Retry trip location</button></p>:<p role="status" className="text-sm">{fresh?`Location updated ${new Date(fresh.receivedAt).toLocaleTimeString()}. Accuracy about ${Math.ceil(fresh.accuracy)} m.`:snapshot?.locationState==='stale'?'Driver location is out of date and hidden. Waiting for a fresh GPS reading.':'Waiting for the assigned driver to share a fresh GPS location.'}</p>}
  {<div className="space-y-2"><p className="text-xs text-slate-600">{driver?'Share GPS with this trip’s customer':'Share GPS with your assigned driver'} and authorised MatMove Dispatch staff while this screen is open. Stop sharing at any time. Backgrounding or closing this screen stops sharing; an unreachable last update expires within 45 seconds.</p><button type="button" disabled={!sharing&&(!snapshot||!!error)} onClick={()=>{wantsSharing.current=!sharing;setSharing(v=>!v);}} className="min-h-11 rounded-xl border px-3 font-bold disabled:opacity-50">{sharing?'Stop sharing location':'Share live location'}</button>{gpsError&&<p role="alert" className="text-sm text-amber-900">{gpsError}</p>}</div>}
  {customerLocationError&&<p role="status" className="text-xs text-amber-900">{customerLocationError}</p>}
  {driver&&customerSnapshot&&<p className="text-xs text-slate-600">{customerSnapshot.locationState==='fresh'?'Customer GPS is shared on the map.':'Waiting for the customer to share their location. The saved pickup pin remains unchanged.'}</p>}
  {snapshot&&(!snapshot.pickup||!snapshot.destination)&&<p className="text-xs text-amber-900">This older request has no saved map pins. Check its written pickup and destination; no substitute coordinates have been invented.</p>}
  {destination&&<button type="button" onClick={()=>{setNavigating(v=>!v);lastRoute.current={key:'',time:0};if(!navigating){wantsSharing.current=true;setSharing(true);}}} className="min-h-11 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white">{navigating?'Stop in-app navigation':`Navigate inside MatMove to ${snapshot?.status==='accepted'?'pickup':'destination'}`}</button>}
  {navigating&&<div className="rounded-xl bg-blue-50 p-3 text-sm"><p role="status">{routeText}</p>{routeSteps.length>0&&<details className="mt-2"><summary className="cursor-pointer font-bold">Route instructions</summary><ol className="mt-2 list-decimal space-y-2 pl-5">{routeSteps.map((step,i)=><li key={i}>{step}</li>)}</ol></details>}<p className="mt-2 text-xs text-slate-600">Route guidance updates while MatMove is open. Follow road signs and local conditions.</p></div>}
  <p className="text-xs text-slate-500">A = pickup · B = destination · D = assigned driver · C = customer (when shared). GPS is supplied by the driver’s device and does not authorize a fare or payment.</p>
  {mapError?<p role="alert" className="text-sm text-red-700">{mapError}<button type="button" onClick={()=>setMapRetry(n=>n+1)} className="min-h-11 px-2 font-bold underline">Retry trip map</button></p>:!mapReady&&<p role="status" className="text-sm">Loading map…</p>}
  <div ref={host} aria-label="Assigned trip pickup, destination and driver map" className="w-full rounded-xl bg-slate-100" style={{height:'clamp(260px,42dvh,440px)',minHeight:260}}/>
 </section>;
}
