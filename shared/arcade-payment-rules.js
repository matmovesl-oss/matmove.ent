
// Public, deterministic rules shared by the account games, Admin and demos.
// Money uses integer SLE cents. Random draws are supplied by the caller.
export const ARCADE_GAMES = ['dice', 'fruity', 'crankling'];
export function defaultArcadeSettings() {
  return {
    dice: {enabled:false,minStakeMinor:100,maxStakeMinor:2000,returnBps:9000,dailyEntryLimitMinor:10000},
    fruity: {enabled:false,prizeMinor:5000,attempts:3,periodHours:24},
    crankling: {enabled:false,entryMinor:2000,prizeMinor:5000,attempts:3,dailyEntryLimitMinor:10000},
  };
}
function integer(n, lo, hi) {return Number.isSafeInteger(n) && n >= lo && n <= hi;}
export function validateArcadeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'crankling,dice,fruity') throw new Error('Configure all three games.');
  const {dice:d,fruity:f,crankling:c}=input;
  for (const [game,keys] of [[d,['enabled','minStakeMinor','maxStakeMinor','returnBps','dailyEntryLimitMinor']],[f,['enabled','prizeMinor','attempts','periodHours']],[c,['enabled','entryMinor','prizeMinor','attempts','dailyEntryLimitMinor']]]) {
    if (!game || Array.isArray(game) || Object.keys(game).sort().join(',') !== keys.sort().join(',') || typeof game.enabled !== 'boolean') throw new Error('Invalid game settings.');
  }
  if (!integer(d.minStakeMinor,100,10000) || !integer(d.maxStakeMinor,d.minStakeMinor,10000) || !integer(d.returnBps,5000,10000) || !integer(d.dailyEntryLimitMinor,d.maxStakeMinor,100000)) throw new Error('Use valid dice stakes, a 50–100% target return and a daily limit.');
  if (!integer(f.prizeMinor,100,100000) || f.attempts!==3 || f.periodHours!==24) throw new Error('Fruity Flue uses three attempts per rolling 24 hours.');
  if (!integer(c.entryMinor,100,10000) || !integer(c.prizeMinor,100,100000) || c.attempts!==3 || !integer(c.dailyEntryLimitMinor,c.entryMinor,100000)) throw new Error('CRANKLING uses three attempts per purchase and valid SLE fees and prizes.');
  return structuredClone({dice:d,fruity:f,crankling:c});
}
export function arcadeEntry(game, input, settings) {
  const rules=validateArcadeSettings(settings)[game];
  if (!rules) throw new Error('Choose a valid game.');
  if (game==='fruity') return {entryMinor:0,attempts:3,maximumPrizeMinor:rules.prizeMinor*3,prediction:{}};
  if (game==='crankling') {
    if (!integer(input?.luckyNumber,1,10)) throw new Error('Choose your number from 1 to 10 before paying.');
    return {entryMinor:rules.entryMinor,attempts:3,maximumPrizeMinor:rules.prizeMinor*3,prediction:{luckyNumber:input.luckyNumber}};
  }
  const {stakeMinor,target,comparison}=input || {};
  if (!integer(stakeMinor,rules.minStakeMinor,rules.maxStakeMinor) || !integer(target,2,12) || !['above','equal','below'].includes(comparison)) throw new Error('Choose a published stake and a valid dice prediction.');
  let wins=0;
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)if(comparison==='above'?a+b>target:comparison==='below'?a+b<target:a+b===target)wins++;
  if (!wins) throw new Error('This prediction cannot win. Choose another target.');
  const multiplierHundredths=Math.floor(rules.returnBps*36/(wins*100));
  const payoutMinor=Math.floor(stakeMinor*multiplierHundredths/100);
  return {entryMinor:stakeMinor,attempts:1,maximumPrizeMinor:payoutMinor,prediction:{stakeMinor,target,comparison},quote:{wins,combinations:36,probability:wins/36,multiplierHundredths,payoutMinor}};
}
export function arcadeResult(game, values, prediction, rules) {
  const count=game==='fruity'?4:game==='crankling'?3:game==='dice'?2:0;
  if (!Array.isArray(values) || values.length!==count || !count || values.some(n=>!integer(n,game==='fruity'?0:1,game==='fruity'?49:game==='crankling'?10:6))) throw new Error('Invalid game outcome.');
  if (game==='fruity') return {values:[...values],won:values.every(n=>n===values[0]),prizeMinor:values.every(n=>n===values[0])?rules.prizeMinor:0};
  if (game==='crankling') return {values:[...values],won:values.every(n=>n===prediction.luckyNumber),prizeMinor:values.every(n=>n===prediction.luckyNumber)?rules.prizeMinor:0};
  const settings=defaultArcadeSettings();settings.dice=rules;
  const entry=arcadeEntry('dice',prediction,settings),total=values[0]+values[1];
  const won=prediction.comparison==='above'?total>prediction.target:prediction.comparison==='below'?total<prediction.target:total===prediction.target;
  return {values:[...values],total,won,prizeMinor:won?entry.maximumPrizeMinor:0};
}
export function drawArcadeValues(game,draw) {
  if (!ARCADE_GAMES.includes(game)) throw new Error('Choose a valid game.');
  const count=game==='fruity'?4:game==='crankling'?3:2,range=game==='fruity'?50:game==='crankling'?10:6;
  return Array.from({length:count},()=>{const n=draw(range);if(!integer(n,0,range-1))throw new Error('Invalid random draw.');return n+(game==='fruity'?0:1);});
}
export function arcadeOdds(game,rules,prediction={}) {
  if(game==='fruity')return {probability:1/125000,description:'Four matching fruits: 1 in 125,000 per attempt (50 equally likely fruit IDs on each independent reel).',grossPrizeMinor:rules.prizeMinor};
  if(game==='crankling')return {probability:1/1000,description:'All three reels match your chosen number: 1 in 1,000 per attempt.',grossPrizeMinor:rules.prizeMinor};
  const settings=defaultArcadeSettings();settings.dice=rules;return arcadeEntry('dice',prediction,settings).quote;
}
