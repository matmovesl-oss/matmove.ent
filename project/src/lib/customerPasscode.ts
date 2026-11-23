import {supabase} from '@/lib/supabase';

export Receipt={userId:string;configured:boolean;digits:4|6|7|8|9|10;ok:boolean;code:string;attemptsRemaining:number;retryAfterSeconds:number};
const codes=['status','cooldown','already_configured','saved','setup_required','upgrade_required','verified','incorrect'];

export async function customerPasscode(userId:string,action:'status'|'create'|'verify'|'change'|'recover',pin:string|null=null,newPin:string|null=null):Promise<Receipt>{
 if(!userId||!['status','create','verify','change','recover'].includes(action))throw Error('Invalid passcode request.');
 if(['create','change','recover'].includes(action)&&!/^\d{6,9}$/.test(newPin||''))throw Error('Choose between 6 and 9 digits.');
 if(['verify','change'].includes(action)&&!/^(?:[0-9]{4}|[0-9]{6,10})$/.test(pin||''))throw Error('Enter your current passcode.');
 const session=await supabase.auth.getSession();
 if(session.error||session.data.session?.user.id!==userId||!session.data.session.access_token)throw Error('Your sign-in changed. Sign in again.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await supabase.rpc('matmove_customer_passcode',{p_action:action,p_pin:pin,p_new_pin:newPin}).setHeader('Authorization',`Bearer ${session.data.session.access_token}`).abortSignal(controller.signal);
  if(r.error){
   if(r.error.message?.includes('ACCESS: Customer account required.'))throw Error('This identity has active staff access. Use Admin or contact support to review your customer account.');
   if(r.error.message?.includes('ACCESS: Customer account setup required.'))throw Error('Your saved customer role needs review. Contact support; your account and wallet have not been deleted.');
   const code=typeof r.error.code==='string'&&/^[A-Z0-9_]{3,20}$/.test(r.error.code)?` (${r.error.code})`:'';
   throw Error(`Passcode check was not confirmed${code}. Reload the passcode screen and try again.`);
  }
  const after=await supabase.auth.getSession();
  if(after.error||after.data.session?.user.id!==userId)throw Error('Your sign-in changed. Sign in again.');
  const d=r.data;
  if(d?.userId!==userId||typeof d.configured!=='boolean'||!(d.digits===4||(Number.isInteger(d.digits)&&d.digits>=6&&d.digits<=10))||typeof d.ok!=='boolean'||!codes.includes(d.code)||!Number.isInteger(d.attemptsRemaining)||d.attemptsRemaining<0||d.attemptsRemaining>5||!Number.isInteger(d.retryAfterSeconds)||d.retryAfterSeconds<0||d.retryAfterSeconds>300||
   (d.ok&&(!d.configured||!['saved','verified','upgrade_required'].includes(d.code)))||(d.ok&&(d.digits<6||d.digits>10)&&d.code!=='upgrade_required')||
   (d.code==='upgrade_required'&&d.digits!==4)||
   (d.code==='verified'&&action!=='verify')||(d.code==='saved'&&!['create','change','recover'].includes(action)))throw Error('Passcode response could not be verified. Reload and try again.');
  return d;
 }catch(e){if(controller.signal.aborted)throw Error('Passcode check timed out. Reload to confirm the saved state.');throw e;}
 finally{clearTimeout(timer);}
}