
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props = { userId: string; role: 'rider' | 'driver' | 'merchant' };
const date = (value: unknown) => {
  if (!value) return 'Not recorded';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString();
};
export function tripShareText(t: any) {
  return [
    'MatMove trip receipt', `Reference: ${t.id}`, `Service: ${t.service_type || 'Ride'}`,
    `Status: ${t.status}`, `From: ${t.pickup_location || 'Not recorded'}`,
    `To: ${t.destination_location || 'Not recorded'}`, `Requested: ${date(t.created_at)}`,
    ...(t.scheduled_time ? [`Scheduled: ${date(t.scheduled_time)}`] : []),
    ...(t.accepted_at ? [`Accepted: ${date(t.accepted_at)}`] : []),
    ...(t.passenger_count ? [`Passengers: ${t.passenger_count}`] : []),
    ...(t.passenger_name ? [`Passenger: ${t.passenger_name}`] : []),
    ...(t.started_at ? [`Started: ${date(t.started_at)}`] : []),
    ...(t.completed_at ? [`Completed: ${date(t.completed_at)}`] : []),
    `Fare: SLE ${Number(t.fare_amount || 0).toFixed(2)}`,
    ...(t.driver?.full_name ? [`Driver: ${t.driver.full_name}`] : []),
    ...(t.rider?.full_name ? [`Customer: ${t.rider.full_name}`] : []),
    ...(t.vehicle_type ? [`Vehicle: ${t.vehicle_type}`] : []),
  ].join('\n');
}
export default function TripHistory({ userId, role }: Props) {
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const owner=useRef(userId);owner.current=userId;
  const mounted=useRef(false),inFlight=useRef(false),revision=useRef(0),abort=useRef<AbortController|null>(null);
  const [loadedOwner,setLoadedOwner]=useState(userId);
  const refresh = useCallback(async () => {
    if(inFlight.current)return;inFlight.current=true;const n=++revision.current,id=userId;
    const controller=new AbortController();abort.current=controller;const timeout=setTimeout(()=>controller.abort(),15000);
    const live=()=>mounted.current&&owner.current===id&&revision.current===n;
    try{
      const before=await supabase.auth.getSession();if(before.error||before.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(!live())return;
      const result = await supabase.from('bookings').select('*, driver:driver_id(full_name), rider:rider_id(full_name)')
        .eq(role === 'driver' ? 'driver_id' : 'rider_id', id).order('created_at', { ascending: false }).abortSignal(controller.signal);
      if(result.error)throw Error('Trip history could not be loaded. Retry; no records have been deleted.');
      if(!Array.isArray(result.data)||result.data.some(t=>t[role==='driver'?'driver_id':'rider_id']!==id))throw Error('Trip ownership could not be verified.');
      const after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(live()){setTrips(result.data);setLoadedOwner(id);setError('');}
    }catch(e){if(live()){setTrips([]);setError(e instanceof Error?e.message:'Trip history unavailable.');}}
    finally{clearTimeout(timeout);if(live()){inFlight.current=false;setLoading(false);}}
  }, [userId, role]);
  useEffect(() => {
    mounted.current=true;revision.current++;inFlight.current=false;setTrips([]);setLoadedOwner(userId);setSelectedId(null);setLoading(true);setError('');
    void refresh();
    const timer = window.setInterval(() => { if(document.visibilityState!=='hidden')void refresh(); }, 15000);
    return () => { mounted.current=false;revision.current++;inFlight.current=false;abort.current?.abort();window.clearInterval(timer); };
  }, [refresh,userId]);
  const ownedTrips=loadedOwner===userId?trips:[];
  const selected = ownedTrips.find(t => t.id === selectedId);
  useEffect(() => {
    if (selectedId && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selectedId]);
  async function share(t: any) {
    setNotice('');
    const text = tripShareText(t);
    try {
      if (navigator.share) await navigator.share({ title: 'MatMove trip receipt', text });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setNotice('Trip receipt copied. Paste it into WhatsApp or another app.');
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = `MatMove-trip-${t.id}.txt`; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('Trip receipt downloaded.');
      }
    } catch (e: any) { if (e.name !== 'AbortError') setNotice('Sharing failed. Try again or copy the details below.'); }
  }
  const fields = selected ? [
    ['Reference', selected.id], ['Passengers',String(selected.passenger_count??1)], ['Passenger name',selected.passenger_name], ['Service', selected.service_type], ['Status', selected.status],
    ['Customer', selected.rider?.full_name], ['Driver', selected.driver?.full_name],
    ['Pickup area', selected.pickup_location], ['Destination area', selected.destination_location],
    ['Requested', date(selected.created_at)], ['Scheduled', selected.scheduled_time?date(selected.scheduled_time):selected.service_type==='scheduled'?'Not recorded':'Not scheduled'],
    ['Accepted', date(selected.accepted_at)], ['Started', date(selected.started_at)],
    ['Completed', date(selected.completed_at)], ['Vehicle', selected.vehicle_type],
    ['Fare', `SLE ${Number(selected.fare_amount || 0).toFixed(2)}`],
    ...(role === 'driver' ? [['Expected driver share (85%)', `SLE ${(Number(selected.fare_amount || 0) * 0.85).toFixed(2)}`]] : []),
    ...(selected.distance_km != null ? [['Distance', `${selected.distance_km} km`]] : []),
    ...(selected.payment_status ? [['Payment status', selected.payment_status]] : []),
  ] : [];
  return <section className="mx-auto max-w-4xl space-y-4 p-4 pb-24 sm:p-6">
    <div className="flex items-center justify-between gap-3"><h1 className="text-3xl font-bold">Trips & Deliveries</h1>
      <button className="rounded-xl border bg-white px-4 py-2" onClick={() => void refresh()}>Refresh</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {!selectedId && notice && <p role="status" className="rounded-xl bg-emerald-50 p-3">{notice}</p>}
    {loading ? <p>Loading trips...</p> : !ownedTrips.length && !error ? <p>No trips or deliveries yet.</p> : null}
    {ownedTrips.map(t => <article key={t.id} className="rounded-2xl border bg-white p-4 shadow-sm">
      <button onClick={() => { setNotice(''); setSelectedId(t.id); }} className="w-full text-left">
        <div className="flex justify-between gap-3"><strong className="capitalize">{t.service_type || 'Ride'}</strong><span>{t.status}</span></div>
        <p className="mt-2 text-sm text-slate-500">{date(t.created_at)}</p>
        <p className="mt-2 truncate">{t.pickup_location} → {t.destination_location}</p>
        <p className="mt-2 font-bold">SLE {Number(t.fare_amount || 0).toFixed(2)}</p>
        {role === 'driver' && <p className="mt-1 text-sm text-emerald-700">Expected driver share: SLE {(Number(t.fare_amount || 0) * 0.85).toFixed(2)}</p>}
        <p className="mt-2 text-sm text-blue-700">View full trip details</p>
      </button>
      <button className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={() => void share(t)}>Share trip receipt</button>
    </article>)}
    <dialog ref={dialog} onClose={() => { setSelectedId(null); setNotice(''); }} className="max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl p-6 backdrop:bg-slate-950/60">
      {selected && <><div className="flex justify-between gap-3"><h2 className="text-xl font-bold">Trip details</h2><button autoFocus onClick={() => dialog.current?.close()} className="rounded-lg border px-3 py-2">Close</button></div>
        <dl className="my-4 space-y-3">{fields.map(([label, value]) => <div key={label} className="border-b pb-2"><dt className="text-sm text-slate-500">{label}</dt><dd className="break-words font-medium">{value || 'Not recorded'}</dd></div>)}</dl>
        {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3">{notice}</p>}
        <button onClick={() => void share(selected)} className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white">Share trip receipt</button>
        <p className="mt-3 text-xs text-slate-500">Sharing includes your trip areas, fare and times. Only recorded times are shown.</p>
      </>}
    </dialog>
  </section>;
}
