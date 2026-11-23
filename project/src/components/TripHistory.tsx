
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { shareReceiptPdf } from '@/lib/pdfReceipt';
import { SkeletonList } from '@/components/Skeleton';
import { filterTripHistory } from '@/lib/tripHistory';
import { updateRide, readCashRideStatus } from '@/services/rideService';
import { attachTripContacts } from '@/lib/tripContacts';

type Props = { userId: string; role: 'rider' | 'driver' | 'merchant'; onResume?: (bookingId: string) => void; accountLabel?: string; accountEmail?: string };
const date = (value: unknown) => {
  if (!value) return 'Not recorded';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString();
};
const cashReturnLabel = (status: unknown) => {
  const labels: Record<string, string> = { not_requested: 'Not requested', requested: 'Awaiting confirmation', driver_confirmed: 'Driver confirmed', rider_confirmed: 'Customer confirmed', both_confirmed: 'Both parties confirmed', refunded: 'Refunded' };
  const value = String(status || '');
  return labels[value] || (value ? value.replace(/_/g, ' ') : 'Not recorded');
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
    ...(t.vehicle_type ? [`Requested vehicle: ${t.vehicle_type}`] : []),
    ...(t.matmove_confirmed_vehicle_type ? [`Vehicle at acceptance: ${t.matmove_confirmed_vehicle_type}`] : [`Vehicle at acceptance: Not recorded`]),
    ...(t.driver?.vehicle_type ? [`Driver's registered vehicle: ${t.driver.vehicle_type}`] : []),
    ...(t.cashReturn?.returnStatus ? [`Physical cash return: ${cashReturnLabel(t.cashReturn.returnStatus)}`] : []),
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
    { label: 'Requested vehicle', value: t.vehicle_type || 'Not recorded' },
    { label: 'Vehicle at acceptance', value: t.matmove_confirmed_vehicle_type || 'Not recorded at acceptance' },
    { label: "Driver's registered vehicle", value: t.driver?.vehicle_type || 'Not available' },
    { label: 'Physical cash return', value: cashReturnLabel(t.cashReturn?.returnStatus) },
    { label: 'Fare', value: `SLE ${Number(t.fare_amount || 0).toFixed(2)}` },
    ...(role === 'driver' ? [{
      label: t.paymentInfo?.adminSettlement ? 'Admin dispute driver award (5%)' : 'Expected driver share (85%)',
      value: t.paymentInfo?.adminSettlement
        ? `SLE ${(Number(t.paymentInfo.adminSettlement.driverAwardMinor || 0) / 100).toFixed(2)}`
        : `SLE ${(Number(t.fare_amount || 0) * 0.85).toFixed(2)}`
    }] : []),
    ...(t.paymentInfo?.adminSettlement ? [
      { label: 'Admin dispute settlement status', value: t.paymentInfo.adminSettlement.status },
      { label: 'Customer refund (50%)', value: `SLE ${(Number(t.paymentInfo.adminSettlement.customerRefundMinor || 0) / 100).toFixed(2)}` },
      { label: 'Driver award (5%)', value: `SLE ${(Number(t.paymentInfo.adminSettlement.driverAwardMinor || 0) / 100).toFixed(2)}` },
      { label: 'MatMove platform share (45%)', value: `SLE ${(Number(t.paymentInfo.adminSettlement.platformShareMinor || 0) / 100).toFixed(2)} · ${t.paymentInfo.adminSettlement.platformMode === 'retained' ? 'retained in escrow' : 'transferred to fee account'}` },
    ] : []),
    ...(t.paymentInfo?.status ? [{ label: t.paymentInfo.method === 'cash' ? 'Cash ledger status' : 'Escrow status', value: t.paymentInfo.status }] : []),
    ...(t.paymentInfo?.driverPayoutStatus ? [{ label: 'Driver payout status', value: t.paymentInfo.driverPayoutStatus }] : []),
    ...(t.paymentIssue ? [{ label: 'Admin review', value: t.paymentIssue.reasonCode === 'admin_unpaid_payment_review' ? 'Unpaid payment review' : t.paymentIssue.reasonCode === 'admin_unpaid_cash_fare_review' ? 'Unpaid cash fare review' : 'Investigation open' }] : []),
  ];
}
export default function TripHistory({ userId, role, onResume, accountLabel, accountEmail }: Props) {
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [period,setPeriod]=useState<'30'|'90'|'all'>('all');
  const [tripView,setTripView]=useState<'active'|'pending'|'history'>(role==='driver'?'active':'pending');
  const [statusFilter,setStatusFilter]=useState<'all'|'pending'|'pending_admin'|'cash_reserve_pending'|'cash_review_required'|'accepted'|'in_progress'|'completed'|'cancelled'>('all');
  const dialog = useRef<HTMLDialogElement>(null);
  const owner=useRef(userId);owner.current=userId;
  const mounted=useRef(false),inFlight=useRef(false),queuedRefresh=useRef(false),revision=useRef(0),abort=useRef<AbortController|null>(null);
  const [loadedOwner,setLoadedOwner]=useState(userId);
  const refresh = useCallback(async () => {
    if(inFlight.current){queuedRefresh.current=true;return;}inFlight.current=true;const n=++revision.current,id=userId;
    const controller=new AbortController();abort.current=controller;const timeout=setTimeout(()=>controller.abort(),15000);
    const live=()=>mounted.current&&owner.current===id&&revision.current===n;
    try{
      const before=await supabase.auth.getSession();if(before.error||before.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(!live())return;
      const result = await supabase.from('bookings').select('*')
        .eq(role === 'driver' ? 'driver_id' : 'rider_id', id).order('created_at', { ascending: false }).abortSignal(controller.signal);
      if(result.error)throw Error('Trip history could not be loaded. Retry; no records have been deleted.');
      if(!Array.isArray(result.data)||result.data.some(t=>t[role==='driver'?'driver_id':'rider_id']!==id))throw Error('Trip ownership could not be verified.');
      const withContacts=await attachTripContacts(result.data);
      const unfinished=withContacts.filter(t=>['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'].includes(t.status));
      const cashStatuses=new Map<string,any>(),cashReturns=new Map<string,any>();
      await Promise.all(unfinished.filter(t=>t.payment_method==='cash').map(async t=>{
        const [status,returnData]=await Promise.all([
          readCashRideStatus(t.id).catch(()=>null),
          Promise.resolve(supabase.rpc('matmove_cash_ride_return_status',{p_booking_id:t.id})).then(result=>result.error?null:result.data).catch(()=>null)
        ]);
        if(status?.booking?.id===t.id&&status?.payment)cashStatuses.set(t.id,status.payment);
        if(returnData?.bookingId===t.id)cashReturns.set(t.id,returnData);
      }));
      const enriched=withContacts.map(t=>({...t,cashPayment:cashStatuses.get(t.id)||t.cashPayment||null,cashReturn:cashReturns.get(t.id)||t.cashReturn||null}));
      const after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==id)throw Error('Your sign-in changed. Reopen Trips.');
      if(live()){setTrips(enriched);setLoadedOwner(id);setError('');}
    }catch(e){if(live()){setError(e instanceof Error?e.message:'Trip history could not be refreshed. Showing the last successfully loaded records if available.');}}
    finally{clearTimeout(timeout);if(live()){inFlight.current=false;setLoading(false);if(queuedRefresh.current){queuedRefresh.current=false;queueMicrotask(()=>void refresh());}}}
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
    ['Completed', date(selected.completed_at)], ['Requested vehicle', selected.vehicle_type], ['Vehicle at acceptance', selected.matmove_confirmed_vehicle_type || 'Not recorded at acceptance'], ["Driver's registered vehicle", selected.driver?.vehicle_type || 'Not available'],
    ['Fare', `SLE ${Number(selected.fare_amount || 0).toFixed(2)}`], ['Payment method',selected.payment_method], ['Cash handover status',selected.cashPayment?.status], ['Physical cash return',cashReturnLabel(selected.cashReturn?.returnStatus)], ['Driver cash confirmed',selected.cashPayment?.driverCashConfirmed?'Yes':'No'], ['Customer cash confirmed',selected.cashPayment?.riderCashConfirmed?'Yes':'No'],
    ...(role === 'driver' ? [[selected.paymentInfo?.adminSettlement ? 'Admin dispute driver award (5%)' : 'Expected driver share (85%)', selected.paymentInfo?.adminSettlement ? `SLE ${(Number(selected.paymentInfo.adminSettlement.driverAwardMinor || 0) / 100).toFixed(2)}` : `SLE ${(Number(selected.fare_amount || 0) * 0.85).toFixed(2)}`]] : []),
    ...(selected.paymentInfo?.adminSettlement ? [
      ['Admin dispute settlement status',selected.paymentInfo.adminSettlement.status],
      ['Customer refund (50%)',`SLE ${(Number(selected.paymentInfo.adminSettlement.customerRefundMinor || 0)/100).toFixed(2)}`],
      ['Driver award (5%)',`SLE ${(Number(selected.paymentInfo.adminSettlement.driverAwardMinor || 0)/100).toFixed(2)}`],
      ['MatMove platform share (45%)',`SLE ${(Number(selected.paymentInfo.adminSettlement.platformShareMinor || 0)/100).toFixed(2)} · ${selected.paymentInfo.adminSettlement.platformMode==='retained'?'retained in escrow':'transferred to fee account'}`],
    ] : []),
    ...(selected.distance_km != null ? [['Distance', `${selected.distance_km} km`]] : []),
    ...(selected.paymentInfo?.status ? [[selected.paymentInfo.method==='cash'?'Cash ledger status':'Escrow status',selected.paymentInfo.status]] : []),
    ...(selected.paymentInfo?.driverPayoutStatus ? [['Driver payout status',selected.paymentInfo.driverPayoutStatus]] : []),
    ...(selected.paymentInfo?.driverCashConfirmed!=null ? [['Driver confirmed cash',selected.paymentInfo.driverCashConfirmed?'Yes':'No']] : []),
    ...(selected.paymentInfo?.customerCashConfirmed!=null ? [['Customer confirmed cash',selected.paymentInfo.customerCashConfirmed?'Yes':'No']] : []),
    ...(selected.paymentInfo?.cashReturnStatus ? [['Physical cash return',selected.paymentInfo.cashReturnStatus]] : []),
    ...(selected.paymentIssue ? [['Admin review',selected.paymentIssue.reasonCode==='admin_unpaid_payment_review'?'Unpaid payment review':'Investigation open']] : []),
  ] : [];
  const paymentConfirmed = (t:any) => {
    const info=t.paymentInfo||{};
    if(info.status!=='settled') return false;
    if(t.payment_method==='cash' || info.method==='cash') {
      const driverConfirmed=Boolean(t.cashPayment?.driverCashConfirmed ?? info.driverCashConfirmed);
      const customerConfirmed=Boolean(t.cashPayment?.riderCashConfirmed ?? info.customerCashConfirmed ?? info.riderCashConfirmed);
      return driverConfirmed && customerConfirmed;
    }
    return t.status==='completed';
  };
  const methodLabel=(t:any)=>t.payment_method==='cash'||t.paymentInfo?.method==='cash'?'Cash':t.payment_method==='wallet'||t.paymentInfo?.method==='wallet'?'MatMove Wallet':'Digital payment';
  return <section className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4 pb-24 sm:px-5 sm:py-6">
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Trips</h1><p className="mt-1 text-sm text-slate-500">Your requests, active trips and confirmed receipts in one place.</p></div>
      <button type="button" aria-label="Refresh trips" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700" onClick={()=>void refresh()}><span aria-hidden="true">↻</span><span className="hidden sm:inline">Refresh</span></button>
    </header>
    <div role="tablist" aria-label="Trips" className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {([{id:'active',label:'Active',count:ownedTrips.filter(t=>['accepted','in_progress'].includes(t.status)).length},{id:'pending',label:'Requests',count:ownedTrips.filter(t=>['pending','pending_admin','cash_reserve_pending','cash_review_required'].includes(t.status)).length},{id:'history',label:'History',count:ownedTrips.filter(t=>['completed','cancelled'].includes(t.status)).length}] as const).map(tab=><button key={tab.id} type="button" role="tab" aria-selected={tripView===tab.id} onClick={()=>setTripView(tab.id)} className={`min-h-11 rounded-lg px-2 text-sm font-bold ${tripView===tab.id?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-50'}`}>{tab.label}<span className="ml-1 text-xs opacity-75">{tab.count}</span></button>)}
    </div>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {actionError&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
    {actionNotice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{actionNotice}</p>}
    {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading?<SkeletonList count={3}/>:filteredTrips.length===0?<div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center"><p className="font-semibold text-slate-800">{tripView==='active'?'No active trips':tripView==='pending'?'No pending requests':'No trip history yet'}</p><p className="mt-1 text-sm text-slate-500">{tripView==='history'?'Completed and cancelled trips will appear here.':'Your trip updates will appear here automatically.'}</p></div>:<div className="space-y-2">
      {filteredTrips.map(t=>{
        const paid=paymentConfirmed(t);
        const live=['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'].includes(t.status);
        const statusLabel=t.status==='pending'&&Array.isArray(t.matmove_excluded_driver_ids)&&t.matmove_excluded_driver_ids.length>0?'Finding another driver':t.status==='cash_review_required'?'Payment review':String(t.status||'requested').replace(/_/g,' ');
        return <article key={t.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm font-extrabold capitalize text-slate-900">{t.service_type||'Ride'}</strong><span className={`rounded-full px-2 py-1 text-[11px] font-bold capitalize ${paid?'bg-emerald-50 text-emerald-800':live?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-600'}`}>{paid?'Payment confirmed':statusLabel}</span></div>
              <p className="mt-2 truncate text-sm font-semibold text-slate-800">{t.pickup_location||'Pickup not recorded'}</p><p className="text-xs text-slate-500">to {t.destination_location||'Destination not recorded'}</p>
              <p className="mt-1 text-[11px] text-slate-400">{date(t.completed_at||t.created_at)}</p>
            </div>
            <div className="shrink-0 text-right"><p className="text-base font-extrabold tabular-nums text-slate-900">SLE {Number(t.fare_amount||0).toFixed(2)}</p><p className="mt-1 text-[11px] text-slate-500">{methodLabel(t)}</p></div>
          </div>
          {paid&&<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><span aria-hidden="true">✓</span> Confirmed by both parties</span><button type="button" onClick={()=>{setNotice('');setSelectedId(t.id);}} className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">View full receipt <span aria-hidden="true">→</span></button></div>}
          {!paid&&<div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={()=>{setNotice('');setSelectedId(t.id);}} className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">View request</button>
            {onResume&&(role!=='driver'||t.driver_id===userId)&&['pending','pending_admin','cash_reserve_pending','accepted','in_progress'].includes(t.status)&&<button type="button" onClick={()=>onResume(t.id)} className="min-h-11 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">{role==='driver'?(['accepted','in_progress'].includes(t.status)?'Continue trip':'Open request'):t.payment_method==='cash'&&t.status==='in_progress'?'Confirm cash handover':'Continue request'}</button>}
            {['pending','pending_admin','cash_reserve_pending'].includes(t.status)&&<button type="button" disabled={!!cancellingId} onClick={()=>void cancelRequest(t)} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">{cancellingId===t.id?'Cancelling…':'Cancel'}</button>}
            {t.status==='in_progress'&&t.cashReturn&&['requested','driver_confirmed','rider_confirmed'].includes(t.cashReturn.returnStatus)&&<button type="button" disabled={!!cancellingId||((role==='driver'&&t.cashReturn.driverConfirmed)||(role!=='driver'&&t.cashReturn.riderConfirmed))} onClick={()=>void confirmCashReturn(t)} className="min-h-11 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">{cancellingId===t.id?'Recording…':role==='driver'?(t.cashReturn.driverConfirmed?'Return confirmed':'Confirm cash returned'):(t.cashReturn.riderConfirmed?'Receipt confirmed':'Confirm cash returned')}</button>}
          </div>}
        </article>;
      })}
    </div>}
    <dialog ref={dialog} onClose={()=>{setSelectedId(null);setNotice('');}} className="m-auto max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border-0 p-4 shadow-2xl backdrop:bg-slate-950/60 sm:p-6">
      {selected&&<><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">{paymentConfirmed(selected)?'Trip receipt':'Request details'}</h2><p className="mt-1 text-xs text-slate-500">Reference {selected.id}</p></div><button type="button" autoFocus onClick={()=>dialog.current?.close()} className="inline-flex h-11 min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-slate-200 px-2 text-xs font-semibold leading-none">Close</button></div>
        {paymentConfirmed(selected)&&<div className="my-4 rounded-xl bg-emerald-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Payment confirmed</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">SLE {Number(selected.fare_amount||0).toFixed(2)}</p><p className="mt-1 text-xs text-emerald-800">{methodLabel(selected)} · Both parties confirmed</p></div>}
        <dl className="my-4 space-y-3">{fields.map(([label,value])=><div key={label} className="border-b border-slate-100 pb-2"><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words text-sm font-semibold text-slate-800">{value||'Not recorded'}</dd></div>)}</dl>
        {notice&&<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm">{notice}</p>}
        <button type="button" onClick={()=>void share(selected)} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Download / Share full receipt PDF</button>
        <p className="mt-3 text-xs text-slate-500">The receipt contains recorded trip, fare and payment information only.</p>
      </>}
    </dialog>
  </section>;
}
