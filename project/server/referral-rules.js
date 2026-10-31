
import {HttpError} from './wallet-security.js';
export const REFERRAL_REWARD_MINOR=100;
export const referralAccountId=value=>typeof value==='string'&&/^fac-[A-Za-z0-9_-]+$/.test(value);
export function referralTreasuryId(env=process.env){
 const id=env.MONIME_REFERRAL_ACCOUNT_ID;
 if(!referralAccountId(id)||[env.MONIME_SPIN_ACCOUNT_ID,env.MONIME_ESCROW_ACCOUNT_ID,env.MONIME_PLATFORM_FEE_ACCOUNT_ID,env.MONIME_MAIN_ACCOUNT_ID].filter(Boolean).includes(id))throw new HttpError(503,'Configure a separate SLE referral rewards account.');return id;
}
export function referralBalance(account,id){const v=account?.balance?.available;if(account?.id!==id||account.currency!=='SLE'||v?.currency!=='SLE'||!Number.isSafeInteger(v.value)||v.value<0)throw new HttpError(503,'The referral account and available SLE balance could not be verified.');return v.value;}
export function matchesReferralReceipt(receipt,leg){
 return typeof receipt?.id==='string'&&/^trn-[A-Za-z0-9_-]+$/.test(receipt.id)&&(!leg.provider_id||leg.provider_id===receipt.id)
 &&receipt.amount?.currency==='SLE'&&receipt.amount.value===REFERRAL_REWARD_MINOR
 &&receipt.sourceFinancialAccount?.id===leg.source_account&&receipt.destinationFinancialAccount?.id===leg.destination_account
 &&receipt.metadata?.matmoveReferralRewardId===leg.id&&receipt.metadata.matmoveReferralNewUserId===leg.new_user_id
 &&receipt.metadata.matmoveReferralKind===leg.kind&&receipt.metadata.matmoveReferralRequestKey===leg.request_key
 &&['pending','processing','completed','failed'].includes(receipt.status);
}
export function referralTransfer(leg){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!leg||![leg.id,leg.new_user_id,leg.request_key].every(v=>typeof v==='string'&&uuid.test(v))||!['inviter','new_user'].includes(leg.kind)||!referralAccountId(leg.source_account)||!referralAccountId(leg.destination_account)||leg.source_account===leg.destination_account||Number(leg.amount_minor)!==100||leg.currency!=='SLE')throw new HttpError(503,'Referral transfer reservation is invalid.');
 return {method:'POST',headers:{'Idempotency-Key':`matmove-referral:${leg.request_key}`},body:JSON.stringify({amount:{currency:'SLE',value:100},sourceFinancialAccount:{id:leg.source_account},destinationFinancialAccount:{id:leg.destination_account},description:'MatMove Invite & Earn reward',metadata:{matmoveReferralRewardId:leg.id,matmoveReferralNewUserId:leg.new_user_id,matmoveReferralKind:leg.kind,matmoveReferralRequestKey:leg.request_key}})};
}
