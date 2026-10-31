
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { FareSnapshot } from '@/services/fareNegotiationService';

// A booking poll may have started before a customer confirmed a newer fare.
// Keep that fare while still accepting fresh trip status/driver details.
export function mergeRideRow(previous: any, incoming: any) {
  if (!incoming || previous?.id !== incoming.id) return incoming;
  const oldVersion = Number(previous.matmove_fare_version || 1);
  const newVersion = Number(incoming.matmove_fare_version || 1);
  return newVersion < oldVersion
    ? { ...incoming, fare_amount: previous.fare_amount, matmove_fare_version: oldVersion }
    : incoming;
}

export function applyRideFare(previous: any, snapshot: FareSnapshot, userId: string) {
  if (!previous || snapshot.viewerId !== userId || snapshot.bookingId !== previous.id ||
      snapshot.fareVersion < Number(previous.matmove_fare_version || 1)) return previous;
  return { ...previous, fare_amount: (snapshot.fareMinor / 100).toFixed(2), matmove_fare_version: snapshot.fareVersion };
}

// Preflight is read-only. The payment API and database remain authoritative.
// If the price changed since the click, require the driver to review and click again.
export function assertDriverFare(snapshot: FareSnapshot, booking: any, userId: string) {
  if (snapshot.viewerId !== userId || snapshot.bookingId !== booking.id) throw new Error('Your account changed. Reopen this request.');
  if (snapshot.selectedDriverId && snapshot.selectedDriverId !== userId) throw new Error('The customer has chosen another driver.');
  if (!['pending', 'pending_admin'].includes(snapshot.bookingStatus)) throw new Error('This request changed. Refresh the radar before continuing.');
  if (snapshot.fareVersion !== Number(booking.matmove_fare_version || 1) || snapshot.fareMinor !== Math.round(Number(booking.fare_amount) * 100)) {
    throw new Error('The fare changed. Review the updated price, then accept again.');
  }
  if (snapshot.offers.some(offer => offer.driverId === userId && offer.status === 'pending' &&
      offer.fareVersion === snapshot.fareVersion && Date.parse(offer.expiresAt) > Date.parse(snapshot.serverTime))) {
    throw new Error('Wait for the customer to agree, or withdraw your proposal before accepting the current fare.');
  }
}

export function useCustomerActiveRide(userId: string) {
  const [state, setState] = useState<{ userId: string; booking: any; loading: boolean; error: string }>({ userId, booking: null, loading: true, error: '' });
  const [retryCount, setRetryCount] = useState(0);
  const [bookings,setBookings]=useState<any[]>([]);
  const [creating,setCreating]=useState(false);
  const selection=useRef('');
  const identity = useRef(userId);
  identity.current = userId;
  const mutation = useRef(0);
  const seenFares = useRef<Record<string, number>>({});
  const terminal = useRef<Record<string, string>>({});
  const setBooking = useCallback((booking: any) => {
    if (identity.current !== userId) return;
    mutation.current++;setCreating(false);
    if(booking?.id&&['completed','cancelled'].includes(booking.status)) {terminal.current[`${userId}:${booking.id}`]=booking.status;booking=null;}
    selection.current=booking?.id||'';
    setBookings(old=>booking?[booking,...old.filter(row=>row.id!==booking.id)]:old.filter(row=>!terminal.current[`${userId}:${row.id}`]));
    setState(previous => ({ userId, booking: mergeRideRow(previous.userId === userId ? previous.booking : null, booking), loading: false, error: '' }));
  }, [userId]);
  const applySnapshot = useCallback((snapshot: FareSnapshot) => {
    if (identity.current !== userId || snapshot.viewerId !== userId) return;
    // Invalidate a pre-agreement read once, not every unchanged polling response.
    if (snapshot.fareVersion > (seenFares.current[snapshot.bookingId] || 0)) {
      seenFares.current[snapshot.bookingId] = snapshot.fareVersion;
      mutation.current++;
    }
    setBookings(previous=>previous.map(row=>applyRideFare(row,snapshot,userId)));
    setState(previous => previous.userId !== userId ? previous : { ...previous, booking: applyRideFare(previous.booking, snapshot, userId) });
  }, [userId]);

  useEffect(() => {
    let disposed = false, busy = false, queued = false;
    if(identity.current!==state.userId){setBookings([]);setCreating(false);selection.current='';}
    setState(previous => ({ userId, booking: previous.userId === userId ? previous.booking : null, loading: true, error: '' }));
    const refresh = async () => {
      if (disposed || !userId) return;
      if (busy) { queued = true; return; }
      busy = true;
      const version = mutation.current;
      try {
        const { data: rows, error } = await supabase.from('bookings')
          .select('*, driver:driver_id(full_name, phone)')
          .eq('rider_id', userId).in('status', ['pending', 'pending_admin', 'accepted', 'in_progress'])
          .order('created_at', { ascending: false }).limit(101);
        if (error) throw error;
        if(!Array.isArray(rows)||rows.length>100||rows.some(row=>typeof row?.id!=='string'||row.rider_id!==userId||!['pending','pending_admin','accepted','in_progress'].includes(row.status))||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Active requests could not be verified.');
        const owned=rows.filter(row=>!terminal.current[`${userId}:${row.id}`]);
        const data=owned.find(row=>row.id===selection.current)||owned[0]||null;
        if (!disposed && identity.current === userId && version === mutation.current) {
          setBookings(previous=>owned.map(row=>mergeRideRow(previous.find(old=>old.id===row.id),row)));
          setState(previous => ({ userId, booking: mergeRideRow(previous.userId === userId ? previous.booking : null, data&&terminal.current[`${userId}:${data.id}`]?null:data || null), loading: false, error: '' }));
        }
      } catch {
        if (!disposed && identity.current === userId && version === mutation.current) {
          setState(previous => ({ userId, booking: previous.userId === userId ? previous.booking : null, loading: false, error: 'Could not check your active trip. Retry before making another request.' }));
        }
      } finally {
        busy = false;
        if (!disposed && queued) { queued = false; void refresh(); }
      }
    };
    void refresh();
    const channel = supabase.channel(`customer-active-${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'bookings', filter: `rider_id=eq.${userId}`
    }, () => { void refresh(); }).subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [userId, retryCount]);

  const retry = useCallback(() => setRetryCount(value => value + 1), []);
  const current = state.userId === userId ? state : { userId, booking: null, loading: true, error: '' };
  const selectBooking=(id:string)=>{const row=bookings.find(item=>item.id===id&&item.rider_id===userId);if(!row||identity.current!==userId)return;selection.current=id;mutation.current++;setCreating(false);setState({userId,booking:row,loading:false,error:''});};
  const canCreate=current.userId===userId&&!current.loading&&!current.error&&!bookings.some(row=>row.rider_id===userId&&['pending','pending_admin'].includes(row.status));
  const startNewBooking=()=>{if(!canCreate)return;mutation.current++;setCreating(true);};
  return { ...current, booking:creating?null:current.booking, bookings:bookings.filter(row=>row.rider_id===userId),creating,canCreate,selectBooking,startNewBooking,setBooking,applySnapshot,retry };
}
