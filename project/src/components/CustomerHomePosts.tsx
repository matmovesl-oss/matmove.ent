import {useEffect,useState,useRef} from 'react';
import {ArrowRight,Megaphone,CalendarDays,Send,X,MapPin} from 'lucide-react';
import {supabase} from '@/lib/supabase';
type Post={id:string;title:string;summary:string;body:string;image_path:string|null;starts_at:string|null;expires_at:string|null;display_order:number;created_at:string};
const bucket='matmove-homepage-posts';
const routePath='M 44 154 C 126 154 126 70 220 82 S 334 198 430 118 S 550 62 656 76';
function ActivityMap({post}:{post:Post}){
 const words=`${post.title} ${post.summary} ${post.body}`;
 const isVan=/van|delivery|package|parcel|cargo|fleet/i.test(words);
 const isBike=/bike|motorcycle|keke/i.test(words);
 const routeId=`mm-feed-route-${post.id.replace(/[^a-zA-Z0-9_-]/g,'')}`;
 return <div className="relative overflow-hidden border-b border-emerald-100 bg-[#eaf3ed]">
  <div className="absolute inset-0 opacity-60" style={{backgroundImage:'linear-gradient(rgba(120,160,135,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,135,.13) 1px,transparent 1px)',backgroundSize:'34px 34px'}}/>
  <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-800 shadow-sm"><MapPin size={12}/> Happening in Sierra Leone</div>
  <svg viewBox="0 0 700 220" role="img" aria-label={`Animated map-style activity preview for ${post.title} in Sierra Leone`} className="relative block h-40 w-full sm:h-48">
   <path d="M-20 30 C90 60 130 8 225 38 S390 80 455 40 S610 12 730 44" fill="none" stroke="#fff" strokeWidth="20" strokeLinecap="round"/><path d="M-20 30 C90 60 130 8 225 38 S390 80 455 40 S610 12 730 44" fill="none" stroke="#c7d8cc" strokeWidth="2"/>
   <path d="M-20 190 C100 145 150 202 255 170 S420 130 500 174 S630 195 730 150" fill="none" stroke="#fff" strokeWidth="24" strokeLinecap="round"/><path d="M-20 190 C100 145 150 202 255 170 S420 130 500 174 S630 195 730 150" fill="none" stroke="#c7d8cc" strokeWidth="2"/>
   <path d="M150 -20 C185 50 130 105 180 155 S230 200 230 240 M540 -20 C500 45 560 95 520 145 S540 200 580 240" fill="none" stroke="#fff" strokeWidth="16" strokeLinecap="round"/>
   <path id={routeId} d={routePath} fill="none" stroke="#07966a" strokeWidth="5" strokeDasharray="10 9" strokeLinecap="round"/>
   <circle cx="44" cy="154" r="10" fill="#fff" stroke="#07845f" strokeWidth="4"/><circle cx="656" cy="76" r="10" fill="#fff" stroke="#0b2236" strokeWidth="4"/>
   <g>
    <animateMotion dur={isBike?'7s':'10s'} repeatCount="indefinite" rotate="auto"><mpath href={`#${routeId}`}/></animateMotion>
    {isBike?<g><circle cx="-10" cy="7" r="5" fill="none" stroke="#0b2236" strokeWidth="2"/><circle cx="11" cy="7" r="5" fill="none" stroke="#0b2236" strokeWidth="2"/><path d="M-10 7L-3 -4L5 7H-10L0 0L11 7L4 -5" fill="none" stroke="#0b2236" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></g>:<g filter="drop-shadow(0 2px 2px rgba(15,35,50,.22))"><rect x={isVan?-23:-18} y="-10" width={isVan?46:36} height="20" rx="6" fill="#0b2236" stroke="#fff" strokeWidth="2"/><rect x={isVan?-14:-9} y="-7" width={isVan?17:18} height="7" rx="2" fill="#a7efd3"/>{isVan&&<rect x="6" y="-7" width="10" height="7" rx="2" fill="#a7efd3"/>}<circle cx={isVan?-14:-10} cy="9" r="3" fill="#0b2236" stroke="#fff" strokeWidth="1.5"/><circle cx={isVan?14:10} cy="9" r="3" fill="#0b2236" stroke="#fff" strokeWidth="1.5"/></g>}
   </g>
   <text x="28" y="25" fill="#47715b" fontSize="10" fontWeight="800">SIERRA LEONE</text>
  </svg>
  <div className="absolute bottom-3 right-3 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-[10px] font-bold text-slate-600 shadow-sm">{isBike?'Motorbike':isVan?'MatMove van':'MatMove car'} · Moving</div>
 </div>;
}
export default function CustomerHomePosts({userId}:{userId:string}){
 const [posts,setPosts]=useState<Post[]>([]),[loading,setLoading]=useState(true),[open,setOpen]=useState<string|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const requestKey=useRef<string|null>(null),alive=useRef(false);
 async function load(){
  try{
   const session=await supabase.auth.getSession();
   if(session.error||session.data.session?.user.id!==userId)throw new Error('Sign in again to view MatMove updates.');
   const now=new Date().toISOString();
   const result=await supabase.from('matmove_homepage_posts').select('id,title,summary,body,image_path,starts_at,expires_at,display_order,created_at').eq('status','published').is('deleted_at',null).or(`starts_at.is.null,starts_at.lte.${now}`).or(`expires_at.is.null,expires_at.gt.${now}`).order('display_order',{ascending:true}).order('created_at',{ascending:false}).limit(3);
   if(result.error)throw result.error;
   const after=await supabase.auth.getSession();
   if(after.error||after.data.session?.user.id!==userId)throw new Error('Your sign-in changed. Refresh the page.');
   if(alive.current){setPosts((result.data||[]) as Post[]);setError('');}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'MatMove updates are unavailable.');}
  finally{if(alive.current)setLoading(false);}
 }
 useEffect(()=>{
  alive.current=true;void load();
  const channel=supabase.channel(`matmove-homepage-feed-${userId}`).on('postgres_changes',{event:'*',schema:'public',table:'matmove_homepage_posts'},()=>{void load();}).subscribe();
  const refresh=window.setInterval(()=>void load(),30000);
  return()=>{alive.current=false;window.clearInterval(refresh);void supabase.removeChannel(channel);};
 },[userId]);
 const imageUrl=(path:string|null)=>path?supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl:null;
 async function send(post:Post){
  if(busy||!message.trim())return;
  setBusy(true);setError('');setNotice('');
  const key=requestKey.current||crypto.randomUUID();requestKey.current=key;
  try{
   const session=await supabase.auth.getSession();
   if(session.error||session.data.session?.user.id!==userId)throw new Error('Sign in again before sending your enquiry.');
   const {data,error}=await supabase.rpc('matmove_submit_homepage_post_enquiry',{p_post_id:post.id,p_message:message.trim(),p_request_key:key});
   if(error)throw error;
   if(data?.success!==true||typeof data.id!=='string')throw new Error('Your enquiry was not confirmed. Please retry.');
   setMessage('');requestKey.current=null;setNotice('Your enquiry has been sent to MatMove Support. We’ll follow up using your account contact details.');
  }catch(e){setError(e instanceof Error?e.message:'Your enquiry could not be sent. Please retry.');}
  finally{setBusy(false);}
 }
 return <section aria-labelledby="matmove-posts-title" className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,35,50,.07)]">
  <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">MatMove community</p><h2 id="matmove-posts-title" className="mt-1 text-xl font-black text-slate-950">Happening in Sierra Leone</h2><p className="mt-1 text-xs text-slate-500">Updates and stories from across the country.</p></div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-800"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"/>Live feed</span></div>
  {loading?<div className="mx-4 mb-4 h-48 animate-pulse rounded-2xl bg-slate-100 sm:mx-6"/>:posts.length===0?<div className="mx-4 mb-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center sm:mx-6"><Megaphone className="mx-auto text-slate-300" size={25}/><p className="mt-2 text-sm font-bold text-slate-700">No new updates just yet</p><p className="mt-1 text-xs text-slate-500">Check back soon for what's happening around Sierra Leone.</p></div>:<div className="space-y-4 px-3 pb-4 sm:px-5">{posts.map(post=>{const expanded=open===post.id,url=imageUrl(post.image_path);return <article key={post.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
   <ActivityMap post={post}/>
   <div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-700">MatMove update · {new Date(post.created_at).toLocaleDateString()}</p><h3 className="mt-1 text-base font-extrabold text-slate-950">{post.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{post.summary}</p></div><span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-800">Sierra Leone</span></div>
   {url&&<img src={url} alt="" loading="lazy" className="mt-3 max-h-64 w-full rounded-xl object-cover"/>}
   <button type="button" aria-expanded={expanded} onClick={()=>{setOpen(expanded?null:post.id);setNotice('');setError('');requestKey.current=null;}} className="mt-3 inline-flex min-h-9 items-center gap-2 text-xs font-bold text-emerald-700">{expanded?'Close details':'Read more'} {expanded?<X size={14}/>:<ArrowRight size={14}/>}</button>
   {expanded&&<div className="mt-3 border-t border-slate-100 pt-3"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>
    {post.expires_at&&<p className="mt-3 inline-flex items-center gap-1 text-[10px] text-slate-400"><CalendarDays size={12}/> Offer ends {new Date(post.expires_at).toLocaleDateString()}</p>}
    <label className="mt-4 block text-xs font-bold text-slate-700">Ask us about this update<textarea value={message} onChange={e=>setMessage(e.target.value.slice(0,1000))} rows={3} maxLength={1000} placeholder="Write your question or request…" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-normal outline-none focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"/></label>
    <button type="button" disabled={busy||message.trim().length<5} onClick={()=>void send(post)} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white disabled:opacity-50">{busy?'Sending…':'Send enquiry'} <Send size={13}/></button>
    {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
    {error&&<p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
   </div>}
   </div></article>})}</div>}
  {error&&<p role="alert" className="mx-4 mb-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
 </section>;
}
