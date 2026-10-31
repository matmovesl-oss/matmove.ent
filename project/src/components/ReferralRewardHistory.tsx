
import {useCallback, useEffect, useRef, useState} from 'react';
import {supabase} from '@/lib/supabase';

type RewardState = 'pending' | 'processing' | 'completed' | 'review_required' | 'failed';
type Reward = {id:string; kind:'inviter'|'new_user'; amountMinor:'100'; currency:'SLE'; state:RewardState; createdAt:string};
type History = {userId:string; rewards:Reward[]; hasMore:boolean};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels:Record<RewardState,string> = {pending:'Pending eligibility checks', processing:'Payment processing', completed:'Credited', review_required:'Needs review', failed:'Payment failed'};
const details:Record<RewardState,string> = {
 pending:'Required verification, approval and campaign checks must finish before a payment can start.',
 processing:'The original payment is being checked. It is not yet confirmed as credited.',
 completed:'A matching payment receipt confirmed this reward. Refresh Wallet to check your current balance.',
 review_required:'MatMove must review the original request. This reward is not confirmed as credited.',
 failed:'The original payment failed. This reward is not credited; contact support if you need help.',
};
const exactKeys = (value:object, keys:string[]) => Object.keys(value).length===keys.length && Object.keys(value).every(k=>keys.includes(k));
export function validateRewardHistory(value:unknown, userId:string):History {
 const v=value as History;
 if(!v || !exactKeys(v,['userId','rewards','hasMore']) || !uuid.test(userId) || v.userId!==userId || typeof v.hasMore!=='boolean' || !Array.isArray(v.rewards) || v.rewards.length>50 || v.hasMore && v.rewards.length!==50) throw new Error('Your reward history could not be verified.');
 const seen=new Set<string>();
 const rewards=v.rewards.map(r=>{
  if(!r || !exactKeys(r,['id','kind','amountMinor','currency','state','createdAt']) || typeof r.id!=='string' || !uuid.test(r.id) || seen.has(r.id.toLowerCase()) || !['inviter','new_user'].includes(r.kind) || r.amountMinor!=='100' || r.currency!=='SLE' || !Object.prototype.hasOwnProperty.call(labels,r.state) || typeof r.createdAt!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt))) throw new Error('Your reward history could not be verified.');
  seen.add(r.id.toLowerCase());
  return {id:r.id,kind:r.kind,amountMinor:r.amountMinor,currency:r.currency,state:r.state,createdAt:r.createdAt};
 });
 return {userId,rewards,hasMore:v.hasMore};
}

export default function ReferralRewardHistory({userId}:{userId:string}) {
 const [result,setResult]=useState<History|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState('');
 const mounted=useRef(false), current=useRef(userId), epoch=useRef(0), busy=useRef(false), request=useRef<AbortController|null>(null);
 current.current=userId;
 const reload=useCallback(async()=>{
  if(busy.current)return;
  busy.current=true;const generation=++epoch.current, abort=new AbortController();request.current=abort;
  const alive=()=>mounted.current&&current.current===userId&&epoch.current===generation;
  setLoading(true);setResult(null);setError('');let timer=0;
  try {
   const work=async()=>{
    const session=await supabase.auth.getSession();
    if(session.error || session.data.session?.user.id!==userId || !session.data.session.access_token)throw new Error('Sign-in changed. Reopen Account to check your rewards.');
    if(!alive()||abort.signal.aborted)return null;
    const response=await fetch('/api/get-live-wallet', {method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.data.session.access_token}`},body:JSON.stringify({action:'referral_status',userId})});
    if(!response.ok)throw new Error('Reward history is temporarily unavailable. Try again.');
    const value=validateRewardHistory(await response.json(),userId);
    const after=await supabase.auth.getSession();
    if(after.error || after.data.session?.user.id!==userId)throw new Error('Sign-in changed. Reopen Account to check your rewards.');
    return value;
   };
   const value=await Promise.race([work(),new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>{abort.abort();reject(new Error('Reward history timed out. Try again.'));},15000);})]);
   if(alive()&&!abort.signal.aborted&&value)setResult(value);
  }catch(e:unknown){if(alive())setError(e instanceof Error && /^(Sign-in changed|Reward history|Your reward history)/.test(e.message)?e.message:'Reward history is temporarily unavailable. Try again.');}
  finally {window.clearTimeout(timer);abort.abort();if(alive()){busy.current=false;setLoading(false);}}
 },[userId]);
 useEffect(()=>{
  mounted.current=true;busy.current=false;setResult(null);setError('');void reload();
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
   if(session?.user.id===userId)return;
   epoch.current++;request.current?.abort();busy.current=false;setResult(null);setLoading(false);setError('Sign-in changed. Reopen Account to check your rewards.');
  });
  return()=>{mounted.current=false;epoch.current++;request.current?.abort();subscription.unsubscribe();};
 },[userId,reload]);
 const own=result?.userId===userId?result:null;
 return <section aria-label="Your reward history" className="mt-5 border-t border-slate-200 pt-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-950">Your reward history</h3><button type="button" disabled={loading} onClick={()=>void reload()} className="min-h-11 text-sm font-bold text-emerald-800 disabled:opacity-50">Refresh reward history</button></div>
  <p className="text-xs leading-relaxed text-slate-600">Pending and processing rewards are not spendable wallet money. This list shows only your rewards.</p>
  {loading&&<p role="status" className="mt-3 text-sm">Loading reward history…</p>}
  {error&&<p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
  {!loading&&!error&&own&&<>
   {own.rewards.length===0?<p className="mt-3 text-sm text-slate-600">No referral rewards recorded for your account yet.</p>:<ul className="mt-3 space-y-3">{own.rewards.map(r=><li key={r.id} className="rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-bold">{r.kind==='inviter'?'Friend signup reward':'Your signup reward'} · SLE 1</span><span className={`text-sm font-bold ${r.state==='completed'?'text-emerald-800':'text-amber-900'}`}>{labels[r.state]}</span></div>
    <p className="mt-1 text-xs leading-relaxed text-slate-600">{details[r.state]}</p><time dateTime={r.createdAt} className="mt-2 block text-xs text-slate-500">{new Date(r.createdAt).toLocaleString('en-GB',{timeZone:'Africa/Freetown'})}</time>
   </li>)}</ul>}
   {own.hasMore&&<p className="mt-3 text-xs text-slate-600">Showing your 50 most recent rewards. Account totals include older rewards; contact support if you need older details.</p>}
  </>}
 </section>;
}
