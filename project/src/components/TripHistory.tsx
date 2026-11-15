
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { shareReceiptPdf } from '@/lib/pdfReceipt';
import { SkeletonList } from '@/components/Skeleton';
import { filterTripHistory } from '@/lib/tripHistory';
import { updateRide, readCashRideStatus, confirmCashRideReturn } from '@/services/rideService';
import { readRideFares } from '@/services/fareNegotiationService';
import { assertDriverFare } from '@/lib/useRideNegotiation';

type Props = { userId: string; role: 'rider' | 'driver' | 'merchant'; onOpenHome?: () => void };
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

function tripReceiptFields(t: any, role: Props['role']) {
  return [
    { label: 'Trip reference', value: t.id },
    { label: 'Service', value: t.service_type || 'Ride' },
    { label: 'Status', value: t.status },
    { label: 'Pickup', value: t.pickup_location },
    { label: 'Destination', value: t.destination_location },
    { label: 'Requested', value: date(t.created_at) },
    { label: 'Scheduled', value: t.scheduled_time ? date(t.scheduled_time) : 'Not scheduled' },
    { label: 'Accepted', value: t.accepted_at ? date(t.accepted_at) : 'Not recorded' },
    { label: 'Started', value: t.started_at ? date(t.started_at) : 'Not recorded' },
    { label: 'Completed', value: t.completed_at ? date(t.completed_at) : 'Not recorded' },
    { label: 'Passenger count', value: t.passenger_count ?? 1 },
    { label: 'Passenger', value: t.passenger_name },
    { label: 'Customer', value: t.rider?.full_name },
    { label: 'Driver', value: t.driver?.full_name },
    { label: 'Vehicle', value: t.vehicle_type },
    { label: 'Fare', value: `SLE ${Number(t.fare_amount || 0).toFixed(2)}` },
    ...(role === 'driver' ? [{ label: 'Expected driver share (85%)', value: `SLE ${(Number(t.fare_amount || 0) * 0.85).toFixed(2)}` }] : []),
    ...(t.payment_status ? [{ label: 'Payment status', value: t.payment_status }] : []),
  ];
}
export default function TripHistory({ userId, role, onOpenHome }: Props) {
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [period,setPeriod]=useState<'30'|'90'|'all'>('30');
  const [tripTab,setTripTab]=useState<'active'|'history'>('active');
  const onlineKey=`matmove:driver-online:v1:${userId}`;
  const [driverOnline,setDriverOnline]=useState(()=>{try{return role==='driver'&&localStorage.getItem(onlineKey)==='online';}catch{return false;}});
  const [acceptingId,setAcceptingId]=useState<string|null>(null);
  const [statusFilter,setStatusFilter]=useState<'all'|'pending'|'pending_admin'|'accepted'|'in_progress'|'completed'|'cancelled'>('all');
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
      const base = supabase.from('bookings').select('*, driver:driver_id(full_name, phone), rider:rider_id(full_name, phone)');
      const query = role === 'driver'
        ? base.or(`driver_id.eq.${id},and(driver_id.is.null,status.in.(pending,pending_admin))`)
        : base.eq('rider_id', id);
      const result = await query.order('created_at', { ascending: false }).limit(1000).abortSignal(controller.signal);
      if(result.error)throw Error('Trip history could not be loaded. Retry; no records have been deleted.');
      const ownsEveryRow=Array.isArray(result.data)&&result.data.every(t=>
        role==='driver'
          ? (t.driver_id===id || (t.driver_id===null && ['pending','pending_admin'].includes(t.status)))
          : t.rider_id===id
      );
      if(!ownsEveryRow)throw Error('Trip ownership could not be verified.');
      const cashRows=(result.data||[]).filter(t=>t.payment_method==='cash'&&(role==='driver'?t.driver_id===id:t.rider_id===id));
      const cashById=new Map<string,any>();
      await Promise.all(cashRows.map(async t=>{
        try{const status=await readCashRideStatus(t.id);if(status.booking?.id===t.id&&status.payment)cashById.set(t.id,status.payment);}catch{/* Keep the last server-verified cash snapshot if a read is temporarily unavailable. */}
      }));
      const withCash=(result.data||[]).map(t=>({...t,cashPayment:cashById.get(t.id)||t.cashPayment||null}));
      const after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(live()){setTrips(withCash);setLoadedOwner(id);setError('');}
    }catch(e){if(live()){setTrips([]);setError(e instanceof Error?e.message:'Trip history unavailable.');}}
    finally{clearTimeout(timeout);if(live()){inFlight.current=false;setLoading(false);}}
  }, [userId, role]);
  useEffect(() => {
    mounted.current=true;revision.current++;inFlight.current=false;setTrips([]);setLoadedOwner(userId);setSelectedId(null);setLoading(true);setError('');
    void refresh();
    // Supabase Realtime provides prompt trip-status updates. The polling fallback
    // remains enabled in case Realtime is unavailable or the table is not published.
    const channel = supabase.channel(`trip-history:${role}:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        ...(role==='driver'?{}:{filter:`rider_id=eq.${userId}`}),
      }, () => {
        if (document.visibilityState !== 'hidden') void refresh();
      })
      .subscribe();
    const timer = window.setInterval(() => { if(document.visibilityState!=='hidden')void refresh(); }, 15000);
    return () => {
      mounted.current=false;revision.current++;inFlight.current=false;abort.current?.abort();
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh,userId,role]);
  const ownedTrips=loadedOwner===userId?trips:[];
  const selected = ownedTrips.find(t => t.id === selectedId);
  const filteredTrips=filterTripHistory(ownedTrips,period,statusFilter);
  const activeRequests = ownedTrips.filter(t => ['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'].includes(t.status));
  const availableRequests = role==='driver' && driverOnline
    ? activeRequests.filter(t=>!t.driver_id&&['pending','pending_admin'].includes(t.status))
    : [];
  const myActiveTrips = role==='driver'
    ? activeRequests.filter(t=>t.driver_id===userId&&['accepted','in_progress'].includes(t.status))
    : activeRequests.filter(t=>['accepted','in_progress'].includes(t.status));
  const historyTrips = filteredTrips.filter(t=>['completed','cancelled'].includes(t.status));
  const [cancellingId,setCancellingId]=useState<string|null>(null);
  const [actionError,setActionError]=useState('');
  const [actionNotice,setActionNotice]=useState('');
  async function cancelRequest(t:any){
    if(cancellingId||!['pending','pending_admin','cash_reserve_pending'].includes(t.status))return;
    const confirmed=window.confirm('Cancel this request? If a payment has already been taken, MatMove will verify the refund before showing the request as cancelled.');
    if(!confirmed)return;
    setCancellingId(t.id);setActionError('');setActionNotice('');
    try{
      const result=await updateRide('cancel',t.id);
      await refresh();
      setActionNotice(result.pending?'Cancellation received. Any required refund is still being verified. Keep this request reference.':result.message||'Request cancellation verified.');
    }catch(error:any){setActionError(error?.message||'Cancellation could not be verified. Refresh this same request; do not submit another payment.');}
    finally{setCancellingId(null);}
  }
  async function acceptAvailableRequest(t:any){
    if(role!=='driver'||!driverOnline||acceptingId||t.driver_id||!['pending','pending_admin'].includes(t.status))return;
    setAcceptingId(t.id);setActionError('');setActionNotice('');
    try{
      const snapshot=await readRideFares(userId,t.id);
      assertDriverFare(snapshot,t,userId);
      const result=await updateRide('accept',t.id);
      await refresh();
      setActionNotice(result.pending
        ? 'Your acceptance/payment is still being verified. This request remains in your Trips list; do not accept it again.'
        : 'Ride accepted. It is now saved under My active trips. You can reopen it after closing MatMove.');
    }catch(error:any){
      setActionError(error?.message||'This request could not be accepted. Refresh Trips and review the same request.');
      await refresh();
    }finally{setAcceptingId(null);}
  }
  async function confirmReturnedCash(t:any){
    if(!t.cashPayment?.adminReturnRequested)return;
    setCancellingId(t.id);setActionError('');setActionNotice('');
    try{
      const result=await confirmCashRideReturn(t.id);
      await refresh();
      setActionNotice(result.refundVerified
        ? 'Physical cash return confirmed by both parties. The MatMove fee reserve refund is verified and the request is cancelled.'
        : result.returnReady
          ? 'Both physical cash return confirmations are recorded. The MatMove fee refund is being verified; keep this request open.'
          : role==='driver'
            ? 'Your cash-return confirmation is recorded. The customer must also confirm receipt.'
            : 'Your receipt confirmation is recorded. The assigned driver must also confirm returning the cash.');
    }catch(error:any){setActionError(error?.message||'Cash return confirmation could not be verified. Refresh this same request.');}
    finally{setCancellingId(null);}
  }
  useEffect(() => {
    if (selectedId && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selectedId]);
  async function share(t: any) {
    setNotice('');
    try {
      const result = await shareReceiptPdf({
        title: 'MatMove Trip Receipt',
        subtitle: 'Trip details from your MatMove account',
        reference: t.id,
        filename: `MatMove-trip-${t.id}`,
        fields: tripReceiptFields(t, role),
      });
      setNotice(result === 'shared' ? 'Trip receipt PDF shared.' : 'Trip receipt PDF downloaded. You can attach it to WhatsApp or email.');
    } catch (error: any) {
      if (error?.name !== 'AbortError') setNotice(error?.message || 'Trip receipt PDF could not be created.');
    }
  }

  const fields = selected ? [
    ['Reference', selected.id], ['Passengers',String(selected.passenger_count??1)], ['Passenger name',selected.passenger_name], ['Service', selected.service_type], ['Status', selected.status],
    ['Customer', selected.rider?.full_name], ['Driver', selected.driver?.full_name],
    ['Pickup area', selected.pickup_location], ['Destination area', selected.destination_location],
    ['Requested', date(selected.created_at)], ['Scheduled', selected.scheduled_time?date(selected.scheduled_time):selected.service_type==='scheduled'?'Not recorded':'Not scheduled'],
    ['Accepted', date(selected.accepted_at)], ['Started', date(selected.started_at)],
    ['Completed', date(selected.completed_at)], ['Vehicle', selected.vehicle_type],
    ['Payment method', selected.payment_method || 'Not recorded'],
    ['Fare', `SLE ${Number(selected.fare_amount || 0).toFixed(2)}`],
    ...(selected.payment_method==='cash'&&selected.cashPayment ? [
      ['Cash ledger',selected.cashPayment.status],
      ['Physical cash to driver',`SLE ${Number(selected.cashPayment.driverCash||0).toFixed(2)}`],
      ['MatMove fee reserve',`SLE ${Number(selected.cashPayment.matmoveFee||0).toFixed(2)}`],
      ['Driver confirmed cash received',selected.cashPayment.driverCashConfirmed?'Yes':'No'],
      ['Customer confirmed handover',selected.cashPayment.riderCashConfirmed?'Yes':'No'],
      ...(selected.cashPayment.adminReturnRequested?[
        ['Admin physical-return request',selected.cashPayment.adminReturnNote||'Requested'],
        ['Driver confirmed returned cash',selected.cashPayment.driverReturnConfirmed?'Yes':'No'],
        ['Customer confirmed cash received back',selected.cashPayment.riderReturnConfirmed?'Yes':'No'],
        ['Fee reserve refund transfer',selected.cashPayment.refund?.status||'Not queued'],
      ]:[]),
    ]:[]),
    ...(role === 'driver' ? [['Expected driver share (85%)', `SLE ${(Number(selected.fare_amount || 0) * 0.85).toFixed(2)}`]] : []),
    ...(selected.distance_km != null ? [['Distance', `${selected.distance_km} km`]] : []),
    ...(selected.payment_status ? [['Payment status', selected.payment_status]] : []),
  ] : [];
  return <section className="mx-auto max-w-4xl space-y-4 p-4 pb-24 sm:p-6">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Trips & Deliveries</h1><p className="mt-1 text-sm text-slate-500">Your current requests, live sessions and completed trip history.</p></div>
        <button className="min-h-11 rounded-xl border bg-white px-4 py-2 font-semibold" onClick={() => void refresh()}>Refresh</button>
      </div>
      <div className="grid gap-3 rounded-2xl border bg-white p-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-700">Time period
          <select aria-label="Filter trips by time period" value={period} onChange={e=>setPeriod(e.target.value as '30'|'90'|'all')} className="mt-1 min-h-11 w-full rounded-xl border p-3">
            <option value="30">Recent — last 30 days</option><option value="90">Last 90 days</option><option value="all">All history</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-slate-700">Trip status
          <select aria-label="Filter trips by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)} className="mt-1 min-h-11 w-full rounded-xl border p-3">
            <option value="all">All statuses</option><option value="pending">Pending</option><option value="pending_admin">Pending Admin review</option><option value="accepted">Accepted</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
        </label>
        <p className="text-xs text-slate-500 sm:col-span-2">Showing {filteredTrips.length} of {ownedTrips.length} trip records.</p>
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {actionError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{actionError}</p>}
    {actionNotice&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-900">{actionNotice}</p>}

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-3">
      <div><h2 className="font-bold">Your trip inbox</h2><p className="text-xs text-slate-500">Current requests stay linked to your account when you leave and return to MatMove.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={tripTab==='active'} onClick={()=>setTripTab('active')} className={`min-h-10 rounded-xl px-4 text-sm font-bold ${tripTab==='active'?'bg-slate-900 text-white':'border bg-white'}`}>Active & requests ({role==='driver'?availableRequests.length+myActiveTrips.length:activeRequests.length})</button>
        <button type="button" aria-pressed={tripTab==='history'} onClick={()=>setTripTab('history')} className={`min-h-10 rounded-xl px-4 text-sm font-bold ${tripTab==='history'?'bg-slate-900 text-white':'border bg-white'}`}>History ({historyTrips.length})</button>
      </div>
    </div>
    {tripTab==='active' ? <>
      {role==='driver' ? <>
        <section aria-label="Available ride requests" className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Available requests</h2><p className="text-sm text-slate-600">Unassigned requests appear here as well as on Driver Radar.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{availableRequests.length} waiting</span></div>
          {!driverOnline&&availableRequests.length>0&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">You are offline. Requests remain visible, but you must go online to accept one. <button type="button" onClick={()=>onOpenHome?.()} className="font-bold underline">Open Driver Home</button></p>}
          {loading?<p className="text-sm text-slate-500">Checking available requests…</p>:availableRequests.length===0?<p className="rounded-xl bg-white p-4 text-sm text-slate-600">There are no unassigned requests available right now. New eligible requests will appear here.</p>:availableRequests.map(t=><article key={`available-${t.id}`} className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{t.rider?.full_name||'MatMove customer'}</strong><p className="text-xs text-slate-500">{t.service_type||'Ride'} · {t.vehicle_type||'Vehicle not specified'} · {date(t.created_at)}</p></div><strong className="text-sm">SLE {Number(t.fare_amount||0).toFixed(2)}</strong></div>
            <p className="mt-2 text-sm">{t.pickup_location||'Pickup not recorded'} → {t.destination_location||'Destination not recorded'}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{t.id}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedId(t.id)} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">Review request</button><button type="button" disabled={!driverOnline||!!acceptingId} onClick={()=>void acceptAvailableRequest(t)} className="min-h-10 rounded-lg bg-indigo-600 px-3 text-sm font-bold text-white disabled:opacity-50">{acceptingId===t.id?'Accepting…':driverOnline?'Accept request':'Go online to accept'}</button></div>
          </article>)}
        </section>
        <section aria-label="My active trips" className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">My active trips</h2><p className="text-sm text-slate-600">Trips accepted by you, including trips currently in progress.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{myActiveTrips.length} active</span></div>
          {loading?<p className="text-sm text-slate-500">Restoring your assigned trips…</p>:myActiveTrips.length===0?<p className="rounded-xl bg-white p-4 text-sm text-slate-600">You have no accepted or in-progress trips. An accepted trip remains here until completion or a verified cancellation.</p>:myActiveTrips.map(t=><article key={`driver-active-${t.id}`} className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap justify-between gap-2"><strong>{t.rider?.full_name||'Customer'}</strong><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold capitalize text-emerald-800">{t.status.replace(/_/g,' ')}</span></div>
            <p className="mt-2 text-sm">{t.pickup_location||'Pickup not recorded'} → {t.destination_location||'Destination not recorded'}</p><p className="mt-1 text-xs text-slate-500">Fare SLE {Number(t.fare_amount||0).toFixed(2)} · {t.payment_method==='cash'?'Cash':'Digital'} · {date(t.created_at)}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedId(t.id)} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">Open trip details</button><button type="button" onClick={()=>onOpenHome?.()} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-sm font-bold text-white">Resume live trip</button></div>
            {t.cashPayment?.adminReturnRequested&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Admin requested return of physical cash</strong><p className="mt-1 text-xs">Return SLE {Number(t.cashPayment.driverCash||0).toFixed(2)} to the customer in person. The customer must independently confirm receipt. The MatMove fee reserve refund is separate.</p><p className="mt-1 text-xs">Driver return: {t.cashPayment.driverReturnConfirmed?'Confirmed':'Waiting'} · Customer receipt: {t.cashPayment.riderReturnConfirmed?'Confirmed':'Waiting'}</p>{!t.cashPayment.driverReturnConfirmed&&<button type="button" disabled={!!cancellingId} onClick={()=>void confirmReturnedCash(t)} className="mt-2 min-h-10 rounded-lg bg-amber-700 px-3 text-xs font-bold text-white disabled:opacity-50">{cancellingId===t.id?'Recording…':'Confirm I returned the physical cash'}</button>}</div>}
          </article>)}
        </section>
      </> : <>
        <section aria-label="Your unfinished requests" className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold">Current requests & live trips</h2><p className="text-sm text-slate-600">Pending, accepted and in-progress rides stay here until resolved.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{activeRequests.length} unfinished</span></div>
          {loading?<p className="text-sm text-slate-500">Restoring your unfinished requests…</p>:activeRequests.length===0?<p className="rounded-xl bg-white p-4 text-sm text-slate-600">You have no unfinished requests.</p>:activeRequests.map(t=><article key={`customer-active-${t.id}`} className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap justify-between gap-2"><strong className="capitalize">{t.service_type||'Ride'} request</strong><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold capitalize text-amber-900">{t.status.replace(/_/g,' ')}</span></div>
            <p className="mt-2 text-sm">{t.pickup_location||'Pickup not recorded'} → {t.destination_location||'Destination not recorded'}</p><p className="mt-1 text-xs text-slate-500">{t.driver?.full_name?`Driver: ${t.driver.full_name}`:'Waiting for a driver'} · SLE {Number(t.fare_amount||0).toFixed(2)}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{t.id}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedId(t.id)} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">Open original request</button>{['accepted','in_progress'].includes(t.status)&&<button type="button" onClick={()=>onOpenHome?.()} className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white">Resume live trip</button>}{['pending','pending_admin','cash_reserve_pending'].includes(t.status)&&<button type="button" disabled={!!cancellingId} onClick={()=>void cancelRequest(t)} className="min-h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50">{cancellingId===t.id?'Cancelling…':'Cancel request'}</button>}</div>
            {t.cashPayment?.adminReturnRequested&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Admin requested physical cash return</strong><p className="mt-1 text-xs">The driver should return SLE {Number(t.cashPayment.driverCash||0).toFixed(2)} physically. Confirm only after you receive it. MatMove separately verifies the SLE {Number(t.cashPayment.matmoveFee||0).toFixed(2)} fee reserve refund.</p><p className="mt-1 text-xs">Driver return: {t.cashPayment.driverReturnConfirmed?'Confirmed':'Waiting'} · Your receipt: {t.cashPayment.riderReturnConfirmed?'Confirmed':'Waiting'}</p>{!t.cashPayment.riderReturnConfirmed&&<button type="button" disabled={!!cancellingId} onClick={()=>void confirmReturnedCash(t)} className="mt-2 min-h-10 rounded-lg bg-amber-700 px-3 text-xs font-bold text-white disabled:opacity-50">Confirm I received the physical cash back</button>}</div>}
          </article>)}
        </section>
      </>}
    </> : <>
      <section aria-label="Trip history" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Completed & cancelled trips</h2><p className="text-sm text-slate-600">Closed trips only. Current requests are kept in the Active tab.</p></div><span className="text-xs text-slate-500">{historyTrips.length} records</span></div>
        <div className="grid gap-3 rounded-2xl border bg-white p-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">Time period
            <select aria-label="Filter trips by time period" value={period} onChange={e=>setPeriod(e.target.value as '30'|'90'|'all')} className="mt-1 min-h-11 w-full rounded-xl border p-3"><option value="30">Recent — last 30 days</option><option value="90">Last 90 days</option><option value="all">All history</option></select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Status
            <select aria-label="Filter trips by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)} className="mt-1 min-h-11 w-full rounded-xl border p-3"><option value="all">Completed and cancelled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
          </label>
        </div>
        {loading?<SkeletonList count={3}/>:historyTrips.length===0?<p className="rounded-xl border bg-white p-6 text-center text-sm text-slate-600">No completed or cancelled trips match these filters.</p>:historyTrips.map(t=><article key={`history-${t.id}`} className="rounded-2xl border bg-white p-4 shadow-sm"><button type="button" onClick={()=>{setNotice('');setSelectedId(t.id);}} className="w-full text-left"><div className="flex justify-between gap-3"><strong className="capitalize">{t.service_type||'Ride'}</strong><span className="capitalize">{t.status}</span></div><p className="mt-2 text-sm text-slate-500">{date(t.created_at)}</p><p className="mt-2">{t.pickup_location} → {t.destination_location}</p><p className="mt-2 font-bold">SLE {Number(t.fare_amount||0).toFixed(2)}</p><p className="mt-2 text-sm text-blue-700">View full trip details</p></button><button className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={()=>void share(t)}>Share PDF receipt</button></article>)}
      </section>
    </>}
    {!selectedId && notice && <p role="status" className="rounded-xl bg-emerald-50 p-3">{notice}</p>}
    {loading ? <SkeletonList count={4} /> : !ownedTrips.length && !error ? <p className="rounded-2xl border bg-white py-10 text-center text-slate-500">No trips or deliveries yet.</p> : null}
    {!loading&&ownedTrips.length>0&&filteredTrips.length===0&&<p className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-600">No trips match these filters. Try a wider time period or another status.</p>}
    {filteredTrips.map(t => <article key={t.id} className="rounded-2xl border bg-white p-4 shadow-sm">
      <button onClick={() => { setNotice(''); setSelectedId(t.id); }} className="w-full text-left">
        <div className="flex justify-between gap-3"><strong className="capitalize">{t.service_type || 'Ride'}</strong><span>{t.status}</span></div>
        <p className="mt-2 text-sm text-slate-500">{date(t.created_at)}</p>
        <p className="mt-2 truncate">{t.pickup_location} → {t.destination_location}</p>
        <p className="mt-2 font-bold">SLE {Number(t.fare_amount || 0).toFixed(2)}</p>
        {role === 'driver' && <p className="mt-1 text-sm text-emerald-700">Expected driver share: SLE {(Number(t.fare_amount || 0) * 0.85).toFixed(2)}</p>}
        <p className="mt-2 text-sm text-blue-700">View full trip details</p>
      </button>
      <button className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={() => void share(t)}>Share PDF receipt</button>
    </article>)}
    <dialog ref={dialog} onClose={() => { setSelectedId(null); setNotice(''); }} className="max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl p-6 backdrop:bg-slate-950/60">
      {selected && <><div className="flex justify-between gap-3"><h2 className="text-xl font-bold">Trip details</h2><button autoFocus onClick={() => dialog.current?.close()} className="rounded-lg border px-3 py-2">Close</button></div>
        <dl className="my-4 space-y-3">{fields.map(([label, value]) => <div key={label} className="border-b pb-2"><dt className="text-sm text-slate-500">{label}</dt><dd className="break-words font-medium">{value || 'Not recorded'}</dd></div>)}</dl>
        {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          {['accepted','in_progress'].includes(selected.status)&&<button type="button" onClick={()=>{dialog.current?.close();onOpenHome?.();}} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Resume live trip</button>}
          {role==='driver'&&!selected.driver_id&&['pending','pending_admin'].includes(selected.status)&&<button type="button" disabled={!driverOnline||!!acceptingId} onClick={()=>void acceptAvailableRequest(selected)} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50">{!driverOnline?'Go online to accept':acceptingId===selected.id?'Accepting…':'Accept request'}</button>}
          {selected.cashPayment?.adminReturnRequested&&!selected.cashPayment?.[role==='driver'?'driverReturnConfirmed':'riderReturnConfirmed']&&<button type="button" disabled={!!cancellingId} onClick={()=>void confirmReturnedCash(selected)} className="min-h-11 rounded-xl bg-amber-700 px-4 py-3 font-bold text-white disabled:opacity-50">{role==='driver'?'Confirm physical cash returned':'Confirm physical cash received back'}</button>}
          <button onClick={() => void share(selected)} className="min-h-11 rounded-xl border px-4 py-3 font-bold">Share PDF receipt</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Your trip remains linked to your account. Physical cash return confirmation is separate from the provider-verified MatMove fee refund.</p>
      </>}
    </dialog>
  </section>;
}
