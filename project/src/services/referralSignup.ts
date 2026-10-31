
import {supabase} from '@/lib/supabase';
const ANON='matmove-referral-signup:v1';
const ownKey=(id:string)=>`matmove-referral-signup:v1:${id}`;
export type ReferralAttempt={code:string;method:'email'|'google';email:string;startedAt:number};
export type ReferralNotice={code:string;state:'pending'|'recorded'|'attention';message:string;acknowledged:boolean};
export function normalizeReferralCode(value:string){const code=value.trim().toUpperCase();if(code&&!/^MM[A-F0-9]{12}$/.test(code))throw new Error('Use a valid MatMove referral code, or remove it to continue without a code.');return code;}
export function prepareReferralSignup(value:string,method:'email'|'google',email=''){
 const code=normalizeReferralCode(value);
 if(!code){try{sessionStorage.removeItem(ANON);}catch{}return;}
 try{const draft:ReferralAttempt={code,method,email:email.trim().toLowerCase(),startedAt:Date.now()};sessionStorage.setItem(ANON,JSON.stringify(draft));if(sessionStorage.getItem(ANON)!==JSON.stringify(draft))throw Error();}
 catch{throw new Error('Your browser could not retain the referral code. Allow browser storage, or remove the code to continue without it.');}
}
function pending():ReferralAttempt|null{
 try{const raw=sessionStorage.getItem(ANON);if(!raw)return null;const d=JSON.parse(raw);if(!/^MM[A-F0-9]{12}$/.test(d.code)||!['email','google'].includes(d.method)||typeof d.email!=='string'||!Number.isFinite(d.startedAt)||d.startedAt>Date.now()+60000||Date.now()-d.startedAt>7*86400000)return null;return d;}catch{return null;}
}
export function emailReferralMetadata(email:string):Record<string,string>{const d=pending();return d?.method==='email'&&d.email===email.trim().toLowerCase()?{matmove_referral_code:d.code}:{};}
export function captureReferralIdentity(user:{id:string;email?:string;created_at?:string;user_metadata?:Record<string,unknown>;app_metadata?:Record<string,unknown>}){
 try{
  if(sessionStorage.getItem(ownKey(user.id)))return;
  const draft=pending(),created=Date.parse(user.created_at||'');let code='';
  if(draft){
   const provider=user.app_metadata?.provider;
   const matches=draft.method==='email'?draft.email===String(user.email||'').toLowerCase():provider==='google';
   if(matches&&Number.isFinite(created)&&created>=draft.startedAt-60000)code=draft.code;
   // A completed sign-in must never leave an anonymous code for the next identity.
   sessionStorage.removeItem(ANON);
  }
  // Email signup metadata survives confirmation in another tab/browser.
  if(!code&&typeof user.user_metadata?.matmove_referral_code==='string'&&Number.isFinite(created))code=normalizeReferralCode(user.user_metadata.matmove_referral_code);
  if(code){const notice:ReferralNotice={code,state:'pending',message:'Your referral code will be checked after account setup.',acknowledged:false};sessionStorage.setItem(ownKey(user.id),JSON.stringify(notice));}
 }catch{/* Optional attribution must never destroy or fabricate an Auth session. */}
}
export function referralSignupNotice(userId:string):ReferralNotice|null{
 try{const raw=sessionStorage.getItem(ownKey(userId));if(!raw)return null;const d=JSON.parse(raw);if(!/^MM[A-F0-9]{12}$/.test(d.code)||!['pending','recorded','attention'].includes(d.state)||typeof d.message!=='string'||typeof d.acknowledged!=='boolean')return null;return d;}catch{return null;}
}
export function acknowledgeReferralNotice(userId:string){const d=referralSignupNotice(userId);if(d)sessionStorage.setItem(ownKey(userId),JSON.stringify({...d,acknowledged:true}));}
const work=new Map<string,Promise<ReferralNotice|null>>();
export function recordSignupReferral(userId:string):Promise<ReferralNotice|null>{
 const previous=work.get(userId);if(previous)return previous;
 const task=(async()=>{
  const d=referralSignupNotice(userId);if(!d||d.state==='recorded'||d.acknowledged)return d;
  const same=async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const s=await Promise.race([supabase.auth.getSession(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Sign-in checking timed out. Reopen account setup.')),8000);})]);if(s.error||s.data.session?.user.id!==userId)throw new Error('Your sign-in changed. Reopen account setup.');}finally{if(timer!==undefined)clearTimeout(timer);}};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await same();const r=await Promise.race([Promise.resolve(supabase.rpc('matmove_referral_register',{p_code:d.code})),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Referral confirmation timed out. Retry the same code before completing verification.')),12000);})]);
   if(r.error)throw r.error;if(r.data?.user_id!==userId||r.data.recorded!==true||r.data.code!==d.code)throw new Error('Referral confirmation could not be verified. Retry the same code.');
   await same();const next:ReferralNotice={...d,state:'recorded',message:'Your signup referral code is recorded. Rewards remain subject to verification, eligibility and confirmed payments.',acknowledged:false};sessionStorage.setItem(ownKey(userId),JSON.stringify(next));return next;
  }catch(e:any){
   const next:ReferralNotice={...d,state:'attention',message:e.message||'Your referral was not confirmed. You can keep using your account.',acknowledged:false};
   // A failed check never creates a successful referral or a different request.
   try{await same();sessionStorage.setItem(ownKey(userId),JSON.stringify(next));}catch{}
   return next;
  }finally{if(timer!==undefined)clearTimeout(timer);}
 })();work.set(userId,task);void task.finally(()=>{if(work.get(userId)===task)work.delete(userId);});return task;
}
