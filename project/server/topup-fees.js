
import { createHash } from 'node:crypto';
import { HttpError } from './wallet-security.js';
// Configure only after Monime confirms this space's collection fees and rounding.
// No fee is inferred from a single payment or from payout pricing.
export function topupQuote(netMinor, env=process.env) {
  if(!Number.isSafeInteger(netMinor)||netMinor<=0||netMinor>1000000000)throw new HttpError(400,'Top-up amount is outside the supported range.');
  if(env.MATMOVE_TOPUP_NET_ENABLED!=='true')return {netMode:false,requestedMinor:netMinor,walletCreditMinor:null,feeMinor:null,totalMinor:netMinor,version:'legacy-gross'};
  let c;try{c=JSON.parse(env.MONIME_TOPUP_FEE_CONFIG||'null');}catch{/* Fail closed below. */}
  if(!c||!['ceil','floor','nearest'].includes(c.rounding)||!['rateBps','fixedMinor','minimumMinor','taxBps'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)||c.rateBps>5000||c.taxBps>10000||c.fixedMinor>1000000||c.minimumMinor>1000000||c.confirmed!==true)throw new HttpError(503,'Exact-credit top-ups need the confirmed Monime collection fee settings. Contact MatMove support.');
  const round=n=>c.rounding==='floor'?Math.floor(n):c.rounding==='nearest'?Math.floor(n+0.5):Math.ceil(n);
  const fee=gross=>{const base=Math.max(c.minimumMinor,c.fixedMinor+round(gross*c.rateBps/10000));return base+round(base*c.taxBps/10000);};
  // Find the first gross amount that nets the requested credit. Fee rate <=50% keeps this bounded.
  let low=netMinor,high=netMinor*4+4000000;
  while(low<high){const mid=Math.floor((low+high)/2);if(mid-fee(mid)>=netMinor)high=mid;else low=mid+1;}
  if(low-fee(low)!==netMinor)throw new HttpError(409,'This amount cannot be quoted exactly with the configured fee rounding.');
  const version=createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0,24);
  return {netMode:true,requestedMinor:netMinor,walletCreditMinor:netMinor,feeMinor:fee(low),totalMinor:low,version};
}
