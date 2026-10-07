import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MerchantDashboard } from './MerchantDashboard';
import { MerchantCatalog } from './MerchantCatalog';

export function MerchantPortal(props: any) {
  if (props.activeSection === 'inventory') {
    return <MerchantCatalog profile={props.profile} />;
  }

  if (props.activeSection === 'trips') {
    return <MerchantTripHistory userId={props.profile.id} />;
  }

  return <MerchantDashboard {...props} />;
}

function MerchantTripHistory({ userId }: { userId: string }) {
  const [trips, setTrips] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id,service_type,pickup_location,destination_location,fare_amount,status,created_at'
      )
      .eq('rider_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setError('');
      setTrips(data || []);
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My Trips & Deliveries</h1>

        <button
          onClick={() => void refresh()}
          className="rounded-xl border bg-white px-4 py-2"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading trips...</p>
      ) : !trips.length && !error ? (
        <p>No trips or delivery requests yet.</p>
      ) : null}

      {trips.map(trip => (
        <article
          key={trip.id}
          className="space-y-2 rounded-2xl border bg-white p-5"
        >
          <h2 className="text-lg font-bold capitalize">
            {trip.service_type}
          </h2>

          <p><strong>From:</strong> {trip.pickup_location}</p>
          <p><strong>To:</strong> {trip.destination_location}</p>

          <p>
            SLE {Number(trip.fare_amount).toFixed(2)} · {trip.status}
          </p>

          <p className="text-sm text-slate-500">
            {new Date(trip.created_at).toLocaleString()}
          </p>
        </article>
      ))}
    </section>
  );
}