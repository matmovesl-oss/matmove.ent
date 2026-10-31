
import {HttpError,monime} from './wallet-security.js';
import {referralTreasuryId,referralBalance,matchesReferralReceipt,referralTransfer} from './referral-rules.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function rpc(db,name,args){const r=await db.rpc(name,args);if(r.error){const prefix=/^(FORBIDDEN|INVALID|CONFLICT|CAPACITY|PAUSED|NOT_FOUND):/;const m=String(r.error.message||'');if(prefix.test(m))throw new HttpError(m.startsWith('FORBIDDEN:')?403:409,m,m.split(':',1)[0]);throw new HttpError(503,'Referral payment storage is unavailable. Check the referral payment setup.');}return r.data;}
async function legs(db,newUser){const r=await db.from('matmove_referral_rewards').select('*').eq('new_user_id',newUser).order('kind');if(r.error||!Array.isArray(r.data)||r.data.length!==2)throw new HttpError(503,'Referral reward receipts are unavailable.');return r.data;}
export async function runReferralLeg(db,rewardId,provider=monime){
 const leg=await rpc(db,'matmove_referral_claim',{p_reward:rewardId});
 if(!leg||['completed','failed'].includes(leg.state)||(!leg.can_create&&!leg.provider_id))return leg;
 let receipt;
 try{receipt=leg.provider_id?await provider(`internal-transfers/${encodeURIComponent(leg.provider_id)}`):await provider('internal-transfers',referralTransfer(leg));}
 catch(error){if(leg.can_create)await rpc(db,'matmove_referral_record',{p_reward:leg.id,p_receipt:null});throw error;}
 // SQL repeats every match check; no status is trusted merely because the POST returned.
 const matches=matchesReferralReceipt(receipt,leg);
 return rpc(db,'matmove_referral_record',{p_reward:leg.id,p_receipt:matches?receipt:null});
}
export async function processReferral(db,newUser,{provider=monime,env=process.env}={}){
 if(!uuid.test(String(newUser||'')))throw new HttpError(400,'A valid referral customer ID is required.');
 let rewards=await legs(db,newUser);
 // Reconcile already-authorized transfers even if new payments are now paused.
 for(const leg of rewards)if(leg.provider_id&&!['completed','failed'].includes(leg.state))await runReferralLeg(db,leg.id,provider);
 rewards=await legs(db,newUser);
 const outstanding=rewards.filter(r=>!['completed','failed'].includes(r.state));
 if(!outstanding.length)return {newUserId:newUser,completed:rewards.filter(r=>r.state==='completed').length,reviewRequired:rewards.some(r=>r.state==='failed')};
 if(outstanding.some(r=>r.claimed_at&&!r.provider_id))return {newUserId:newUser,reviewRequired:true};
 // A known pending receipt was just polled. Do not poll it twice or start another payment while it remains unsettled.
 if(outstanding.some(r=>r.provider_id))return {newUserId:newUser,processing:true};
 const settings=await db.from('matmove_referral_campaign').select('*').eq('singleton',true).single();
 if(settings.error||!settings.data)throw new HttpError(503,'Referral campaign configuration is unavailable.');
 if(!settings.data.payments_enabled)return {newUserId:newUser,paused:true};
 const source=referralTreasuryId(env);if(settings.data.treasury_account!==source)throw new HttpError(503,'Referral campaign account does not match the configured treasury.');
 // Database checks both current KYC approvals, exact owners, unique links and freezes.
 const p=await rpc(db,'matmove_referral_participants',{p_new_user:newUser});
 if(p?.new_user_id!==newUser)throw new HttpError(503,'Referral participants could not be verified.');
 for(const person of [p.inviter,p.new_user]){
  if(!person||!uuid.test(person.user_id)||!uuid.test(person.wallet_id)||person.account_id===source)throw new HttpError(503,'Referral recipient ownership could not be verified.');
  const a=await provider(`financial-accounts/${encodeURIComponent(person.account_id)}`);
  if(a?.id!==person.account_id||a.currency!=='SLE')throw new HttpError(503,'The recipient SLE account could not be verified.');
 }
 const observed=new Date().toISOString();const treasury=await provider(`financial-accounts/${encodeURIComponent(source)}?withBalance=true`);
 await rpc(db,'matmove_referral_prepare',{p_new_user:newUser,p_source:source,p_balance:referralBalance(treasury,source),p_observed:observed});
 // Only a successful SQL claim may create a transfer. Other workers can only poll.
 for(const reward of await legs(db,newUser))if(!['completed','failed'].includes(reward.state))await runReferralLeg(db,reward.id,provider);
 rewards=await legs(db,newUser);return {newUserId:newUser,completed:rewards.filter(r=>r.state==='completed').length,reviewRequired:rewards.some(r=>['review_required','failed'].includes(r.state))};
}
export async function reconcileReferralBatch(db,options={}){
 // One pair per invocation bounds provider requests and protects server runtime capacity.
 const r=await db.from('matmove_referral_rewards').select('new_user_id').in('state',['pending','processing','review_required']).order('updated_at').limit(20);
 if(r.error||!Array.isArray(r.data))throw new HttpError(503,'Referral reconciliation queue is unavailable.');
 let checked=0,failed=0;
 for(const id of [...new Set(r.data.map(x=>x.new_user_id))].slice(0,1)){
  try{
   await processReferral(db,id,options);
   await rpc(db,'matmove_referral_defer',{p_new_user:id,p_error:null});checked++;
  }catch(error){
   // Only known SQL eligibility/capacity conditions are routine waiting. Fraud,
   // changed reservations, malformed receipts and provider/storage faults remain failures.
   const waiting=['CAPACITY','PAUSED'].includes(error.code)||error.code==='FORBIDDEN'&&[
    'FORBIDDEN: Both customers need approved verification and unfrozen wallets.',
    'FORBIDDEN: A confirmed KYC approval is required for both customers.',
    'FORBIDDEN: One owned SLE wallet is required.'
   ].includes(error.message);
   if(waiting){
    try{await rpc(db,'matmove_referral_defer',{p_new_user:id,p_error:error.message});checked++;}
    catch{failed++;}
   }else{
    failed++;
    await rpc(db,'matmove_referral_defer',{p_new_user:id,p_error:error.status&&error.status<500?error.message:'Referral processing needs a later check.'}).catch(()=>{});
   }
  }
 }
 return{checked,failed};
}
