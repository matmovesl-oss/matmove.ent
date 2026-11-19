import {useEffect,useRef,useState} from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {supabase} from '@/lib/supabase';
import {portalIsUnlocked,onPortalPrivacyChange} from '@/lib/portalPrivacy';
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
 const routeAttempt=useRef(0),routeTimer=useRef<ReturnType<typeof setTimeout>|null>(null),lastRoute=useRef({key:'',time:0});
 const snapshotNow=useRef<Snapshot|null>(null);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[sharing,setSharing]=useState(false),[gpsError,setGpsError]=useState(''),[mapError,setMapError]=useState(''),[mapReady,setMapReady]=useState(false),[mapRetry,setMapRetry]=useState(0);
 const host=useRef<HTMLDivElement>(null),map=useRef<mapboxgl.Map|null>(null),markers=useRef<Record<string,mapboxgl.Marker>>({}),centered=useRef(false),latest=useRef({userId,bookingId});latest.current={userId,bookingId};
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
    },error=>fail(error.code===1?'MatMove location permission is denied. Allow Location in your phone or browser settings, then tap Share live location again.':error.code===3?'The phone GPS timed out. Turn on Location Services and retry sharing.':'The phone could not get a GPS fix. Move to a clearer signal and retry sharing.'),{enableHighAccuracy:true,timeout:12000,maximumAge:5000});
   }catch{fail('Could not confirm your assigned trip. Reload before sharing GPS.');}
  })();
  return()=>{live=false;if(watch!==undefined)navigator.geolocation.clearWatch(watch);if(shareKey)void tripLocationRpc(userId,bookingId,'clear',undefined,shareKey,!driver).catch(()=>{});};
 },[userId,bookingId,driver,sharing]);
 useEffect(()=>{let live=true;setMapReady(false);setMapError('');centered.current=false;
  const token=import.meta.env.VITE_MAPBOX_TOKEN||'';
  if(!token){setMapError('Mapbox is not configured for this deployment.');return;}
  mapboxgl.accessToken=token;
  const instance=new mapboxgl.Map({container:host.current!,style:'mapbox://styles/mapbox/streets-v12',center:[-13.2290,8.4808],zoom:13,attributionControl:true});
  map.current=instance;
  instance.addControl(new mapboxgl.NavigationControl({showCompass:true}),'top-right');
  instance.once('load',()=>{if(live)setMapReady(true);});
  instance.on('error',()=>{if(live&&!mapReady)setMapError('Mapbox could not load the map. Check token permissions and allowed origins.');});
  return()=>{live=false;for(const m of Object.values(markers.current))m.remove();markers.current={};routeAttempt.current++;if(routeTimer.current)clearTimeout(routeTimer.current);if(map.current===instance)map.current=null;instance.remove();};
 },[bookingId,mapRetry]);
 useEffect(()=>{if(!map.current||!mapReady)return;
  const positions:Record<string,Point|null>={pickup:snapshot?.pickup||null,destination:snapshot?.destination||null,driver:snapshot?.position||null,customer:customerSnapshot?.position||null};
  const colors:Record<string,string>={pickup:'#16a34a',destination:'#dc2626',driver:'#2563eb',customer:'#7c3aed'};
  for(const name of Object.keys(positions)){const p=positions[name];if(!p){markers.current[name]?.remove();delete markers.current[name];continue;}
   if(!markers.current[name])markers.current[name]=new mapboxgl.Marker({color:colors[name]}).setLngLat([p.lng,p.lat]).setPopup(new mapboxgl.Popup({offset:22}).setText(name==='driver'?'Assigned driver':name==='customer'?'Trip customer':name==='pickup'?'Pickup':'Destination')).addTo(map.current);
   else markers.current[name].setLngLat([p.lng,p.lat]);
  }
  if(snapshot&&!centered.current){const p=snapshot.position||snapshot.pickup||snapshot.destination;if(p){map.current.easeTo({center:[p.lng,p.lat],duration:500});centered.current=true;}}
 },[snapshot,customerSnapshot,mapReady]);
 useEffect(()=>{
  const trip=snapshot,position=trip?.locationState==='fresh'?trip.position:null;
  const target=trip?.status==='accepted'?trip.pickup:trip?.destination;
  if(!trip||!navigating||!driver||!mapReady||!position||!target||!pageVisible(userId)){
   routeAttempt.current++;if(routeTimer.current)clearTimeout(routeTimer.current);
   if(map.current?.getSource('matmove-active-route')){map.current.removeLayer('matmove-active-route');map.current.removeSource('matmove-active-route');}
   lastRoute.current={key:'',time:0};setRouteSteps([]);setRouteText(navigating?'Waiting for a fresh shared GPS location and saved trip pins.':'');return;
  }
  const key=`${bookingId}:${trip.status}:${position.lat}:${position.lng}:${target.lat}:${target.lng}`;
  if(lastRoute.current.key===key&&Date.now()-lastRoute.current.time<30000)return;
  lastRoute.current={key,time:Date.now()};const attempt=++routeAttempt.current;
  if(routeTimer.current)clearTimeout(routeTimer.current);setRouteText('Loading your Mapbox route inside MatMove…');
  const token=import.meta.env.VITE_MAPBOX_TOKEN||'';
  const url=`https://api.mapbox.com/directions/v5/mapbox/driving/${position.lng},${position.lat};${target.lng},${target.lat}?alternatives=false&geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;
  const controller=new AbortController();
  routeTimer.current=setTimeout(()=>{controller.abort();if(routeAttempt.current===attempt){routeAttempt.current++;setRouteText('Route request timed out. Stop and restart navigation to retry.');}},15000);
  void fetch(url,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Route request failed');return response.json();}).then(data=>{
   if(routeAttempt.current!==attempt||latest.current.userId!==userId||latest.current.bookingId!==bookingId||!pageVisible(userId)||snapshotNow.current?.status!==trip.status)return;
   if(routeTimer.current)clearTimeout(routeTimer.current);
   const route=data?.routes?.[0],leg=route?.legs?.[0],coordinates=route?.geometry?.coordinates;
   if(!route||!leg||!Array.isArray(coordinates)||coordinates.length<2)throw new Error('No route returned');
   const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates}} as const;
   if(map.current?.getSource('matmove-active-route'))(map.current.getSource('matmove-active-route') as mapboxgl.GeoJSONSource).setData(feature as any);
   else if(map.current){map.current.addSource('matmove-active-route',{type:'geojson',data:feature as any});map.current.addLayer({id:'matmove-active-route',type:'line',source:'matmove-active-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#2563eb','line-width':5,'line-opacity':0.85}});}
   setRouteText(`${(route.distance/1000).toFixed(1)} km · about ${Math.max(1,Math.round(route.duration/60))} min to ${trip.status==='accepted'?'pickup':'destination'}`);
   setRouteSteps((leg.steps||[]).slice(0,30).map((step:any)=>String(step.maneuver?.instruction||step.name||'').replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim()).filter(Boolean));
   const bounds=coordinates.reduce((b:any,c:any)=>b.extend(c),new mapboxgl.LngLatBounds(coordinates[0],coordinates[0]));
   map.current?.fitBounds(bounds,{padding:48,maxZoom:16,duration:500});
  }).catch(()=>{if(routeTimer.current)clearTimeout(routeTimer.current);if(routeAttempt.current===attempt)setRouteText('Mapbox route unavailable. Check connection, token permissions and Directions API access.');});
  return()=>{controller.abort();if(routeTimer.current)clearTimeout(routeTimer.current);};
 },[navigating,driver,mapReady,snapshot,userId,bookingId]);
 useEffect(()=>{if(navigating&&snapshot?.locationState==='fresh'&&snapshot.position&&map.current)map.current.easeTo({center:[snapshot.position.lng,snapshot.position.lat],duration:400});},[navigating,snapshot]);
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
