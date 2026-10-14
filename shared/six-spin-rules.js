
export const SIX_MODE = 'six_v1';
export function validateSixSectors(input) {
  if (!Array.isArray(input) || input.length !== 6) throw new Error('Each wheel needs exactly six segments.');
  return input.map((s,i)=>{
    const kind=i<4?'cash':i===4?'again':'lose';
    if(!s||s.kind!==kind||s.digit!==String(i)||s.weight!==1||!Number.isSafeInteger(s.prizeMinor)||(kind==='cash'?(s.prizeMinor<100||s.prizeMinor>1000000||s.prizeMinor%100!==0):s.prizeMinor!==0))throw new Error('Use four whole-SLE prizes, one Spin again and one Better luck next time, with equal chances.');
    return {digit:String(i),kind,prizeMinor:s.prizeMinor,weight:1};
  });
}
export function validateSixTiers(input) {
  if(!Array.isArray(input)||input.length!==3)throw new Error('Configure three fee choices.');
  const seen=new Set();
  return input.map((t,i)=>{
    if(t?.id!==String(i)||!Number.isSafeInteger(t.entryMinor)||t.entryMinor<100||t.entryMinor>1000000||t.entryMinor%100!==0||seen.has(t.entryMinor))throw new Error('Each fee must be a distinct whole-SLE amount between SLE 1 and SLE 10,000.');
    seen.add(t.entryMinor);
    return {id:String(i),entryMinor:t.entryMinor,sectors:validateSixSectors(t.sectors)};
  });
}
export function defaultSixTiers() {
  return validateSixTiers([[500,[1000,2000,100,300]],[1000,[500,2000,200,400]],[2000,[1500,2500,300,400]]].map(([entryMinor,prizes],i)=>({id:String(i),entryMinor,sectors:[...prizes.map((prizeMinor,j)=>({digit:String(j),kind:'cash',prizeMinor,weight:1})),{digit:'4',kind:'again',prizeMinor:0,weight:1},{digit:'5',kind:'lose',prizeMinor:0,weight:1}]})));
}
export function sixLabel(s) {return s.kind==='again'?'Spin again':s.kind==='lose'?'Better luck next time':`SLE ${(s.prizeMinor/100).toFixed(2)}`;}
export function sampleSix(sectors,draw,bonus=false) {
  validateSixSectors(sectors);
  const indices=bonus?[0,1,2,3,5]:[0,1,2,3,4,5];
  const n=draw(indices.length);
  if(!Number.isSafeInteger(n)||n<0||n>=indices.length)throw new Error('Invalid random draw.');
  return indices[n];
}
export function sixEconomics(sectors,fee) {
  const cash=validateSixSectors(sectors).slice(0,4),sum=cash.reduce((n,s)=>n+s.prizeMinor,0);
  // One of six outcomes is a bonus: its five final outcomes have equal chances.
  const expected=sum/6+(1/6)*(sum/5);
  return {expectedPrizeMinor:expected,expectedMarginMinor:fee-expected,maximumPrizeMinor:Math.max(...cash.map(s=>s.prizeMinor))};
}
