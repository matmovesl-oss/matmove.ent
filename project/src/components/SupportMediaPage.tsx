import {useCallback,useEffect,useState} from 'react';
import {
  ArrowLeft,ArrowUpRight,Facebook,Globe,Instagram,Linkedin,MessageCircle,
  Music2,RefreshCw,Send,Youtube,Ghost
} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type PublicContact={
  id:string;
  kind:'social'|'whatsapp';
  platform_name:string;
  link_url:string|null;
  whatsapp_phone:string|null;
  icon_key:string;
  display_order:number;
};

const digits=(value:string|null)=>String(value||'').replace(/[^0-9]/g,'');
const safeHttps=(value:string|null)=>{
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'?url.toString():null;}
  catch{return null;}
};

function PlatformIcon({item}:{item:PublicContact}){
  const key=(item.icon_key||'').toLowerCase();
  if(item.kind==='whatsapp'||key==='whatsapp')return <MessageCircle size={22}/>;
  if(key==='instagram')return <Instagram size={22}/>;
  if(key==='facebook')return <Facebook size={22}/>;
  if(key==='youtube')return <Youtube size={22}/>;
  if(key==='linkedin')return <Linkedin size={22}/>;
  if(key==='telegram')return <Send size={22}/>;
  if(key==='tiktok')return <Music2 size={22}/>;
  if(key==='snapchat')return <Ghost size={22}/>;
  if(key==='x')return <span aria-hidden="true" className="text-xl font-black">𝕏</span>;
  return <Globe size={22}/>;
}

export default function SupportMediaPage({onBack}:{onBack:()=>void}){
  const [items,setItems]=useState<PublicContact[]>([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    setError('');
    try{
      const {data,error}=await supabase.from('matmove_public_contacts')
        .select('id,kind,platform_name,link_url,whatsapp_phone,icon_key,display_order')
        .eq('is_active',true)
        .order('display_order',{ascending:true})
        .order('created_at',{ascending:true});
      if(error)throw error;
      const valid=(Array.isArray(data)?data:[]).filter((item:any)=>{
        if(item.kind==='whatsapp'){
          const number=digits(item.whatsapp_phone);
          return number.length>=8&&number.length<=15;
        }
        return item.kind==='social'&&typeof item.platform_name==='string'&&
          item.platform_name.trim().length>1&&!!safeHttps(item.link_url);
      });
      setItems(valid as PublicContact[]);
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Support media could not be loaded. Please try again.');
    }finally{
      setLoading(false);
      setRefreshing(false);
    }
  },[]);

  useEffect(()=>{void load();},[load]);

  function destination(item:PublicContact){
    if(item.kind==='whatsapp'){
      const number=digits(item.whatsapp_phone);
      return number?('https://wa.me/'+number+'?text='+encodeURIComponent('Hello MatMove Support')):null;
    }
    return safeHttps(item.link_url);
  }

  return <main className="min-h-[100dvh] w-full bg-[linear-gradient(145deg,#effaf5_0%,#f3f8ff_52%,#f8fafc_100%)]">
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col px-4 py-5 sm:px-6 sm:py-7">
      <header className="mb-6 flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to Account" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-800">
          <ArrowLeft size={19}/>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">MatMove account</p>
          <h1 className="text-2xl font-black text-slate-950">Support Media</h1>
          <p className="mt-1 text-sm text-slate-500">Connect with MatMove through our official channels.</p>
        </div>
        <button type="button" onClick={()=>{setRefreshing(true);void load();}} disabled={loading||refreshing} aria-label="Refresh support media" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 disabled:opacity-50">
          <RefreshCw size={17} className={refreshing?'animate-spin':''}/>
        </button>
      </header>

      <section className="rounded-3xl border border-white/90 bg-white/80 p-5 shadow-[0_16px_42px_rgba(16,50,83,.08)] backdrop-blur-xl sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-800"><Globe size={23}/></span>
          <div><h2 className="font-black text-slate-950">Official MatMove channels</h2><p className="mt-1 text-xs text-slate-500">Choose a platform to open MatMove’s official page.</p></div>
        </div>
      </section>

      {error&&<div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<button type="button" onClick={()=>{setRefreshing(true);void load();}} className="ml-2 font-bold underline">Try again</button></div>}
      {loading?<div role="status" className="mt-4 rounded-2xl border border-white bg-white/80 p-5 text-sm text-slate-500">Loading official channels…</div>:
        items.length===0&&!error?<div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Globe size={22}/></span>
          <h3 className="mt-3 font-bold text-slate-800">No social channels published yet</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">MatMove’s official media links will appear here when they are published.</p>
        </div>:<div className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map(item=>{
            const url=destination(item);
            if(!url)return null;
            const whatsapp=item.kind==='whatsapp';
            return <a key={item.id} href={url} target="_blank" rel="noopener noreferrer" className="group flex min-h-[88px] items-center gap-4 rounded-2xl border border-white bg-white/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <span className={whatsapp?'grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700':'grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-800'}>
                <PlatformIcon item={item}/>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-black text-slate-950">{whatsapp?'WhatsApp Support':item.platform_name}</span>
                <span className="mt-1 block truncate text-xs text-slate-500">{whatsapp?'Open a direct WhatsApp conversation':'Open official MatMove profile'}</span>
              </span>
              <ArrowUpRight size={19} className="shrink-0 text-slate-400 transition group-hover:text-emerald-700"/>
            </a>;
          })}
        </div>
      }
      <p className="mt-auto pt-8 text-center text-xs text-slate-500">Only channels published by MatMove are shown on this page.</p>
    </div>
  </main>;
}
