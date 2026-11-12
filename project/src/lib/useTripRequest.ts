import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';

type Saved={id:string;details:Record<string,unknown>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validBookingStatuses=['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress','completed','cancelled'];

async function reserveCashRide(bookingId:string,accessToken:string,signal:AbortSignal){
 const response=await fetch('/api/accept-ride-escrow?action=cash_reserve',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},
  body:JSON.stringify({bookingId}),
  signal
 });
 const type=response.headers.get('content-type')||'';
 if(!type.includes('application/json'))throw Error('Cash fee reservation service is unavailable. Check the same booking again; do not create another request.');
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data?.success||![200,202].includes(response.status)||data.pending!== (response.status===202)){
  throw Error(data?.error||data?.message||'The MatMove cash fee reservation is not confirmed. Check this same booking again; do not create another request.');
 }
 return data;
}

export function useTripRequest(userId:string){
 const key=`matmove:booking-create:v1:${userId}`;
 const [retained,setRetained]=useState<Saved|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false),[ready,setReady]=useState(false);
 const current=useRef(userId),mounted=useRef(false),mutex=useRef(false),epoch=useRef(0),active=useRef<AbortController|null>(null);current.current=userId;
 useEffect(()=>{mounted.current=true;epoch.current++;mutex.current=false;setRetained(null);setError('');setWorking(false);setReady(false);try{const raw=localStorage.getItem(key);if(raw){const body=JSON.parse(raw);if(!uuid.test(body?.id)||!body.details||body.details.client_version!==1)throw Error();setRetained(body);}}catch{setError('This browser cannot confirm the previous trip request. Restore browser storage before requesting another.');}finally{setReady(true);}return()=>{mounted.current=false;epoch.current++;active.current?.abort();};},[userId,key]);
 async function submit(details?:Record<string,unknown>){
  if(!ready)throw Error('Checking your previous trip request. Please wait.');
  if(mutex.current||error)throw Error(error||'A trip request is already being checked.');
  mutex.current=true;setWorking(true);const id=userId,n=++epoch.current;const live=()=>mounted.current&&current.current===id&&epoch.current===n;
  try{
   const before=await supabase.auth.getSession();if(before.error||before.data.session?.user.id!==id||!before.data.session.access_token)throw Error('Your sign-in changed. Reopen Ride.');
   if(!live())throw Error('Your account changed.');
   const body=retained||{id:crypto.randomUUID(),details:details!};if(!body.details)throw Error('Review the request first.');
   if(!retained){localStorage.setItem(key,JSON.stringify(body));setRetained(body);}
   const controller=new AbortController();active.current=controller;const timer=setTimeout(()=>controller.abort(),20000);
   let result;
   try{result=await supabase.rpc('matmove_create_customer_trip',{p_request:body.id,p_details:body.details}).setHeader('Authorization',`Bearer ${before.data.session.access_token}`).abortSignal(controller.signal);}
   finally{clearTimeout(timer);}
   if(result.error)throw Error('Request not confirmed. Use Check Original Request to recover the same request; do not send a duplicate.');
   const row=result.data;
   if(row?.id!==body.id||row.rider_id!==id||!validBookingStatuses.includes(row.status))throw Error('Original request receipt could not be verified.');

   let confirmedBooking=row;
   if(body.details.payment_method==='cash'){
    // A cash booking remains hidden from dispatch until the server confirms
    // the exact 15% reserve or records that the same reserve is still pending.
    const reserveController=new AbortController();active.current=reserveController;
    const reserveTimer=setTimeout(()=>reserveController.abort(),20000);
    let reserveResult;
    try{reserveResult=await reserveCashRide(body.id,before.data.session.access_token,reserveController.signal);}
    finally{clearTimeout(reserveTimer);}
    if(!live())throw Error('Your account changed.');
    confirmedBooking=reserveResult.booking||row;
    if(confirmedBooking?.id!==body.id||confirmedBooking.rider_id!==id||!validBookingStatuses.includes(confirmedBooking.status)){
     throw Error('The cash booking status could not be verified. Check the same booking again.');
    }
   }

   const after=await supabase.auth.getSession();
   if(after.error||after.data.session?.user.id!==id||!live())throw Error('Your sign-in changed.');
   localStorage.removeItem(key);setRetained(null);return confirmedBooking;
  }finally{if(live()){mutex.current=false;setWorking(false);}}
 }
 return{retained,error,working,ready,submit};
}
