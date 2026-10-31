
import { supabase } from '@/lib/supabase';
export type FareOffer = {
  id: string; driverId: string; driverName: string; amountMinor: number;
  fareVersion: number; agreedVersion: number | null;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' | 'expired';
  expiresAt: string; createdAt: string;
};
export type FareSnapshot = {
  bookingId: string; viewerId: string; fareMinor: number; fareVersion: number;
  bookingStatus: string; paymentStarted: boolean; selectedDriverId: string | null;
  serverTime: string; offers: FareOffer[];
};
export function fareMinor(value: string): number {
  const text=value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a fare with at most two decimal places.');
  const [whole,fraction='']=text.split('.');
  const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(n<1n||n>100000000n)throw new Error('Enter a fare from SLE 0.01 to SLE 1,000,000.');
  return Number(n);
}
export function offerRequestKey(): string { return crypto.randomUUID(); }
async function request(userId: string,name: string,args: Record<string,unknown>) {
  const {data:before,error:sessionError}=await supabase.auth.getSession();
  if(sessionError||before.session?.user.id!==userId)throw new Error('Your account changed. Sign in again.');
  const {data,error}=await supabase.rpc(name,{p_user_id:userId,...args});
  if(error)throw new Error(String(error.message||'Could not confirm the fare action.').replace(/^[A-Z_]+:\s*/,''));
  const {data:after}=await supabase.auth.getSession();
  if(after.session?.user.id!==userId)throw new Error('Your account changed. Reopen this request.');
  return data;
}
export async function readRideFares(userId: string,bookingId: string): Promise<FareSnapshot> {
  const data=await request(userId,'matmove_read_ride_fares',{p_booking_id:bookingId});
  if(data?.viewerId!==userId||data?.bookingId!==bookingId||!Number.isSafeInteger(data.fareMinor)||data.fareMinor<1||!Number.isSafeInteger(data.fareVersion)||!Array.isArray(data.offers)||!Number.isFinite(Date.parse(data.serverTime)))throw new Error('Fare details could not be verified. Refresh this request.');
  return data;
}
export async function proposeRideFare(userId: string,bookingId: string,requestId: string,amountMinor: number,fareVersion: number) {
  return request(userId,'matmove_propose_ride_fare',{p_booking_id:bookingId,p_request_id:requestId,p_amount_minor:amountMinor,p_fare_version:fareVersion});
}
export async function decideRideFare(userId: string,offerId: string,decision:'accept'|'decline'|'withdraw',fareVersion: number) {
  return request(userId,'matmove_decide_ride_fare',{p_offer_id:offerId,p_decision:decision,p_fare_version:fareVersion});
}
