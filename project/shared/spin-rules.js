
export const SPIN_ENTRY_MINOR = 500; // Legacy/default price, not a hardcoded charge.
export const SPIN_COUNT = 3;
export const SPIN_TIER_AMOUNTS = [500,1000,2000];
export const SPIN_PRIZES = [...Array.from({length:20},(_,i)=>(i+1)*100),5000];
const legacyPrizes = [100,500,1000,1500,2000];

export function validateSpinSectors(sectors) {
  if(!Array.isArray(sectors)||sectors.length<5||sectors.length>120) throw new Error('Use between 5 and 120 wheel numbers.');
  const labels=new Set();let total=0;
  const clean=sectors.map(s=>{
    const weight=s?.weight===undefined?1:s.weight;
    if(!s||typeof s.digit!=='string'||!/^\d{1,3}$/.test(s.digit)||labels.has(s.digit)||!SPIN_PRIZES.includes(s.prizeMinor)||!Number.isSafeInteger(weight)||weight<1||weight>1000000) throw new Error('Use unique digits, valid prizes and positive integer probability weights.');
    labels.add(s.digit);total+=weight;return {digit:s.digit,prizeMinor:s.prizeMinor,weight};
  });
  if(total>1000000)throw new Error('Total probability weight must not exceed 1,000,000.');
  const required=clean.some(s=>s.prizeMinor===5000)?SPIN_PRIZES:legacyPrizes;
  if(required.some(p=>!clean.some(s=>s.prizeMinor===p)))throw new Error(required===legacyPrizes?'All five legacy prizes must appear.':'All prizes SLE 1–20 and SLE 50 must appear.');
  return clean;
}
export function spinOdds(sectors) {
  const clean=validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  return [...new Set(clean.map(s=>s.prizeMinor))].sort((a,b)=>a-b).map(prizeMinor=>{
    const weight=clean.filter(s=>s.prizeMinor===prizeMinor).reduce((n,s)=>n+s.weight,0);
    return {prizeMinor,sectors:clean.filter(s=>s.prizeMinor===prizeMinor).length,totalSectors:clean.length,weight,totalWeight:total,probability:weight/total};
  });
}
export function spinEconomics(sectors,entryMinor=SPIN_ENTRY_MINOR) {
  const clean=validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  const expectedPrizeMinor=clean.reduce((n,s)=>n+s.prizeMinor*s.weight,0)/total;
  return {expectedPrizeMinor,expectedRoundPrizeMinor:expectedPrizeMinor*SPIN_COUNT,expectedMarginMinor:entryMinor-expectedPrizeMinor*SPIN_COUNT,maximumRoundPrizeMinor:Math.max(...clean.map(s=>s.prizeMinor))*SPIN_COUNT};
}
export function validateSpinTiers(tiers) {
  if(!Array.isArray(tiers)||tiers.length!==3)throw new Error('Configure exactly SLE 5, 10 and 20 bundles.');
  const clean=SPIN_TIER_AMOUNTS.map(entryMinor=>{
    const matches=tiers.filter(t=>t?.entryMinor===entryMinor);
    if(matches.length!==1||matches[0].spinCount!==3)throw new Error('Each price must purchase exactly three spins.');
    const sectors=validateSpinSectors(matches[0].sectors);
    if(!sectors.some(s=>s.prizeMinor===5000))throw new Error('SLE 50 must be available in every tier.');
    return {entryMinor,spinCount:SPIN_COUNT,sectors};
  });
  for(let i=1;i<clean.length;i++){
    const previous=spinOdds(clean[i-1].sectors).find(o=>o.prizeMinor===5000);
    const next=spinOdds(clean[i].sectors).find(o=>o.prizeMinor===5000);
    if(BigInt(next.weight)*BigInt(previous.totalWeight)<=BigInt(previous.weight)*BigInt(next.totalWeight))throw new Error('Higher-priced bundles must have a strictly higher SLE 50 chance per spin.');
  }
  return clean;
}
export function defaultSpinTiers() {
  // 30,000 probability units permit exact 70% expected bundle payouts.
  return validateSpinTiers([[500,30,2],[1000,150,3],[2000,600,5]].map(([entryMinor,jackpotWeight,supportPrize])=>{
    const sectors=SPIN_PRIZES.map((prizeMinor,i)=>({digit:String(i),prizeMinor,weight:prizeMinor===5000?jackpotWeight:1}));
    sectors[0].weight+=30000-sectors.reduce((n,s)=>n+s.weight,0);
    const target=entryMinor*70; // Weighted cents target: 70% entry / 3 * 30000.
    let excess=target-sectors.reduce((n,s)=>n+s.prizeMinor*s.weight,0)/100;
    const units=Math.floor(excess/(supportPrize-1));
    sectors[0].weight-=units;sectors[supportPrize-1].weight+=units;
    excess-=units*(supportPrize-1);
    if(excess){sectors[0].weight--;sectors[excess].weight++;}
    return {entryMinor,spinCount:3,sectors};
  }));
}
export function sampleSpinSector(sectors,draw) {
  const clean=validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  let value=draw(total);
  if(!Number.isSafeInteger(value)||value<0||value>=total)throw new Error('Invalid random draw.');
  for(let i=0;i<clean.length;i++){if(value<clean[i].weight)return i;value-=clean[i].weight;}
  throw new Error('Invalid wheel.');
}
export function spinSectorCenter(sectors,index) {
  const clean=validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  return (clean.slice(0,index).reduce((n,s)=>n+s.weight,0)+clean[index].weight/2)/total*360;
}
export function spinProfileEligibility(profile,wallets=[],now=new Date()) {
  const date=String(profile?.date_of_birth||'');
  const [y,m,d]=date.split('-').map(Number);
  const birthday=new Date(Date.UTC(y,m-1,d));
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(date)&&birthday.getUTCFullYear()===y&&birthday.getUTCMonth()===m-1&&birthday.getUTCDate()===d;
  const adult=valid&&(now.getUTCFullYear()-y-((now.getUTCMonth()+1<m||(now.getUTCMonth()+1===m&&now.getUTCDate()<d))?1:0))>=18;
  if(!adult)return {eligible:false,reason:'A valid adult date of birth is required in your customer profile.'};
  if(profile?.kyc_status!=='approved')return {eligible:false,reason:'Complete your existing customer identity verification first.'};
  if(profile?.is_wallet_frozen||wallets.some(w=>w.is_frozen))return {eligible:false,reason:'Your wallet is frozen. Contact support.'};
  return {eligible:true,reason:null};
}
