import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
type Saved={id:string;details:Record<string,unknown>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function useTripRequest(userId:string){
 const key=`matmove:booking-create:v1:${userId}`;
 const [retained,setRetained]=useState<Saved|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const current=useRef(userId),mounted=useRef(false),mutex=useRef(false),epoch=useRef(0),active=useRef<AbortController|null>(null);current.current=userId;
 useEffect(()=>{mounted.current=true;epoch.current++;mutex.current=false;setRetained(null);setError('');setWorking(false);try{const raw=localStorage.getItem(key);if(raw){const body=JSON.parse(raw);if(!uuid.test(body?.id)||!body.details||body.details.client_version!==1)throw Error();setRetained(body);}}catch{setError('This browser cannot confirm the previous trip request. Restore browser storage before requesting another.');}return()=>{mounted.current=false;epoch.current++;active.current?.abort();};},[userId,key]);
 async function submit(details?:Record<string,unknown>){
  if(mutex.current||error)throw Error(error||'A trip request is already being checked.');
  mutex.current=true;setWorking(true);const id=userId,n=++epoch.current;const live=()=>mounted.current&&current.current===id&&epoch.current===n;
  try{
   const before=await supabase.auth.getSession();if(before.error||before.data.session?.user.id!==id||!before.data.session.access_token)throw Error('Your sign-in changed. Reopen Ride.');
   if(!live())throw Error('Your account changed.');
   const body=retained||{id:crypto.randomUUID(),details:details!};if(!body.details)throw Error('Review the request first.');
   if(!retained){localStorage.setItem(key,JSON.stringify(body));setRetained(body);}
   const controller=new AbortController();active.current=controller;const timer=setTimeout(()=>controller.abort(),15000);
   let result;try{result=await supabase.rpc('matmove_create_customer_trip',{p_request:body.id,p_details:body.details}).setHeader('Authorization',`Bearer ${before.data.session.access_token}`).abortSignal(controller.signal);}finally{clearTimeout(timer);}
   if(result.error)throw Error('Request not confirmed. Use Check original request to recover the same request; do not send a duplicate.');
   const row=result.data,after=await supabase.auth.getSession();if(after.error||after.data.session?.user.id!==id||!live())throw Error('Your sign-in changed.');
   if(row?.id!==body.id||row.rider_id!==id||!['pending','pending_admin','accepted','in_progress','completed','cancelled'].includes(row.status))throw Error('Original request receipt could not be verified.');
   localStorage.removeItem(key);setRetained(null);return row;
  }finally{if(live()){mutex.current=false;setWorking(false);}}
 }
 return{retained,error,working,submit};
}
