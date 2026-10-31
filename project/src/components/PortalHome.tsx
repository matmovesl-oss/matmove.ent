import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  ArrowRight, ShieldCheck, Wallet, MapPin, 
  X, CheckCircle2, Ticket, Sparkles, Bus, Users, Calendar 
} from 'lucide-react';

export default function PortalHome({ profile, wallet, onNavigate }: any) {
  const [panel, setPanel] = useState<'travel' | 'events' | null>(null);
  const [existingBooking, setExistingBooking] = useState<any>(null);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [events, setEvents] = useState<any[]>([]);

  const fetchTravelBooking = async () => {
    try {
      const { data } = await supabase
        .from('travel_bookings')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setExistingBooking(data);
    } finally {
      setLoadingBooking(false);
    }
  };

  const fetchEvents = async () => {
    try {
      const { data } = await supabase
        .from('platform_events')
        .select('*')
        .eq('is_active', true)
        .order('event_date', { ascending: true });
      if (data) setEvents(data);
    } catch {
      // Handled silently
    }
  };

  useEffect(() => {
    fetchTravelBooking();
    fetchEvents();
  }, [profile.id]);

  return (
    <main className="p-4 max-w-4xl mx-auto space-y-6">
      {/* Wallet Card */}
      <section className="bg-gradient-to-br from-emerald-800 to-teal-950 rounded-3xl p-6 text-white shadow-lg">
        <div className="flex justify-between items-start mb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">Your MatMove</span>
            <h1 className="text-2xl font-black mt-1">Hello, {profile?.full_name?.split(' ')[0] || 'Member'}.</h1>
            <p className="text-xs text-emerald-200 mt-0.5">Where will today take you?</p>
          </div>
          <button onClick={() => onNavigate('wallet')} className="p-2.5 bg-white/10 hover:bg-white/20 rounded-2xl backdrop-blur-md">
            <Wallet size={20} className="text-emerald-200" />
          </button>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 mb-4">
          <span className="text-xs text-emerald-200 block font-medium">Leone Wallet</span>
          <div className="text-3xl font-black mt-1">
            SLE {Number(wallet?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-emerald-300/80 mt-1 block">Available balance · verified with your wallet provider</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onNavigate('wallet')} className="py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2">
            <Wallet size={16} /> Load Wallet
          </button>
          <button onClick={() => onNavigate('account')} className="py-3 px-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2">
            <ShieldCheck size={16} /> My Account
          </button>
        </div>
      </section>

      {/* Services Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button onClick={() => onNavigate('home')} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between text-left group">
          <div>
            <b className="block text-slate-900 font-bold">Book a ride</b>
            <span className="text-xs text-slate-500">Fast pickup & verified safety</span>
          </div>
          <ArrowRight size={20} className="text-slate-300 group-hover:text-emerald-600" />
        </button>

        <button onClick={() => onNavigate('shop')} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between text-left group">
          <div>
            <b className="block text-slate-900 font-bold">Shop Marketplace</b>
            <span className="text-xs text-slate-500">Explore local verified products</span>
          </div>
          <ArrowRight size={20} className="text-slate-300 group-hover:text-emerald-600" />
        </button>
      </div>

      {/* Travel to Ghana Section */}
      <section className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-black text-slate-900">Travel to Ghana</h2>
            <p className="text-xs text-slate-500">Sierra Leone to Ghana direct bus · 1st & 15th every month</p>
          </div>
          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-full text-xs">
            6,000 SLE / seat
          </span>
        </div>

        {loadingBooking ? (
          <div className="animate-pulse h-20 bg-slate-100 rounded-2xl"></div>
        ) : existingBooking ? (
          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your Booking Request</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                existingBooking.status === 'approved' ? 'bg-indigo-100 text-indigo-800' :
                existingBooking.status === 'boarded' ? 'bg-emerald-100 text-emerald-800' :
                existingBooking.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {existingBooking.status === 'approved' ? 'Approved — Confirm Payment' :
                 existingBooking.status === 'boarded' ? 'Activated & Boarded' :
                 existingBooking.status === 'rejected' ? 'Seat Unavailable' : 'Awaiting Seat Approval'}
              </span>
            </div>

            <p className="text-sm font-bold text-slate-900">
              Freetown – Accra Direct ({existingBooking.passengers_count} Seat{existingBooking.passengers_count > 1 ? 's' : ''})
            </p>

            {existingBooking.status === 'approved' && !existingBooking.is_paid && (
              <button
                onClick={() => setPanel('travel')}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-sm transition shadow-md"
              >
                Confirm & Pay SLE {(existingBooking.passengers_count * 6000).toLocaleString()}
              </button>
            )}

            {existingBooking.is_paid && (
              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                <CheckCircle2 size={16} /> Paid & Confirmed. Present your phone at PZ Terminal at 7:00 AM.
              </div>
            )}
          </div>
        ) : (
          <button 
            type="button" 
            onClick={() => setPanel('travel')}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-900 via-blue-900 to-indigo-950 p-5 text-left text-white shadow-md flex items-center justify-between"
          >
            <div>
              <b className="block text-base font-bold">Freetown – Accra Direct</b>
              <span className="mt-1 block text-xs text-indigo-200">
                Book up to 3 passengers. Departures 7:00 AM sharp. Fill manifest & travel form.
              </span>
            </div>
            <ArrowRight size={22} className="text-indigo-300 shrink-0 ml-3"/>
          </button>
        )}
      </section>

      {/* Events Hub Section */}
      <section className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Ticket className="text-sky-600" size={20} />
            <h2 className="text-lg font-black text-slate-900">Upcoming Events & Tickets</h2>
          </div>
          <button onClick={() => setPanel('events')} className="text-xs font-bold text-sky-600 hover:underline">View All</button>
        </div>

        {events.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No active events posted yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {events.slice(0, 2).map(evt => (
              <div key={evt.id} className="border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                <img src={evt.flyer_url || '/logo.png'} alt={evt.title} className="w-full h-36 object-cover bg-slate-100" />
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm line-clamp-1">{evt.title}</h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{evt.description}</p>
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mt-2">
                      <Calendar size={13} className="text-sky-500" />
                      <span>{new Date(evt.event_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                    <span className="text-sm font-black text-sky-600">SLE {Number(evt.ticket_price).toLocaleString()}</span>
                    <button 
                      onClick={() => setPanel('events')}
                      className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg"
                    >
                      Book (Up to 3)
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Travel Modal */}
      {panel === 'travel' && (
        <TravelBookingModal
          uid={profile.id}
          userName={profile.full_name || ''}
          userPhone={profile.phone || ''}
          walletBalance={Number(wallet?.balance || 0)}
          existingBooking={existingBooking}
          onSuccess={() => {
            fetchTravelBooking();
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {/* Events Modal */}
      {panel === 'events' && (
        <EventsModal
          uid={profile.id}
          userPhone={profile.phone || ''}
          walletBalance={Number(wallet?.balance || 0)}
          events={events}
          onClose={() => setPanel(null)}
        />
      )}
    </main>
  );
}

function TravelBookingModal({ uid, userName, userPhone, walletBalance, existingBooking, onSuccess, onClose }: any) {
  const [passengerCount, setPassengerCount] = useState(1);
  const [fullName, setFullName] = useState(userName);
  const [phone, setPhone] = useState(userPhone);
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const totalCost = passengerCount * 6000;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('You must accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest guidelines.');
      return;
    }
    setBusy(true);
    setError('');

    try {
      const { error: insertError } = await supabase.from('travel_bookings').insert({
        user_id: uid,
        passenger_name: fullName,
        passenger_phone: phone,
        passenger_address: address,
        emergency_name: emergencyName,
        emergency_phone: emergencyPhone,
        passengers_count: passengerCount,
        fare_amount: totalCost,
        status: 'pending_approval',
        is_paid: false
      });

      if (insertError) throw insertError;
      setSuccess('Travel request submitted. Dispatch is reviewing seat availability.');
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) {
      setError(err.message || 'Submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePayApproved = async () => {
    if (walletBalance < (existingBooking.fare_amount || 6000)) {
      setError(`Insufficient wallet balance. You need SLE ${(existingBooking.fare_amount || 6000).toLocaleString()}`);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch('/api/create-monime-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token}`
        },
        body: JSON.stringify({
          amount: existingBooking.fare_amount * 100,
          destinationId: import.meta.env.VITE_MONIME_TRAVEL_ACCOUNT_ID || 'fac-travel-bus',
          description: `Travel Payment Freetown-Accra (${existingBooking.passengers_count} seat)`
        })
      });

      if (!res.ok) throw new Error('Payment debit failed.');

      await supabase.from('travel_bookings').update({ is_paid: true }).eq('id', existingBooking.id);
      setSuccess('Paid in full! Seats are officially confirmed.');
      setTimeout(() => onSuccess(), 1500);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900">Freetown – Accra Direct Bus</h2>
        <p className="text-xs text-slate-500 mt-0.5">Departures 1st & 15th every month · 6,000 SLE / seat</p>

        {error && <div className="mt-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">{error}</div>}
        {success && <div className="mt-4 p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">{success}</div>}

        {existingBooking && existingBooking.status === 'approved' && !existingBooking.is_paid ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
              <p className="text-sm font-bold text-emerald-900">Seats Approved by Dispatch!</p>
              <div className="text-2xl font-black text-slate-900 mt-2">SLE {Number(existingBooking.fare_amount).toLocaleString()}</div>
            </div>
            <button onClick={handlePayApproved} disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl text-sm">
              {busy ? 'Processing…' : 'Debit Wallet & Confirm Seats'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Seats to Book (Max 3)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(num => (
                  <button
                    type="button"
                    key={num}
                    onClick={() => setPassengerCount(num)}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${
                      passengerCount === num ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {num} Seat{num > 1 ? 's' : ''} (SLE {(num * 6000).toLocaleString()})
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Lead Passenger Name</label>
                <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone</label>
                <input type="text" required value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Residential Address (Sierra Leone)</label>
              <input type="text" required placeholder="Street / Community" value={address} onChange={e => setAddress(e.target.value)} className="w-full p-2.5 border rounded-xl text-xs" />
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border space-y-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Emergency Family Contact</span>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" required placeholder="Family Member Name" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
                <input type="text" required placeholder="Family Phone" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} className="w-full p-2 border rounded-xl text-xs bg-white" />
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
              <input type="checkbox" id="policy" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
              <label htmlFor="policy" className="text-[11px] text-amber-900 leading-relaxed cursor-pointer">
                I accept the Sierra Leone Road Safety Authority (SLRSA) travel manifest regulations.
              </label>
            </div>

            <button type="submit" disabled={busy} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl text-sm">
              {busy ? 'Submitting…' : 'Submit Booking Request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function EventsModal({ uid, userPhone, walletBalance, events, onClose }: any) {
  const [selectedTicketCount, setSelectedTicketCount] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleBuyTickets = async (evt: any) => {
    const count = selectedTicketCount[evt.id] || 1;
    const total = Number(evt.ticket_price) * count;

    if (walletBalance < total) {
      setError(`Insufficient balance. You need SLE ${total.toLocaleString()}`);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch('/api/create-monime-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token}`
        },
        body: JSON.stringify({
          amount: total * 100,
          destinationId: import.meta.env.VITE_MONIME_EVENT_ACCOUNT_ID || 'fac-event-account',
          description: `Ticket Purchase (${count} pass): ${evt.title}`
        })
      });

      if (!res.ok) throw new Error('Payment rejected.');

      await supabase.from('event_tickets').insert({
        event_id: evt.id,
        user_id: uid,
        user_phone: userPhone,
        tickets_count: count,
        amount_paid: total,
        ticket_code: `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        status: 'confirmed'
      });

      setNotice(`Purchased ${count} ticket(s) successfully!`);
    } catch (err: any) {
      setError(err.message || 'Payment processing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto space-y-4">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400"><X size={20} /></button>
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Sparkles className="text-sky-600" size={22} /> MatMove Events Hub
        </h2>
        <p className="text-xs text-slate-500">Book up to 3 tickets per event in one direct payment</p>

        {error && <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">{error}</div>}
        {notice && <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">{notice}</div>}

        <div className="space-y-4">
          {events.map(evt => {
            const count = selectedTicketCount[evt.id] || 1;
            const total = Number(evt.ticket_price) * count;

            return (
              <div key={evt.id} className="border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center">
                <img src={evt.flyer_url || '/logo.png'} alt={evt.title} className="w-full sm:w-28 h-28 rounded-xl object-cover bg-slate-100" />
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 text-sm">{evt.title}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{evt.venue} · {new Date(evt.event_date).toLocaleDateString()}</p>
                  
                  {/* Up to 3 tickets selector */}
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs font-bold text-slate-600">Quantity:</span>
                    {[1, 2, 3].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setSelectedTicketCount({ ...selectedTicketCount, [evt.id]: n })}
                        className={`w-7 h-7 rounded-lg text-xs font-bold border ${
                          count === n ? 'bg-sky-600 text-white border-sky-600' : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-base font-black text-sky-600 block mb-2">SLE {total.toLocaleString()}</span>
                  <button
                    disabled={busy}
                    onClick={() => handleBuyTickets(evt)}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
                  >
                    Buy {count} Ticket{count > 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}