import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { RiderDashboard } from './RiderDashboard';
import { DriverDashboard } from './DriverDashboard';
import { MerchantDashboard } from './MerchantDashboard';
import { X, CheckCircle2, Calculator } from 'lucide-react';

export function PortalApp() {
  const [profile, setProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'topup' | 'withdraw'>('topup');
  const [amount, setAmount] = useState('');

  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [serviceType, setServiceType] = useState<'ride' | 'delivery' | 'truck' | 'bus'>('ride');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [calculatedFare, setCalculatedFare] = useState<number>(30);

  const [processing, setProcessing] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchUserData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      const { data: walletData } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      const { data: bookingData } = await supabase
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });

      if (profileData) setProfile(profileData);
      if (walletData) setWallet(walletData);
      if (bookingData) setBookings(bookingData);
    } catch (err) {
      console.error("Error fetching portal state:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserData();

    // Subscribe to real-time booking changes
    const channel = supabase
      .channel('portal-booking-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        fetchUserData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch backend-authoritative fare
  useEffect(() => {
    const fetchEstimatedFare = async () => {
      const estimatedDistanceKm = pickup && destination ? 8.5 : 4.0;
      const { data, error } = await supabase.rpc('calculate_trip_fare', {
        p_service_type: serviceType,
        p_distance_km: estimatedDistanceKm
      });

      if (!error && data) {
        setCalculatedFare(data);
      }
    };

    if (isBookingOpen) {
      fetchEstimatedFare();
    }
  }, [serviceType, pickup, destination, isBookingOpen]);

  // Handle Rider Booking Request
  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    try {
      const { error } = await supabase.from('bookings').insert({
        rider_id: profile.id,
        service_type: serviceType,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: calculatedFare, // Backend-authoritative price
        status: 'pending'
      });

      if (error) throw error;

      setSuccessMsg('Booking requested! Nearby drivers have been notified.');
      setPickup('');
      setDestination('');
      setTimeout(() => {
        setIsBookingOpen(false);
        setSuccessMsg('');
      }, 2000);

      fetchUserData();
    } catch (err: any) {
      alert(err.message || "Booking request failed.");
    } finally {
      setProcessing(false);
    }
  };

  // Handle Driver Accepting Trip
  const handleAcceptTrip = async (bookingId: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'accepted', driver_id: profile.id })
        .eq('id', bookingId);

      if (error) throw error;
      fetchUserData();
    } catch (err: any) {
      alert(err.message || "Could not accept trip.");
    }
  };

  // Handle Driver Completing Trip (Triggers Phase 4 Atomic Settlement)
  const handleCompleteTrip = async (bookingId: string) => {
    try {
      const { error } = await supabase.rpc('complete_and_settle_trip', {
        p_booking_id: bookingId,
        p_driver_id: profile.id
      });

      if (error) throw error;

      alert("Trip completed successfully! SLE fare credited to your wallet.");
      fetchUserData();
    } catch (err: any) {
      alert(err.message || "Failed to settle trip payment.");
    }
  };

  // Handle Wallet Transactions
  const handleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    const numAmount = parseFloat(amount);

    try {
      const { error } = await supabase.rpc('process_wallet_transaction', {
        p_amount: numAmount,
        p_type: modalType,
        p_description: modalType === 'topup' ? 'Monime Top-Up' : 'Monime Cash-Out Withdrawal'
      });

      if (error) throw error;

      setSuccessMsg(
        modalType === 'topup'
          ? `Successfully added SLE ${numAmount} to your wallet!`
          : `Withdrawal request for SLE ${numAmount} submitted.`
      );

      await fetchUserData();
      setAmount('');
      setTimeout(() => {
        setIsModalOpen(false);
        setSuccessMsg('');
      }, 2000);
    } catch (err: any) {
      alert(err.message || "Transaction failed.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Loading MatMove portal...</div>;

  const role = (profile?.role || 'rider').toLowerCase();

  return (
    <div className="relative min-h-screen bg-slate-50">
      {/* Dynamic Role-Based Layout Routing */}
      {(role === 'rider' || role === 'client') && (
        <RiderDashboard 
          profile={profile} 
          wallet={wallet} 
          onOpenBooking={() => setIsBookingOpen(true)} 
          onOpenTopUp={() => { setModalType('topup'); setIsModalOpen(true); }}
        />
      )}

      {role === 'driver' && (
        <DriverDashboard 
          profile={profile} 
          wallet={wallet} 
          bookings={bookings}
          onAcceptBooking={handleAcceptTrip}
          onCompleteBooking={handleCompleteTrip}
          onOpenWithdraw={() => { setModalType('withdraw'); setIsModalOpen(true); }}
        />
      )}

      {(role === 'merchant' || role === 'vendor') && (
        <MerchantDashboard 
          profile={profile} 
          wallet={wallet} 
          onOpenWithdraw={() => { setModalType('withdraw'); setIsModalOpen(true); }}
        />
      )}

      {/* READ-ONLY PRICING BOOKING MODAL */}
      {isBookingOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setIsBookingOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full">
              <X size={20} />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 mb-1 capitalize">Book {serviceType}</h2>
            <p className="text-slate-500 text-sm mb-6">Enter details to generate authoritative fare.</p>

            {successMsg ? (
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
                <CheckCircle2 size={24} className="mt-0.5 shrink-0" />
                <p className="font-medium text-sm">{successMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleCreateBooking} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Pickup Location</label>
                  <input 
                    type="text" 
                    required 
                    value={pickup} 
                    onChange={e => setPickup(e.target.value)} 
                    className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600" 
                    placeholder="e.g. Lumley Junction, Freetown"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Destination Location</label>
                  <input 
                    type="text" 
                    required 
                    value={destination} 
                    onChange={e => setDestination(e.target.value)} 
                    className="w-full border border-slate-300 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-600" 
                    placeholder="e.g. Cotton Tree, Central Freetown"
                  />
                </div>

                {/* Read-Only System Fare */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-blue-700 uppercase flex items-center gap-1">
                      <Calculator size={14} /> Estimated System Fare
                    </span>
                    <span className="text-2xl font-bold text-blue-900 mt-1 block">SLE {calculatedFare}</span>
                  </div>
                  <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2.5 py-1 rounded-md">Read-Only</span>
                </div>

                <button 
                  type="submit" 
                  disabled={processing}
                  className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold mt-4 hover:bg-blue-700 transition flex justify-center"
                >
                  {processing ? 'Processing...' : 'Confirm Request'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* WALLET MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full">
              <X size={20} />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {modalType === 'topup' ? 'Top-Up Wallet' : 'Withdraw Earnings'}
            </h2>

            {successMsg ? (
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
                <CheckCircle2 size={24} className="mt-0.5 shrink-0" />
                <p className="font-medium text-sm">{successMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleTransaction} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Amount (SLE)</label>
                  <input 
                    type="number" 
                    required 
                    min="1"
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                    className="w-full border border-slate-300 p-3 rounded-xl text-lg font-medium focus:ring-2 focus:ring-blue-600 outline-none" 
                    placeholder="e.g. 150"
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={processing}
                  className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold mt-4 hover:bg-blue-700 transition flex justify-center"
                >
                  {processing ? 'Processing...' : modalType === 'topup' ? 'Confirm Top-Up' : 'Request Cash-Out'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}