import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { updateRide } from '@/services/rideService';
import { 
  Car, Clock, AlertTriangle, Users, Smartphone, ShieldCheck
} from 'lucide-react';
import ActiveTripMap from '@/components/ActiveTripMap';
import { RideLocationPicker } from '@/components/RideLocationPicker';

export function RiderDashboard({ profile, wallet }: any) {
  const [activeBooking, setActiveBooking] = useState<any>(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [vehicleType, setVehicleType] = useState<'car' | 'keke' | 'bike'>('car');
  const [passengerCount, setPassengerCount] = useState(1);
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
  const [offerAmount, setOfferAmount] = useState('30');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // 5-minute cancellation window tracking
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const fetchActiveRide = async () => {
    try {
      const { data } = await supabase
        .from('bookings')
        .select('*, driver:profiles!driver_id(full_name, phone)')
        .eq('rider_id', profile.id)
        .in('status', ['pending', 'accepted', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setActiveBooking(data);
    } finally {
      setLoadingTrip(false);
    }
  };

  useEffect(() => {
    fetchActiveRide();
    const interval = setInterval(fetchActiveRide, 4000);
    return () => clearInterval(interval);
  }, [profile.id]);

  useEffect(() => {
    let timer: any;
    if (activeBooking && activeBooking.status === 'accepted' && activeBooking.accepted_at) {
      const updateElapsed = () => {
        const acceptedTime = new Date(activeBooking.accepted_at).getTime();
        const diff = Math.floor((Date.now() - acceptedTime) / 1000);
        setElapsedSeconds(diff >= 0 ? diff : 0);
      };
      updateElapsed();
      timer = setInterval(updateElapsed, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [activeBooking]);

  const handleRequestRide = async () => {
    if (!pickup || !destination) {
      alert('Please set your pickup and drop-off points.');
      return;
    }
    const fare = Number(offerAmount);
    if ((wallet?.balance || 0) < fare) {
      alert(`Insufficient funds. Your wallet balance is SLE ${wallet?.balance || 0}`);
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          rider_id: profile.id,
          pickup_location: pickup,
          destination_location: destination,
          pickup_latitude: pickupCoords ? pickupCoords[1] : 8.484,
          pickup_longitude: pickupCoords ? pickupCoords[0] : -13.23,
          dropoff_latitude: destinationCoords ? destinationCoords[1] : 8.488,
          dropoff_longitude: destinationCoords ? destinationCoords[0] : -13.22,
          service_type: 'ride',
          vehicle_type: vehicleType,
          passengers_count: passengerCount,
          fare_amount: fare,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) {
      alert(err.message || 'Ride request failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelWithPenaltyCheck = async () => {
    if (!activeBooking || busy) return;

    const isAfterFiveMinutes = elapsedSeconds > 300;
    const penaltyAmount = Number(activeBooking.fare_amount) * 0.01;
    const driverShare = penaltyAmount * 0.5;
    const escrowShare = penaltyAmount * 0.5;

    if (isAfterFiveMinutes) {
      const confirmed = window.confirm(
        `It has been over 5 minutes since driver acceptance. Cancelling now incurs a 1% dispatch fee (SLE ${penaltyAmount.toFixed(2)}), split 50/50 between the driver (SLE ${driverShare.toFixed(2)}) and escrow (SLE ${escrowShare.toFixed(2)}). Continue?`
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setNotice('');

    try {
      await updateRide('cancel', activeBooking.id, {
        penaltyFee: isAfterFiveMinutes ? penaltyAmount : 0,
        driverCompensation: isAfterFiveMinutes ? driverShare : 0,
        escrowCompensation: isAfterFiveMinutes ? escrowShare : 0
      });

      setNotice(
        isAfterFiveMinutes
          ? `Trip cancelled. A 1% dispatch fee of SLE ${penaltyAmount.toFixed(2)} was split 50/50 between the driver and escrow.`
          : 'Trip cancelled within the 5-minute free window. Full refund returned to your wallet.'
      );
      setActiveBooking(null);
    } catch (err: any) {
      setNotice(err.message || 'Cancellation could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmArrivalAndPay = async () => {
    if (!activeBooking || busy) return;
    setBusy(true);
    try {
      await updateRide('complete', activeBooking.id);
      setNotice('Ride finished successfully! Payment released to driver.');
      setActiveBooking(null);
    } catch (err: any) {
      setNotice(err.message || 'Payment release failed.');
    } finally {
      setBusy(false);
    }
  };

  const minutesRemaining = Math.max(0, 300 - elapsedSeconds);
  const remainingMins = Math.floor(minutesRemaining / 60);
  const remainingSecs = minutesRemaining % 60;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      {notice && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-2xl text-xs font-bold">
          {notice}
        </div>
      )}

      {loadingTrip ? (
        /* Skeleton Screen Layout */
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 animate-pulse">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 space-y-4">
            <div className="h-6 bg-slate-200 rounded-lg w-3/4"></div>
            <div className="h-10 bg-slate-100 rounded-xl"></div>
            <div className="h-10 bg-slate-100 rounded-xl"></div>
            <div className="h-24 bg-slate-100 rounded-2xl"></div>
            <div className="h-12 bg-slate-200 rounded-xl"></div>
          </div>
          <div className="h-96 bg-slate-200 rounded-3xl"></div>
        </div>
      ) : activeBooking ? (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
                {activeBooking.status === 'pending' ? 'Broadcasting to Drivers' : activeBooking.status === 'accepted' ? 'Driver En Route' : 'Trip In Progress'}
              </span>
              <span className="font-black text-slate-900">SLE {activeBooking.fare_amount}</span>
            </div>

            {activeBooking.driver && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">Assigned Driver</span>
                <p className="font-bold text-slate-900">{activeBooking.driver.full_name}</p>
                <p className="text-xs text-slate-600 flex items-center gap-1.5"><Smartphone size={13}/> {activeBooking.driver.phone}</p>
              </div>
            )}

            {/* 5-minute fee split indicator */}
            {activeBooking.status === 'accepted' && (
              <div className={`p-4 rounded-2xl border text-xs space-y-2 ${
                elapsedSeconds <= 300 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <div className="flex items-center gap-2 font-bold">
                  <Clock size={16} />
                  {elapsedSeconds <= 300 ? (
                    <span>Free Cancellation: {remainingMins}:{remainingSecs < 10 ? `0${remainingSecs}` : remainingSecs}</span>
                  ) : (
                    <span>Late Cancellation: 1% Dispatch Fee Applies</span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed">
                  {elapsedSeconds <= 300 
                    ? 'Cancel within 5 minutes for a full refund.' 
                    : 'Cancelling after 5 minutes splits a 1% fee 50/50 between the driver and escrow.'}
                </p>
              </div>
            )}

            <div className="pt-2 space-y-2">
              {activeBooking.status === 'accepted' && (
                <button
                  disabled={busy}
                  onClick={handleCancelWithPenaltyCheck}
                  className="w-full py-3.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl border border-rose-200 text-xs transition"
                >
                  {busy ? 'Processing…' : 'Cancel Request'}
                </button>
              )}

              {activeBooking.status === 'in_progress' && (
                <button
                  disabled={busy}
                  onClick={handleConfirmArrivalAndPay}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition shadow-lg"
                >
                  {busy ? 'Releasing Funds…' : 'Confirm Arrival & Release Payment'}
                </button>
              )}

              {activeBooking.status === 'pending' && (
                <button
                  disabled={busy}
                  onClick={() => updateRide('cancel', activeBooking.id).then(() => setActiveBooking(null))}
                  className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200"
                >
                  Cancel Search
                </button>
              )}
            </div>
          </div>

          <div className="min-h-[400px]">
            <ActiveTripMap bookingId={activeBooking.id} userId={profile.id} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-lg font-black text-slate-900">Request Transportation</h2>

            {/* Passenger Count (Up to 3 passengers) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Seats / Passengers (Max 3)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(count => (
                  <button
                    type="button"
                    key={count}
                    onClick={() => setPassengerCount(count)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${
                      passengerCount === count
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}
                  >
                    {count} Seat{count > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['car', 'keke', 'bike'] as const).map(type => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setVehicleType(type)}
                  className={`py-2 rounded-xl text-xs font-bold uppercase transition border ${
                    vehicleType === type ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-600">Total Fare (SLE)</span>
              <input 
                type="number" 
                value={offerAmount} 
                onChange={e => setOfferAmount(e.target.value)}
                className="w-24 text-right font-black text-lg bg-transparent outline-none"
              />
            </div>

            <button
              disabled={busy}
              onClick={handleRequestRide}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl text-sm transition shadow-md disabled:opacity-50"
            >
              {busy ? 'Requesting…' : `Request ${passengerCount} Seat${passengerCount > 1 ? 's' : ''}`}
            </button>
          </div>

          <RideLocationPicker
            userId={profile.id}
            onChange={({ pickup, destination, distanceKm }: any) => {
              setPickup(pickup?.address || '');
              setDestination(destination?.address || '');
              setPickupCoords(pickup?.coords || null);
              setDestinationCoords(destination?.coords || null);
              if (distanceKm) {
                setOfferAmount(Math.max(20, Math.ceil(distanceKm * 6 * passengerCount)).toString());
              }
            }}
          />
        </div>
      )}
    </div>
  );
}