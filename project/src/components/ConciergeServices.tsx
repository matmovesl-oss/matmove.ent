import { useCallback, useEffect, useState } from 'react';
import { Briefcase, Car, Plane, RefreshCw, Ship, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ConciergeService = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  price_label: string;
  display_order: number;
};

type Props = { profile: any };

const WHATSAPP_NUMBER = '23290330362';

function serviceIcon(item: ConciergeService) {
  const value = (item.title + ' ' + item.category).toLowerCase();
  if (value.includes('tour') || value.includes('travel')) return Plane;
  if (value.includes('vehicle') || value.includes('car')) return Car;
  if (value.includes('cargo') || value.includes('freight') || value.includes('shipping')) return Ship;
  return Briefcase;
}

export default function ConciergeServices({ profile }: Props) {
  const [services, setServices] = useState<ConciergeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase
        .from('concierge_services')
        .select('id,slug,title,category,description,price_label,display_order')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('display_order')
        .order('title');
      if (queryError) throw queryError;
      setServices((data || []) as ConciergeService[]);
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'MatMove Concierge services could not be loaded.');
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function contact(item: ConciergeService) {
    if (opening) return;
    setOpening(item.id);
    setNotice('');

    const message = "Hi MatMove, I'm interested in " + item.title + " (" + item.price_label +
      "). Please contact me with more details.";
    const url = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
    // Open immediately from the click gesture so popup blockers do not suppress WhatsApp.
    window.open(url, '_blank', 'noopener,noreferrer');

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user || authData.user.id !== profile.id) {
        throw new Error('Your customer session could not be verified. WhatsApp has opened, but the enquiry was not saved.');
      }
      const { error: insertError } = await supabase.from('concierge_interests').insert({
        service_id: item.id,
        service_slug: item.slug,
        service_title: item.title,
        price_label_snapshot: item.price_label,
        customer_id: authData.user.id,
        customer_name: profile.full_name || profile.first_name || null,
        customer_email: profile.email || authData.user.email || null,
        customer_phone: profile.phone || profile.phone_number || authData.user.phone || null,
        message,
      });
      if (insertError) throw insertError;
      setNotice('Your interest in ' + item.title + ' has been recorded. Continue the conversation in WhatsApp.');
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'WhatsApp has opened, but your Concierge enquiry could not be recorded.');
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="mm-surface" aria-label="MatMove Concierge Services">
      <div className="mm-row">
        <h2 className="flex items-center gap-2 font-black text-indigo-700">
          <Briefcase size={20} /> MatMove Concierge
        </h2>
        <button type="button" aria-label="Refresh Concierge services" onClick={() => void load()}
          disabled={loading} className="mm-icon-button">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Exclusive services supported directly by our team. Choose a service to record your interest and chat with us.
      </p>

      {error && <div role="alert" className="mm-alert mb-3">{error}</div>}
      {notice && <p role="status" className="mb-3 text-xs font-semibold text-emerald-700">{notice}</p>}

      {loading ? (
        <div role="status" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[1, 2, 3].map(index => <div key={index} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : !services.length ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          Concierge services are being updated. Please check again shortly.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map(item => {
            const Icon = serviceIcon(item);
            return (
              <button
                key={item.id}
                type="button"
                disabled={!!opening}
                onClick={() => void contact(item)}
                className="flex flex-col items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                  <Icon size={22} />
                </span>
                <span className="block w-full">
                  <strong className="block text-sm text-slate-900">{item.title}</strong>
                  <span className="mt-1 block text-[11px] font-bold text-indigo-700">{item.price_label}</span>
                  {item.description && <span className="mt-2 block text-xs leading-relaxed text-slate-600">{item.description}</span>}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-bold text-indigo-700">
                  <MessageCircle size={14} />{opening === item.id ? 'Opening WhatsApp…' : 'Chat with MatMove'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
