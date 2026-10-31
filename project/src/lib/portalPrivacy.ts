// In-memory privacy state only; never a substitute for Auth/RLS/payment checks.
const unlocked=new Map<string,boolean>();
const listeners=new Set<(userId:string)=>void>();
export function portalIsUnlocked(userId:string){return unlocked.get(userId)!==false;}
export function setPortalUnlocked(userId:string,value:boolean){unlocked.set(userId,value);for(const listener of listeners)listener(userId);}
export function onPortalPrivacyChange(listener:(userId:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
