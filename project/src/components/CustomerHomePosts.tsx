import {useEffect,useState,useRef} from 'react';
import {ArrowRight,Megaphone,CalendarDays,Send,X,Image as ImageIcon} from 'lucide-react';
import {supabase} from '@/lib/supabase';
type Post={id:string;title:string;summary:string;body:string;image_path:string|null;starts_at:string|null;expires_at:string|null;display_order:number};
const bucket='matmove-homepage-posts';
export default function CustomerHomePosts({userId}:{userId:string}){
 const [posts,setPosts]=useState<Post[]>([]),[loading,setLoading]=useState(true),[open,setOpen]=useState<string|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const requestKey=useRef<string|null>(null),alive=useRef(false);
 async function load(){
  setLoading(true);setError('');
  try{
   const session=await supabase.auth.getSession();
   if(session.error||session.data.session?.user.id!==userId)throw new Error('Sign in again to view MatMove updates.');
   const result=await supabase.from('matmove_homepage_posts').select('id,title,summary,body,image_path,starts_at,expires_at,display_order,created_at').eq('status','published').is('deleted_at',null).order('display_order',{ascending:true}).order('created_at',{ascending:false}).limit(3);
   if(result.error)throw result.error;
   const after=await supabase.auth.getSession();
   if(after.error||after.data.session?.user.id!==userId)throw new Error('Your sign-in changed. Refresh the page.');
   if(alive.current)setPosts((result.data||[]) as Post[]);
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'MatMove updates are unavailable.');}
  finally{if(alive.current)setLoading(false);}
 }
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[userId]);
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
 if(loading||!posts.length)return null;
 return <section aria-labelledby="matmove-posts-title" className="space-y-3">
  <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">The latest from MatMove</p><h2 id="matmove-posts-title" className="mt-1 text-xl font-black text-slate-950">Updates & offers</h2></div><span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400"><Megaphone size={13}/>{posts.length} {posts.length===1?'update':'updates'}</span></div>
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
   {posts.map(post=>{const expanded=open===post.id,url=imageUrl(post.image_path);return <article key={post.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    {url?<img src={url} alt="" loading="lazy" className="h-36 w-full object-cover"/>:<div className="flex h-28 items-center justify-center bg-gradient-to-br from-[#0c2740] via-[#145b64] to-emerald-600 text-white"><ImageIcon size={28} className="opacity-60"/></div>}
    <div className="p-4"><p className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-700">MatMove announcement</p><h3 className="mt-1 text-base font-extrabold text-slate-950">{post.title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{post.summary}</p>
     <button type="button" aria-expanded={expanded} onClick={()=>{setOpen(expanded?null:post.id);setNotice('');setError('');requestKey.current=null;}} className="mt-3 inline-flex min-h-9 items-center gap-2 text-xs font-bold text-emerald-700">{expanded?'Close details':'Read details'} {expanded?<X size={14}/>:<ArrowRight size={14}/>}</button>
     {expanded&&<div className="mt-3 border-t border-slate-100 pt-3"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>
      {post.expires_at&&<p className="mt-3 inline-flex items-center gap-1 text-[10px] text-slate-400"><CalendarDays size={12}/> Offer ends {new Date(post.expires_at).toLocaleDateString()}</p>}
      <label className="mt-4 block text-xs font-bold text-slate-700">Ask us about this update<textarea value={message} onChange={e=>setMessage(e.target.value.slice(0,1000))} rows={3} maxLength={1000} placeholder="Write your question or request…" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-normal outline-none focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"/></label>
      <button type="button" disabled={busy||message.trim().length<5} onClick={()=>void send(post)} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-xs font-bold text-white disabled:opacity-50">{busy?'Sending…':'Send enquiry'} <Send size={13}/></button>
      {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
      {error&&<p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
     </div>}
    </div>
   </article>})}
  </div>
 </section>;
}
