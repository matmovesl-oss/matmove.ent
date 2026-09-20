import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, Package, MapPin, Navigation, ShoppingBag, Loader2, CalendarClock, Plus, Minus, ArrowRight } from 'lucide-react';

// NOTE: To keep this response concise, this is the updated RiderShop component only.
// Paste this OVER your existing RiderShop component inside src/pages/RiderDashboard.tsx!

function RiderShop({ profile }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('products').select('*, merchant:profiles!merchant_id(business_name, phone)').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (data) setProducts(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">MatMove Shop</h1>
      <p className="text-slate-500">Browse verified merchant products and order directly via WhatsApp.</p>

      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Loading marketplace...</div>
      ) : products.length === 0 ? (
        <div className="bg-blue-50 border border-blue-200 rounded-3xl p-12 text-center text-blue-700 mt-10">
           <ShoppingBag size={64} className="mx-auto mb-4 opacity-50" />
           <h3 className="font-bold text-xl">Marketplace is opening soon!</h3>
           <p className="text-sm mt-2">Merchants are currently onboarding their inventory.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {products.map(p => {
            // Use the specific WhatsApp number attached to the product, fallback to the merchant profile phone, or fallback to MatMove Support
            const contactNumber = p.whatsapp_number || p.merchant?.phone || "23290330362";
            // Format number to remove any + or spaces so WhatsApp web link works cleanly
            const cleanNumber = contactNumber.replace(/[^0-9]/g, '');

            return (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between p-4">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-44 object-cover rounded-xl mb-3" />
                ) : (
                  <div className="w-full h-44 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 mb-3"><ShoppingBag size={36} /></div>
                )}
                <div>
                  <div className="text-[10px] font-bold text-blue-600 uppercase">{p.merchant?.business_name || 'Verified Merchant'}</div>
                  <h3 className="font-bold text-slate-900 text-base mt-0.5">{p.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description || 'No description.'}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-lg font-bold text-slate-900">SLE {p.price}</span>
                  <a href={`https://wa.me/${cleanNumber}?text=${encodeURIComponent(`Hello, I am interested in ordering ${p.name} (SLE${p.price}) from your MatMove shop.`)}`} target="_blank" rel="noreferrer" className="bg-blue-600 text-white font-bold text-xs px-3 py-2 rounded-xl hover:bg-blue-700">Order Item</a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}