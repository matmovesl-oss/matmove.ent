
import {useCallback,useEffect,useRef,useState} from 'react';
import {Gift,Copy,Share2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import ReferralRewardHistory from './ReferralRewardHistory';
type Summary={user_id:string;code:string|null;registered_with_code:boolean;campaign:{accepting:boolean;payments_enabled:boolean;reward_minor:string;currency:'SLE'};invited_count:string;pending_minor:string;credited_minor:string;review_count:string};
const codePattern=/^MM[A-F0-9]{12}$/;
const integer=(x:unknown):x is string=>typeof x==='string'&&/^\d{1,19}$/.test(x);
export function validateReferralSummary(v:any,userId:string):Summary{
 if(v?.user_id!==userId||!(v.code===null||typeof v.code==='string'&&codePattern.test(v.code))||typeof v.registered_with_code!=='boolean'||typeof v.campaign?.accepting!=='boolean'||typeof v.campaign.payments_enabled!=='boolean'||v.campaign.currency!=='SLE'||v.campaign.reward_minor!=='100'||!['invited_count','pending_minor','credited_minor','review_count'].every(k=>integer(v[k])))throw new Error('Your referral summary could not be verified. Reload it before continuing.');return v;
}
export function referralMoney(minor:string){if(!integer(minor))throw new Error('Invalid reward amount.');const n=BigInt(minor),whole=(n/100n).toLocaleString('en-US'),fraction=(n%100n).toString().padStart(2,'0');return `SLE ${whole}${fraction==='00'?'':'.'+fraction}`;}
async function bounded<T>(promise:PromiseLike<T>):Promise<T>{let timer=0;try{return await Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error('Referrals timed out. Reload to check your saved code.')),15000);})]);}finally{window.clearTimeout(timer);}}
async function sameUser(userId:string){const s=await bounded(supabase.auth.getSession());if(s.error||s.data.session?.user.id!==userId)throw new Error('Your sign-in changed. Reopen Account.');}
export default function InviteEarn({userId}:{userId:string}){
 const [summary,setSummary]=useState<Summary|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(false),current=useRef(userId),epoch=useRef(0),mutex=useRef(false),controller=useRef<AbortController|null>(null);current.current=userId;
 const reload=useCallback(async()=>{
  if(mutex.current)return;mutex.current=true;const token=++epoch.current;const abort=new AbortController();controller.current=abort;setLoading(true);setError('');
  const valid=()=>mounted.current&&current.current===userId&&epoch.current===token;
  try{await sameUser(userId);if(!valid())return;const r=await bounded(supabase.rpc('matmove_referrals_me').abortSignal(abort.signal));if(r.error)throw r.error;const value=validateReferralSummary(r.data,userId);await sameUser(userId);if(valid())setSummary(value);}
  catch(e:any){if(valid()){setError(e.message||'Your referrals could not be loaded.');setSummary(null);}}
  finally{abort.abort();if(valid()){setLoading(false);mutex.current=false;}}
 },[userId]);
 useEffect(()=>{mounted.current=true;mutex.current=false;setSummary(null);setNotice('');void reload();const refresh=()=>{if(document.visibilityState==='visible')void reload();};const timer=window.setInterval(refresh,60000);return()=>{mounted.current=false;epoch.current++;controller.current?.abort();window.clearInterval(timer);};},[userId,reload]);
 async function generate(){
  if(mutex.current||!summary||error||summary.code)return;mutex.current=true;setBusy(true);setNotice('');setError('');const token=epoch.current;
  const valid=()=>mounted.current&&current.current===userId&&epoch.current===token;
  try{await sameUser(userId);if(!valid())return;const r=await bounded(supabase.rpc('matmove_referral_my_code'));if(r.error)throw r.error;
   if(r.data?.user_id!==userId||typeof r.data.code!=='string'||!codePattern.test(r.data.code))throw new Error('Your code receipt could not be verified. Reload before trying again.');
   await sameUser(userId);if(valid()){mutex.current=false;await reload();}
  }catch(e:any){if(valid()){setError(e.message||'Your code was not confirmed. Reload to check it.');setSummary(null);}}
  finally{if(mounted.current&&current.current===userId){mutex.current=false;setBusy(false);}}
 }
 async function share(link:boolean){
  if(mutex.current||!summary?.code||summary.user_id!==userId||error)return;mutex.current=true;setBusy(true);setNotice('');const actor=userId;
  try{await sameUser(actor);if(!mounted.current||current.current!==actor)return;
   const value=link?new URL(`/signup?ref=${encodeURIComponent(summary.code)}`,window.location.origin).href:summary.code;
   if(link&&navigator.share){await navigator.share({title:'Join MatMove',text:`Join MatMove with my referral code ${summary.code}. Rewards require verification and campaign eligibility.`,url:value});}
   else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);if(mounted.current&&current.current===actor)setNotice(link?'Referral link copied.':'Referral code copied.');}
   else if(mounted.current&&current.current===actor)setNotice('Copy the code shown below and give it to your friend.');
  }catch(e:any){if(mounted.current&&current.current===actor&&e.name!=='AbortError')setNotice('Sharing was not completed. You can copy the displayed code manually.');}
  finally{mutex.current=false;if(mounted.current&&current.current===actor)setBusy(false);}
 }
 const own=summary?.user_id===userId?summary:null;
 return <section aria-label="Invite and Earn" className="mt-5 rounded-3xl border border-amber-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-black text-slate-950"><Gift size={23} className="text-amber-600"/>Invite & Earn</h2><p className="mt-2 text-sm text-slate-600">Invite a new customer with your personal code. You and your friend can each receive SLE 1 after required verification, approval and reward checks.</p>
 {loading&&<p role="status" className="mt-4 text-sm">Loading your referrals…</p>}{error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" disabled={busy||loading} onClick={()=>void reload()} className="ml-2 min-h-11 font-bold underline">Reload referrals</button></p>}
 {!error&&own&&<><p className={`mt-4 rounded-xl p-3 text-sm ${own.campaign.accepting&&own.campaign.payments_enabled?'bg-emerald-50 text-emerald-950':'bg-amber-50 text-amber-950'}`}>{!own.campaign.accepting?'Referral registration is currently paused. You can keep your personal code for when the campaign opens.':!own.campaign.payments_enabled?'Referral rewards are currently paused. Recorded rewards remain pending.':'Referral rewards are active. Eligibility and confirmed payment receipts determine when rewards show as credited.'}</p>
 {own.code?<div className="mt-4 rounded-2xl border bg-slate-50 p-4"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Your referral code</span><p className="mt-2 break-all font-mono text-xl font-black tracking-wider text-slate-950">{own.code}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy||loading} onClick={()=>void share(false)} className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-bold"><Copy size={16}/>Copy code</button><button type="button" disabled={busy||loading||!own.campaign.accepting} onClick={()=>void share(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"><Share2 size={16}/>Share invite</button></div></div>:<button type="button" disabled={busy||loading} onClick={()=>void generate()} className="mt-4 min-h-11 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Checking your code…':'Generate my referral code'}</button>}
 <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Friends registered</dt><dd className="mt-1 font-bold">{BigInt(own.invited_count).toLocaleString('en-US')}</dd></div><div className="rounded-xl bg-amber-50 p-3"><dt className="text-xs text-slate-600">Pending rewards</dt><dd className="mt-1 font-bold">{referralMoney(own.pending_minor)}</dd></div><div className="rounded-xl bg-emerald-50 p-3"><dt className="text-xs text-slate-600">Credited rewards</dt><dd className="mt-1 font-bold">{referralMoney(own.credited_minor)}</dd></div></dl>
 {BigInt(own.review_count)>0n&&<p className="mt-3 text-sm text-amber-900">Some rewards need review. They are not included as credited.</p>}{own.registered_with_code&&<p className="mt-3 text-sm text-slate-600">Your signup referral code is recorded.</p>}<p className="mt-4 text-xs leading-relaxed text-slate-500">Codes are for new accounts and must be recorded before verification. Both people must meet eligibility checks; drivers and merchants need Admin approval. Self-referrals and duplicate claims are not eligible. A pending reward is not spendable wallet money.</p><button type="button" disabled={busy||loading} onClick={()=>void reload()} className="mt-3 min-h-11 text-sm font-bold text-emerald-800">Refresh referrals</button>
 </>}{!error&&own&&<ReferralRewardHistory key={userId} userId={userId}/>}{notice&&<p role="status" className="mt-3 text-sm text-emerald-900">{notice}</p>}</section>;
}
