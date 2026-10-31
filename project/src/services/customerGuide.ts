import {supabase} from '@/lib/supabase';
export async function claimCustomerGuide(userId:string,seen=false):Promise<boolean>{
 const session=await supabase.auth.getSession();
 if(session.error||session.data.session?.user.id!==userId||!session.data.session.access_token)throw Error('Your sign-in changed. Reopen Quick guide.');
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);
 try{
  const result=await supabase.rpc('matmove_customer_guide',{p_action:seen?'seen':'claim'}).setHeader('Authorization',`Bearer ${session.data.session.access_token}`).abortSignal(abort.signal);
  if(result.error)throw Error('Your guide preference could not be confirmed. You can open Quick guide manually.');
  const after=await supabase.auth.getSession(),d=result.data;
  if(after.error||after.data.session?.user.id!==userId||d?.userId!==userId||d.seen!==true||typeof d.firstDisplay!=='boolean')throw Error('Your guide preference could not be verified.');
  return !seen&&d.firstDisplay;
 }finally{clearTimeout(timeout);}
}
