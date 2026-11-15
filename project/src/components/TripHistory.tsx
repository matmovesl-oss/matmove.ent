
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { shareReceiptPdf } from '@/lib/pdfReceipt';
import { SkeletonList } from '@/components/Skeleton';
import { filterTripHistory } from '@/lib/tripHistory';
import { updateRide, readCashRideStatus } from '@/services/rideService';
import { attachTripContacts } from '@/lib/tripContacts';

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
export default function TripHistory({ userId, role }: Props) {
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [period,setPeriod]=useState<'30'|'90'|'all'>('all');
  const [tripView,setTripView]=useState<'active'|'pending'|'history'>('active');
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
      const result = await supabase.from('bookings').select('*, driver:driver_id(full_name), rider:rider_id(full_name)')
        .eq(role === 'driver' ? 'driver_id' : 'rider_id', id).order('created_at', { ascending: false }).abortSignal(controller.signal);
      if(result.error)throw Error('Trip history could not be loaded. Retry; no records have been deleted.');
      if(!Array.isArray(result.data)||result.data.some(t=>t[role==='driver'?'driver_id':'rider_id']!==id))throw Error('Trip ownership could not be verified.');
      const withContacts=await attachTripContacts(result.data);
      const unfinished=withContacts.filter(t=>['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'].includes(t.status));
      const cashStatuses=new Map<string,any>(),cashReturns=new Map<string,any>();
      await Promise.all(unfinished.filter(t=>t.payment_method==='cash').map(async t=>{
        const [status,returnData]=await Promise.all([
          readCashRideStatus(t.id).catch(()=>null),
          supabase.rpc('matmove_cash_ride_return_status',{p_booking_id:t.id}).then(result=>result.error?null:result.data).catch(()=>null)
        ]);
        if(status?.booking?.id===t.id&&status?.payment)cashStatuses.set(t.id,status.payment);
        if(returnData?.bookingId===t.id)cashReturns.set(t.id,returnData);
      }));
      const enriched=withContacts.map(t=>({...t,cashPayment:cashStatuses.get(t.id)||t.cashPayment||null,cashReturn:cashReturns.get(t.id)||t.cashReturn||null}));
      const after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(live()){setTrips(enriched);setLoadedOwner(id);setError('');}
    }catch(e){if(live()){setTrips([]);setError(e instanceof Error?e.message:'Trip history unavailable.');}}
    finally{clearTimeout(timeout);if(live()){inFlight.current=false;setLoading(false);}}
  }, [userId, role]);
  useEffect(() => {
    mounted.current=true;revision.current++;inFlight.current=false;setTrips([]);setLoadedOwner(userId);setSelectedId(null);setLoading(true);setError('');
    void refresh();
    // Supabase Realtime provides prompt trip-status updates. The polling fallback
    // remains enabled in case Realtime is unavailable or the table is not published.
    const ownerColumn = role === 'driver' ? 'driver_id' : 'rider_id';
    const channel = supabase.channel(`trip-history:${role}:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `${ownerColumn}=eq.${userId}`,
      }, () => {
        if (document.visibilityState !== 'hidden') void refresh();
      })
      .subscribe();
    const onResume=()=>{if(document.visibilityState!=='hidden')void refresh();};
    const timer = window.setInterval(() => { if(document.visibilityState!=='hidden')void refresh(); }, 15000);
    document.addEventListener('visibilitychange',onResume);
    window.addEventListener('focus',onResume);
    window.addEventListener('pageshow',onResume);
    window.addEventListener('online',onResume);
    return () => {
      mounted.current=false;revision.current++;inFlight.current=false;abort.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onResume);
      window.removeEventListener('focus',onResume);
      window.removeEventListener('pageshow',onResume);
      window.removeEventListener('online',onResume);
      void supabase.removeChannel(channel);
    };
  }, [refresh,userId,role]);
  const ownedTrips=loadedOwner===userId?trips:[];
  const selected = ownedTrips.find(t => t.id === selectedId);
  const filteredTrips=filterTripHistory(ownedTrips,period,statusFilter).filter(t=>tripView==='active'?['accepted','in_progress'].includes(t.status):tripView==='pending'?['pending','pending_admin','cash_reserve_pending','cash_review_required'].includes(t.status):['completed','cancelled'].includes(t.status));
  const activeRequests = ownedTrips.filter(t => ['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'].includes(t.status));
  const [cancellingId,setCancellingId]=useState<string|null>(null);
  const [actionError,setActionError]=useState('');
  const [actionNotice,setActionNotice]=useState('');
  async function confirmCashReturn(t:any){
    if(!t?.id||!t.cashReturn||!['requested','driver_confirmed','rider_confirmed'].includes(t.cashReturn.returnStatus))return;
    setCancellingId(t.id);setActionError('');setActionNotice('');
    try{
      const {data,error}=await supabase.rpc('matmove_cash_ride_confirm_return',{p_booking_id:t.id});
      if(error)throw error;
      if(data?.bookingId!==t.id||!['driver_confirmed','rider_confirmed','both_confirmed'].includes(data?.returnStatus))throw new Error('Cash return confirmation was not recorded.');
      await refresh();
      setActionNotice(data.returnStatus==='both_confirmed'?'Both parties have confirmed the physical cash return. Admin can now process the fee-reserve refund and cancellation.':'Your physical cash return confirmation has been recorded. The other party must also confirm.');
    }catch(error:any){setActionError(error?.message||'Cash return confirmation could not be recorded.');}
    finally{setCancellingId(null);}
  }
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
    ['Customer', selected.rider?.full_name], ['Customer phone',selected.rider?.phone||selected.rider?.phone_number], ['Driver', selected.driver?.full_name], ['Driver phone',selected.driver?.phone||selected.driver?.phone_number],
    ['Pickup area', selected.pickup_location], ['Destination area', selected.destination_location],
    ['Requested', date(selected.created_at)], ['Scheduled', selected.scheduled_time?date(selected.scheduled_time):selected.service_type==='scheduled'?'Not recorded':'Not scheduled'],
    ['Accepted', date(selected.accepted_at)], ['Started', date(selected.started_at)],
    ['Completed', date(selected.completed_at)], ['Vehicle', selected.vehicle_type],
    ['Fare', `SLE ${Number(selected.fare_amount || 0).toFixed(2)}`], ['Payment method',selected.payment_method], ['Cash handover status',selected.cashPayment?.status], ['Physical cash return',selected.cashReturn?.returnStatus], ['Driver cash confirmed',selected.cashPayment?.driverCashConfirmed?'Yes':'No'], ['Customer cash confirmed',selected.cashPayment?.riderCashConfirmed?'Yes':'No'],
    ...(role === 'driver' ? [['Expected driver share (85%)', `SLE ${(Number(selected.fare_amount || 0) * 0.85).toFixed(2)}`]] : []),
    ...(selected.distance_km != null ? [['Distance', `${selected.distance_km} km`]] : []),
    ...(selected.payment_status ? [['Payment status', selected.payment_status]] : []),
  ] : [];
  return <section className="mx-auto max-w-4xl space-y-4 p-4 pb-24 sm:p-6">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Trips & Deliveries</h1><p className="mt-1 text-sm text-slate-500">Your unfinished rides stay here until the server confirms completion or cancellation. You can reopen the same request after signing back in.</p></div>
        <button className="min-h-11 rounded-xl border bg-white px-4 py-2 font-semibold" onClick={() => void refresh()}>Refresh</button>
      </div>
      <div role="tablist" aria-label="Trips categories" className="grid grid-cols-3 gap-2 rounded-2xl border bg-white p-2">
        {([{id:'active',label:'Live / Active',count:ownedTrips.filter(t=>['accepted','in_progress'].includes(t.status)).length},{id:'pending',label:'Pending',count:ownedTrips.filter(t=>['pending','pending_admin','cash_reserve_pending','cash_review_required'].includes(t.status)).length},{id:'history',label:'History',count:ownedTrips.filter(t=>['completed','cancelled'].includes(t.status)).length}] as const).map(tab=><button key={tab.id} type="button" role="tab" aria-selected={tripView===tab.id} onClick={()=>setTripView(tab.id)} className={`min-h-12 rounded-xl px-2 text-sm font-bold ${tripView===tab.id?'bg-indigo-600 text-white':'text-slate-700 hover:bg-slate-50'}`}>{tab.label}<span className="ml-1 opacity-80">({tab.count})</span></button>)}
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
        <p className="text-xs text-slate-500 sm:col-span-2">Showing {filteredTrips.length} {tripView==='active'?'live or accepted':tripView==='pending'?'pending':'historical'} trips. Unfinished requests are never hidden by the history date filter.</p>
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {actionError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{actionError}</p>}
    {actionNotice&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-900">{actionNotice}</p>}
    <section aria-label="Unfinished requests" className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
      <div><h2 className="text-lg font-bold">Unfinished requests</h2><p className="text-sm text-slate-600">Requests still awaiting a driver, confirmation, completion or payment verification.</p></div>
      {loading?<p className="text-sm text-slate-500">Checking unfinished requests…</p>:activeRequests.length===0?<p className="rounded-xl bg-white p-4 text-sm text-slate-600">You have no unfinished requests.</p>:activeRequests.map(t=><article key={`active-${t.id}`} className="rounded-xl border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="capitalize">{t.service_type||'Ride'} request</strong><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{t.status.replace(/_/g,' ')}</span></div>
        <p className="mt-2 text-sm">{t.pickup_location||'Pickup not recorded'} → {t.destination_location||'Destination not recorded'}</p>
        <p className="mt-1 text-xs text-slate-500">Reference: {t.id}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedId(t.id)} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">Open request details</button>
        {t.cashReturn&&['requested','driver_confirmed','rider_confirmed'].includes(t.cashReturn.returnStatus)&&<button type="button" disabled={!!cancellingId||((role==='driver'&&t.cashReturn.driverConfirmed)||(role!=='driver'&&t.cashReturn.riderConfirmed))} onClick={()=>void confirmCashReturn(t)} className="min-h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">{cancellingId===t.id?'Recording…':role==='driver'?(t.cashReturn.driverConfirmed?'You confirmed return':'Confirm cash returned to customer'):(t.cashReturn.riderConfirmed?'You confirmed receipt':'Confirm cash returned to you')}</button>}
        {['pending','pending_admin','cash_reserve_pending'].includes(t.status)&&<button type="button" disabled={!!cancellingId} onClick={()=>void cancelRequest(t)} className="min-h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50">{cancellingId===t.id?'Cancelling…':'Cancel request'}</button>}
        </div>
        {t.cashReturn&&t.cashReturn.returnStatus!=='not_requested'&&<p className="mt-2 text-xs text-emerald-800">Physical cash return: {t.cashReturn.returnStatus.replace(/_/g,' ')} · Driver confirmed: {t.cashReturn.driverConfirmed?'Yes':'No'} · Customer confirmed: {t.cashReturn.riderConfirmed?'Yes':'No'}</p>}
        {['accepted','in_progress','cash_review_required'].includes(t.status)&&<p className="mt-2 text-xs text-slate-600">This request has progressed beyond the self-cancellation stage. Contact MatMove support or ask Admin to review it; any cancellation must pass the refund checks.</p>}
      </article>)}
    </section>
    {!selectedId && notice && <p role="status" className="rounded-xl bg-emerald-50 p-3">{notice}</p>}
    {loading ? <SkeletonList count={4} /> : !ownedTrips.length && !error ? <p className="rounded-2xl border bg-white py-10 text-center text-slate-500">No trips or deliveries yet.</p> : null}
    {!loading&&filteredTrips.length===0&&<p className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-600">{tripView==='active'?'No accepted or in-progress trips.':tripView==='pending'?'No pending requests assigned to this account.':'No completed or cancelled trips match this history filter.'}</p>}
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
        <button onClick={() => void share(selected)} className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white">Share PDF receipt</button>
        <p className="mt-3 text-xs text-slate-500">Sharing includes your trip areas, fare and times. Only recorded times are shown.</p>
      </>}
    </dialog>
  </section>;
}
