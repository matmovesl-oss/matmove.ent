import { useEffect, useState } from 'react';
import { CalendarDays, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type PublicPost = {
  id: string;
  title: string;
  summary: string;
  body: string;
  image_path: string | null;
  starts_at: string | null;
  expires_at: string | null;
  display_order: number;
  price_amount: number | string | null;
  price_currency: 'SLE' | 'USD' | null;
  created_at: string;
};

const bucket = 'matmove-homepage-posts';

function postPrice(amount: PublicPost['price_amount'], currency: PublicPost['price_currency']) {
  if (amount === null || amount === '' || !currency) return null;
  const formatted = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `USD ${formatted}` : `SLE ${formatted}`;
}

export default function PublicHomepagePosts() {
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('matmove_public_homepage_posts')
          .select('id,title,summary,body,image_path,starts_at,expires_at,display_order,price_amount,price_currency,created_at')
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) throw error;
        if (active) setPosts(Array.isArray(data) ? data as PublicPost[] : []);
      } catch {
        if (active) setPosts([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const refresh = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, []);

  const imageUrl = (path: string | null) =>
    path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null;

  if (!loading && posts.length === 0) return null;

  return (
    <section aria-labelledby="matmove-public-updates-title" className="border-y border-slate-200 bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">From the MatMove team</p>
            <h2 id="matmove-public-updates-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Latest updates</h2>
            <p className="mt-2 text-sm text-slate-500">Announcements, offers and news from MatMove.</p>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800 sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Public updates
          </span>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2" aria-label="Loading MatMove updates">
            <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
            <div className="hidden h-56 animate-pulse rounded-2xl bg-slate-100 md:block" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {posts.map(post => {
              const image = imageUrl(post.image_path);
              const price = postPrice(post.price_amount, post.price_currency);
              return (
                <article key={post.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-[#fbfdfc] shadow-sm">
                  {image ? (
                    <div className="border-b border-slate-100 bg-slate-50">
                      <img src={image} alt={`${post.title} announcement`} loading="lazy" className="block max-h-[420px] w-full object-contain" />
                    </div>
                  ) : (
                    <div className="flex h-28 items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-5 text-emerald-800">
                      <Megaphone size={24} />
                      <span className="text-xs font-bold uppercase tracking-[.14em]">MatMove announcement</span>
                    </div>
                  )}
                  <div className="p-4 sm:p-5">
                    <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-emerald-700">
                      <CalendarDays size={13} /> {new Date(post.created_at).toLocaleDateString()}
                    </p>
                    <h3 className="mt-2 break-words text-lg font-extrabold text-slate-950">{post.title}</h3>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-600">{post.summary}</p>
                    {price && <p className="mt-3 inline-flex rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">{price}</p>}
                    {post.body && (
                      <details className="mt-4 border-t border-slate-100 pt-3">
                        <summary className="min-h-10 cursor-pointer list-none whitespace-nowrap text-xs font-bold text-emerald-800">Read full update</summary>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{post.body}</p>
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
