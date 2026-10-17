
import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError, assertAllowed, keyFor, verifiedAccount, monime, dbClient } from './wallet-security.js';
import { spinProfileEligibility } from '../shared/spin-rules.js';
import { ARCADE_GAMES, validateArcadeSettings, arcadeEntry, drawArcadeValues } from '../shared/arcade-payment-rules.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names={dice:'RICH DICE',fruity:'Fruity Flue',crankling:'CRANKLING'};
const terminal=new Set(['completed','failed','review_required']);
const samePrediction=(a,b)=>JSON.stringify(Object.entries(a||{}).sort(([x],[y])=>x.localeCompare(y)))===JSON.stringify(Object.entries(b||{}).sort(([x],[y])=>x.localeCompare(y)));
const isEnabled=()=>process.env.MATMOVE_SPIN_ENABLED==='true';
async function rpc(db,name,args={}) {
  const {data,error}=await db.rpc(name,args);
  if(error){
    const prefix=/^(INVALID|CONFLICT|FORBIDDEN|NOT_FOUND):/;
    if(prefix.test(error.message))throw new HttpError(error.message.startsWith('FORBIDDEN:')?403:409,error.message.replace(prefix,'').trim());
    console.error('MatMove arcade storage error',{function:name,code:error.code});
    throw new HttpError(503,'Game storage unavailable. Apply ARCADE_GAMES_SETUP.sql after the wheel migrations.');
  }
  return data;
}
export function arcadeBalance(account) {
  const b=account?.balance?.available;
  if(account?.currency!=='SLE'||b?.currency!=='SLE'||!Number.isSafeInteger(b?.value)||b.value<0)throw new HttpError(503,'The available SLE balance could not be verified.');
  return b.value;
}
async function configFor(db) {
  const {data,error}=await db.from('matmove_arcade_configs').select('*').order('id',{ascending:false}).limit(1);
  if(error||!data?.[0])throw new HttpError(503,'The new games have not been configured.');
  try{return {id:Number(data[0].id),settings:validateArcadeSettings(data[0].settings)};}catch{throw new HttpError(503,'Published game settings are invalid. Contact support.');}
}
export async function publicArcadeConfig(db) {
  const c=await configFor(db);
  // ONLY settings, never player identities, account IDs, balances or transfer keys.
  const wheel=await db.from('matmove_spin_configs').select('id,enabled,bundle_tiers').order('id',{ascending:false}).limit(1);
  if(wheel.error||!wheel.data?.[0]?.bundle_tiers)throw new HttpError(503,'The wheel preview settings are unavailable.');
  return {config:c,spin:{id:Number(wheel.data[0].id),enabled:wheel.data[0].enabled===true&&isEnabled(),tiers:wheel.data[0].bundle_tiers},moneyEnabled:isEnabled()};
}
async function readRound(db,id,userId) {
  if(!uuid.test(String(id||'')))throw new HttpError(400,'A valid game ID is required.');
  let q=db.from('matmove_arcade_rounds').select('*').eq('id',id);if(userId)q=q.eq('user_id',userId);
  const {data,error}=await q.maybeSingle();
  if(error)throw new HttpError(503,'Game receipt unavailable.');
  if(!data)throw new HttpError(404,'This game was not found for your account.');
  return data;
}
async function legsFor(db,id) {
  const {data,error}=await db.from('matmove_arcade_legs').select('*').eq('round_id',id).order('attempt_index');
  if(error)throw new HttpError(503,'Game payment receipts unavailable.');return data;
}
export function matchesArcadeReceipt(result,leg,game) {
  return typeof result?.id==='string'&&/^trn-[A-Za-z0-9_-]+$/.test(result.id)&&(!leg.provider_id||result.id===leg.provider_id)&&
    result.amount?.currency==='SLE'&&result.amount?.value===Number(leg.amount_minor)&&
    result.sourceFinancialAccount?.id===leg.source_account&&result.destinationFinancialAccount?.id===leg.destination_account&&
    result.metadata?.matmoveArcadeRoundId===leg.round_id&&result.metadata?.arcadeGame===game&&
    String(result.metadata?.attemptIndex)===String(leg.attempt_index)&&['pending','processing','completed','failed'].includes(result.status);
}
export async function runArcadeLeg(db,round,index,provider=monime) {
  const leg=await rpc(db,'matmove_arcade_claim',{p_id:round.id,p_index:index});
  if(!leg||terminal.has(leg.status)||(!leg.can_create&&!leg.provider_id))return;
  let receipt;
  try{
    receipt=leg.provider_id?await provider(`internal-transfers/${encodeURIComponent(leg.provider_id)}`):await provider('internal-transfers',{
      method:'POST',headers:{'Idempotency-Key':leg.request_key},body:JSON.stringify({
        amount:{currency:'SLE',value:Number(leg.amount_minor)},
        sourceFinancialAccount:{id:leg.source_account},destinationFinancialAccount:{id:leg.destination_account},
        description:`MatMove ${names[round.game]} — ${index===0?'entry':'winning'}`,
        metadata:{matmoveArcadeRoundId:round.id,arcadeGame:round.game,attemptIndex:String(index)},
      }),
    });
  }catch(error){
    if(leg.can_create)await rpc(db,'matmove_arcade_record',{p_id:round.id,p_index:index,p_provider:null,p_status:'review_required',p_error:'Provider response uncertain. Verify the ORIGINAL request key and attach its existing receipt; never resend.'});
    throw error;
  }
  const matches=matchesArcadeReceipt(receipt,leg,round.game);
  await rpc(db,'matmove_arcade_record',{p_id:round.id,p_index:index,p_provider:matches?receipt.id:leg.provider_id||null,p_status:matches?receipt.status:'review_required',p_error:matches?(receipt.failureDetail?.message||null):'Provider receipt does not match the game, exact amount, accounts or request metadata.'});
}
export async function reconcileArcadeRound(db,id,provider=monime) {
  const round=await readRound(db,id);
  if(terminal.has(round.state)||round.state==='active')return round;
  const leg=(await legsFor(db,id)).find(t=>t.status!=='completed');
  if(leg)await runArcadeLeg(db,round,Number(leg.attempt_index),provider);
  return readRound(db,id);
}
export async function arcadeSnapshot(db,round) {
  const [legs,result]=await Promise.all([legsFor(db,round.id),db.from('matmove_arcade_outcomes').select('*').eq('round_id',round.id).order('attempt_index')]);
  if(result.error)throw new HttpError(503,'Game outcomes unavailable.');
  const outcomes=result.data.map(o=>({index:o.attempt_index,values:o.reel_values,prizeMinor:Number(o.prize_minor),createdAt:o.created_at,paymentStatus:Number(o.prize_minor)===0?'not_applicable':legs.find(t=>t.attempt_index===o.attempt_index)?.status||'review_required'}));
  const receipts=legs.map(t=>({index:t.attempt_index,kind:t.kind,amountMinor:Number(t.amount_minor),providerId:t.provider_id,status:t.status,error:t.error}));
  return {id:round.id,game:round.game,state:round.state,configId:Number(round.config_id),rules:round.rules,prediction:round.prediction,entryMinor:Number(round.entry_minor),attemptCount:round.attempt_count,attemptsUsed:outcomes.length,expiresAt:round.expires_at,createdAt:round.created_at,paidMinor:receipts.filter(t=>t.kind==='win'&&t.status==='completed').reduce((n,t)=>n+t.amountMinor,0),error:round.error,outcomes,receipts};
}
async function respond(db,res,round) {return res.status(['entry_pending','win_pending'].includes(round.state)?202:200).json({round:await arcadeSnapshot(db,round)});}
function customerCanPlay(profile,wallets) {
  assertAllowed(profile,wallets,'payout');
  const eligible=spinProfileEligibility(profile,wallets);if(!eligible.eligible)throw new HttpError(403,eligible.reason);
}
function entryFor(game,prediction,settings) {
  try{return arcadeEntry(game,prediction,settings);}catch(e){throw new HttpError(400,e.message);}
}
export async function arcadeAction(req,res,{provider=monime,verifyAccount=verifiedAccount,draw=randomInt}={}) {
  const {db,user,profile,wallets}=req.matmove,b=req.body;
  if(b.action==='arcade_config'){
    const c=await configFor(db);
    const [open,free]=await Promise.all([
      db.from('matmove_arcade_rounds').select('*').eq('user_id',user.id).in('state',['entry_pending','active','win_pending','review_required']),
      db.from('matmove_arcade_rounds').select('*').eq('user_id',user.id).eq('game','fruity').order('created_at',{ascending:false}).limit(1),
    ]);
    if(open.error||free.error)throw new HttpError(503,'Your game history is unavailable.');
    const needed=[...open.data];
    const latestFree=free.data[0];
    if(latestFree&&Date.parse(latestFree.created_at)>Date.now()-86400000&&!needed.some(r=>r.id===latestFree.id))needed.push(latestFree);
    const eligible=spinProfileEligibility(profile,wallets),sle=wallets.filter(w=>w.currency==='SLE');
    let availableMinor=null,balanceError=null;
    if(sle.length===1){try{availableMinor=arcadeBalance(await verifyAccount(db,sle[0]));}catch{balanceError='Refresh to confirm your available SLE balance.';}}else balanceError='One owned SLE wallet is required.';
    return res.status(200).json({config:c,moneyEnabled:isEnabled(),eligibility:eligible,availableMinor,balanceError,rounds:await Promise.all(needed.map(r=>arcadeSnapshot(db,r)))});
  }
  if(b.action==='arcade_quote'){
    const c=await configFor(db);if(!ARCADE_GAMES.includes(b.game))throw new HttpError(400,'Choose a valid game.');
    return res.status(200).json({configId:c.id,game:b.game,rules:c.settings[b.game],enabled:c.settings[b.game].enabled&&isEnabled(),...entryFor(b.game,b.prediction,c.settings)});
  }
  if(b.action==='arcade_cancel'){
    const canceled=await rpc(db,'matmove_arcade_cancel',{p_key:keyFor(user.id,'arcade-entry',b.requestKey),p_user:user.id});
    if(canceled.canceled)return res.status(200).json(canceled);
    const owned=await readRound(db,canceled.roundId,user.id);return respond(db,res,await reconcileArcadeRound(db,owned.id,provider));
  }
  if(['arcade_status','arcade_draw'].includes(b.action)){
    let round=await readRound(db,b.roundId,user.id);
    if(b.action==='arcade_draw'){
      if(!Number.isInteger(b.attemptIndex)||b.attemptIndex<1||b.attemptIndex>round.attempt_count)throw new HttpError(400,'Invalid game attempt.');
      // Rules and outcomes come from the paid snapshot and server CSPRNG.
      // Repeated indices return their ORIGINAL outcome atomically in SQL.
      customerCanPlay(profile,wallets);
      await rpc(db,'matmove_arcade_draw',{p_id:round.id,p_user:user.id,p_index:b.attemptIndex,p_values:drawArcadeValues(round.game,draw)});
    }
    round=await reconcileArcadeRound(db,round.id,provider);return respond(db,res,round);
  }
  if(b.action!=='arcade_enter')throw new HttpError(400,'Invalid arcade action.');
  if(!ARCADE_GAMES.includes(b.game))throw new HttpError(400,'Choose a valid game.');
  const key=keyFor(user.id,'arcade-entry',b.requestKey);
  const original=await db.from('matmove_arcade_rounds').select('*').eq('request_key',key).maybeSingle();
  if(original.error)throw new HttpError(503,'Game request storage unavailable.');
  if(original.data){
    const r=original.data;
    // Canonicalize using ORIGINAL rules so new Admin prices cannot mutate a retry.
    const settings=validateArcadeSettings((await configFor(db)).settings);settings[r.game]=r.rules;
    const entry=entryFor(b.game,b.prediction,settings);
    if(r.user_id!==user.id||r.game!==b.game||Number(r.config_id)!==b.configId||Number(r.entry_minor)!==b.acceptedEntryMinor||!samePrediction(entry.prediction,r.prediction)||b.acceptRules!==true||(r.game==='dice'&&Number(r.reserve_minor)!==b.acceptedPayoutMinor))throw new HttpError(409,'This entry request changed. Keep the original receipt.');
    return respond(db,res,await reconcileArcadeRound(db,r.id,provider));
  }
  const c=await configFor(db),entry=entryFor(b.game,b.prediction,c.settings);
  if(!isEnabled()||!c.settings[b.game].enabled)throw new HttpError(409,'New entries for this game are paused.');
  if(b.acceptRules!==true||b.configId!==c.id||b.acceptedEntryMinor!==entry.entryMinor||(b.game==='dice'&&b.acceptedPayoutMinor!==entry.maximumPrizeMinor))throw new HttpError(409,'Review and accept the current entry amount and payout.');
  customerCanPlay(profile,wallets);
  const sle=wallets.filter(w=>w.currency==='SLE');if(sle.length!==1)throw new HttpError(409,'One owned SLE wallet is required.');
  const account=await verifyAccount(db,sle[0]);
  if(arcadeBalance(account)<entry.entryMinor)throw new HttpError(409,'Your available SLE balance is too low for this entry.');
  const spin=process.env.MONIME_SPIN_ACCOUNT_ID;
  if(!/^fac-[A-Za-z0-9_-]+$/.test(spin||'')||[account.id,process.env.MONIME_ESCROW_ACCOUNT_ID,process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID].includes(spin))throw new HttpError(503,'Configure a separate SLE Spin Account.');
  const linked=await db.from('wallets').select('id').or(`monime_account_id.eq.${spin},metadata->>monime_account_id.eq.${spin}`);
  if(linked.error||!Array.isArray(linked.data)||linked.data.length)throw new HttpError(503,'The Spin Account must not be a customer wallet.');
  const observed=new Date().toISOString(),treasury=await provider(`financial-accounts/${encodeURIComponent(spin)}?withBalance=true`);
  if(treasury.id!==spin)throw new HttpError(503,'The Spin Account could not be verified.');
  const round=await rpc(db,'matmove_arcade_prepare',{p_key:key,p_user:user.id,p_wallet:sle[0].id,p_config:c.id,p_game:b.game,p_prediction:entry.prediction,p_accepted:entry.entryMinor,p_accepted_prize:b.game==='dice'?entry.maximumPrizeMinor:null,p_source:account.id,p_spin:spin,p_balance:arcadeBalance(treasury),p_observed:observed});
  return respond(db,res,await reconcileArcadeRound(db,round.id,provider));
}
export async function reconcileArcadeBatch(db,provider=monime) {
  const {data,error}=await db.from('matmove_arcade_rounds').select('id').in('state',['entry_pending','win_pending']).order('updated_at').limit(5);
  if(error)throw new HttpError(503,'Game reconciliation storage unavailable.');
  // Sequential so account-level throttling cannot cause avoidable concurrent POSTs.
  let failed=0;for(const r of data){try{await reconcileArcadeRound(db,r.id,provider);}catch{failed++;}}
  return {checked:data.length,failed};
}
export async function reconcileArcades(req,res) {
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  const secret=process.env.CRON_SECRET,actual=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from(`Bearer ${secret||''}`);
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:'Unauthorized.'});
  try{const result=await reconcileArcadeBatch(dbClient());return res.status(result.failed?503:200).json(result);}catch{return res.status(503).json({error:'Game reconciliation unavailable.'});}
}
