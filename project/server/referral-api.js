
import {timingSafeEqual} from 'node:crypto';
import {dbClient,HttpError,assertMonimeEnvironment} from './wallet-security.js';
import {resolveCustomerRole} from '../shared/customer-access.js';
import {reconcileReferralBatch} from './referral-payments.js';
import {referralTreasuryId} from './referral-rules.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states=new Set(['pending','processing','completed','review_required','failed']);
function noStore(res){res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');}
function queryKeys(req,expected){return Object.keys(req.query||{}).every(k=>expected.includes(k))&&Object.values(req.query||{}).every(v=>typeof v==='string');}
// Referral requests have a shorter timeout than general wallet operations so one pair fits a bounded job.
export async function referralProvider(path,options={}){
 assertMonimeEnvironment();
 if(!process.env.MONIME_API_KEY||!process.env.MONIME_SPACE_ID)throw new HttpError(503,'Referral provider configuration is incomplete.');
 if(options.method!==undefined&&!['GET','POST'].includes(options.method))throw new HttpError(503,'Invalid referral provider method.');
 const post=options.method==='POST';
 if(post?path!=='internal-transfers':!/^financial-accounts\/fac-[A-Za-z0-9_-]+(?:\?withBalance=true)?$/.test(path)&&!/^internal-transfers\/trn-[A-Za-z0-9_-]+$/.test(path))throw new HttpError(503,'Invalid referral provider request.');
 const r=await fetch(`https://api.monime.io/v1/${path}`,{...options,signal:AbortSignal.timeout(8000),headers:{...options.headers,Authorization:`Bearer ${process.env.MONIME_API_KEY}`,'Monime-Space-Id':process.env.MONIME_SPACE_ID,'Monime-Version':'caph.2025-08-23','Content-Type':'application/json'}});
 const b=await r.json().catch(()=>null);if(!r.ok||!b?.result)throw new HttpError(503,'The original referral transfer could not be confirmed.');return b.result;
}
export function createReferralApi({database=dbClient,provider=referralProvider,reconcile=reconcileReferralBatch,env=process.env}={}){
 return {
 async status(req,res){
  noStore(res);if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  const body=req.body;
  if(!queryKeys(req,[])||!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(body,'action')||body.action!=='referral_status'||Object.keys(body).some(k=>!['action','userId'].includes(k)))return res.status(400).json({error:'Invalid referral status request.'});
  try{
   const token=/^Bearer ([^\s]+)$/.exec(String(req.headers?.authorization||''));if(!token)throw new HttpError(401,'Sign in to view your referrals.');
   const db=database(),auth=await db.auth.getUser(token[1]),id=auth.data?.user?.id;
   if(auth.error||!uuid.test(id||''))throw new HttpError(401,'Your session expired. Sign in again.');
   if(body.userId!==undefined&&body.userId!==id)throw new HttpError(403,'This referral status does not belong to your account.');
   const [profile,roles,staff]=await Promise.all([db.from('profiles').select('id,role').eq('id',id).maybeSingle(),db.from('user_roles').select('role').eq('profile_id',id),db.from('matmove_staff_access').select('id,is_active,removed_at').eq('id',id).maybeSingle()]);
   if(profile.error||roles.error||staff.error||!Array.isArray(roles.data))throw new HttpError(503,'Your referral access could not be verified.');
   if(profile.data?.id!==id||!resolveCustomerRole(profile.data,roles.data)||staff.data?.is_active&&!staff.data?.removed_at)throw new HttpError(403,'Customer referral access is required.');
   // No wallet reads/writes: frozen or incomplete-KYC customers can still inspect their own status.
   const r=await db.from('matmove_referral_rewards').select('id,beneficiary_id,kind,amount_minor,currency,state,provider_id,created_at').eq('beneficiary_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51);
   if(r.error||!Array.isArray(r.data))throw new HttpError(503,'Your reward history is temporarily unavailable.');
   const ids=new Set();const rewards=r.data.slice(0,50).map(row=>{
    if(row.beneficiary_id!==id||!uuid.test(row.id||'')||ids.has(row.id)||!['inviter','new_user'].includes(row.kind)||String(row.amount_minor)!=='100'||row.currency!=='SLE'||!states.has(row.state)||!Number.isFinite(Date.parse(row.created_at))||row.state==='completed'&&!/^trn-[A-Za-z0-9_-]+$/.test(row.provider_id||''))throw new HttpError(503,'Your reward history could not be verified.');
    ids.add(row.id);return {id:row.id,kind:row.kind,amountMinor:'100',currency:'SLE',state:row.state,createdAt:row.created_at};
   });
   return res.status(200).json({userId:id,rewards,hasMore:r.data.length>50});
  }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Your referral status is temporarily unavailable.'});}
 },
 async reconcile(req,res){
  noStore(res);if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  if(!queryKeys(req,['action','probe','challenge'])||req.query?.action!=='referral_reconcile'||
   (req.query.probe!==undefined && (req.query.probe!=='true'||!uuid.test(req.query.challenge||'')))||
   (req.query.probe===undefined && req.query.challenge!==undefined))return res.status(400).json({error:'Invalid referral reconciliation request.'});
  const secret=env.CRON_SECRET,header=req.headers?.authorization;
  if(typeof secret!=='string'||!secret||typeof header!=='string'||header.length>1024)return res.status(401).json({error:'Unauthorized.'});
  const a=Buffer.from(header),b=Buffer.from(`Bearer ${secret}`);if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized.'});
  try{
   if(req.query.probe==='true'){
    // A connection probe verifies deployment/configuration, never a provider call or money claim.
    if(secret.length<32||!env.MONIME_API_KEY||!env.MONIME_SPACE_ID||env.MONIME_ENVIRONMENT!=='live')throw new HttpError(503,'Worker production settings are incomplete.');
    const sourceAccount=referralTreasuryId(env);
    const ready=await database().rpc('matmove_referral_scheduler_ready');
    if(ready.error||ready.data!==true)throw new HttpError(503,'Worker schema is unavailable.');
    return res.status(200).json({service:'matmove-referrals-v1',challenge:req.query.challenge,sourceAccount,schemaReady:true});
   }
   const result=await reconcile(database(),{provider,env});return res.status(result.failed?503:200).json({checked:result.checked,failed:result.failed});}
  catch{return res.status(503).json({error:'Referral reconciliation is temporarily unavailable.'});}
 }
 };
}
const api=createReferralApi();
export const referralStatus=(req,res)=>api.status(req,res);
export const reconcileReferrals=(req,res)=>api.reconcile(req,res);
