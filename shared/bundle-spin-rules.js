
export const BUNDLE_MODE = 'bundle_v2';
export const BUNDLE_SPIN_COUNTS = [1, 1, 1];
export function validateBundleSectors(input, tierId) {
  const i = Number(tierId), length = i === 1 ? 6 : 5;
  if (![0,1,2].includes(i) || !Array.isArray(input) || input.length !== length) throw new Error('Use five segments for wheels 1 and 3, and six for wheel 2.');
  return input.map((s,j) => {
    const kind = i === 0 && j === 4 ? 'again' : i === 1 && j === 5 ? 'lose' : 'cash';
    if (!s || s.digit !== String(j) || s.kind !== kind || s.weight !== 1 || !Number.isSafeInteger(s.prizeMinor) || (kind === 'cash' ? s.prizeMinor < 100 || s.prizeMinor > 1000000 || s.prizeMinor % 100 !== 0 : s.prizeMinor !== 0)) throw new Error('Use whole-SLE cash prizes and the fixed special segments, with equal chances.');
    return {digit:String(j),kind,prizeMinor:s.prizeMinor,weight:1};
  });
}
export function validateBundleTiers(input) {
  if (!Array.isArray(input) || input.length !== 3) throw new Error('Configure three entry fees.');
  const fees = new Set();
  return input.map((t,i) => {
    if (t?.id !== String(i) || t.paidSpins !== BUNDLE_SPIN_COUNTS[i] || !Number.isSafeInteger(t.entryMinor) || t.entryMinor < 100 || t.entryMinor > 1000000 || t.entryMinor % 100 !== 0 || fees.has(t.entryMinor)) throw new Error('Use distinct whole-SLE fees and one paid spin for each fee.');
    fees.add(t.entryMinor);
    return {id:String(i),entryMinor:t.entryMinor,paidSpins:t.paidSpins,sectors:validateBundleSectors(t.sectors,i)};
  });
}
export function defaultBundleTiers() {
  const prizes = [[100,300,1000,500],[500,700,1500,400,2000],[1500,1800,1200,2500,2000]];
  return validateBundleTiers([500,1000,2000].map((entryMinor,i) => ({id:String(i),entryMinor,paidSpins:BUNDLE_SPIN_COUNTS[i],sectors:[...prizes[i].map((prizeMinor,j)=>({digit:String(j),kind:'cash',prizeMinor,weight:1})),...(i<2?[{digit:String(prizes[i].length),kind:i===0?'again':'lose',prizeMinor:0,weight:1}]:[])]})));
}
export function bundleLabel(s) {return s.kind==='again'?'Spin again':s.kind==='lose'?'Better luck next time':`SLE ${(s.prizeMinor/100).toFixed(2)}`;}
export function sampleBundle(sectors, draw, bonus=false) {
  const indices=sectors.map((_,i)=>i).filter(i=>!bonus||sectors[i].kind!=='again');
  if (!indices.length) throw new Error('No playable sectors.');
  const n=draw(indices.length);
  if (!Number.isSafeInteger(n)||n<0||n>=indices.length) throw new Error('Invalid random draw.');
  return indices[n];
}
export function bundleEconomics(tier) {
  const i=Number(tier.id);
  if(![0,1,2].includes(i)||tier.paidSpins!==BUNDLE_SPIN_COUNTS[i]||!Number.isSafeInteger(tier.entryMinor)||tier.entryMinor<100||tier.entryMinor>1000000||tier.entryMinor%100!==0)throw new Error('Invalid tier.');
  const clean={...tier,sectors:validateBundleSectors(tier.sectors,i)};
  const cash=clean.sectors.filter(s=>s.kind==='cash'),sum=cash.reduce((n,s)=>n+s.prizeMinor,0),n=clean.sectors.length;
  const expectedPerSpin=sum/n+(clean.sectors.some(s=>s.kind==='again')?sum/(n*(n-1)):0);
  const expected=expectedPerSpin*clean.paidSpins;
  return {expectedPrizeMinor:expected,expectedMarginMinor:clean.entryMinor-expected,maximumPrizeMinor:Math.max(...cash.map(s=>s.prizeMinor))*clean.paidSpins};
}
