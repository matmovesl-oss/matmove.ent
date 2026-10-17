
// Shared deterministic rules. This module never reads a wallet or makes a payment.
export const GAME_IDS = ['spin', 'dice', 'fruity', 'crankling'];
export const FRUITY_ATTEMPTS = 3;
export const FRUITY_PERIOD_MS = 24 * 60 * 60 * 1000;
export const FRUITY_PRIZE_MINOR = 5000;
export const CRANKLING_ATTEMPTS = 3;
export const CRANKLING_ENTRY_MINOR = 2000;
export const CRANKLING_PRIZE_MINOR = 5000;
export const FRUITS = [
 ['Apple','🍎'],['Pear','🍐'],['Orange','🍊'],['Lemon','🍋'],['Lime','🍋‍🟩'],
 ['Banana','🍌'],['Pineapple','🍍'],['Mango','🥭'],['Peach','🍑'],['Cherry','🍒'],
 ['Strawberry','🍓'],['Blueberry','🫐'],['Raspberry','🍓'],['Blackberry','🫐'],['Grape','🍇'],
 ['Watermelon','🍉'],['Cantaloupe','🍈'],['Honeydew','🍈'],['Kiwi','🥝'],['Coconut','🥥'],
 ['Papaya','🥭'],['Guava','🍐'],['Passion fruit','🟣'],['Dragon fruit','🌺'],['Pomegranate','🍎'],
 ['Grapefruit','🍊'],['Tangerine','🍊'],['Clementine','🍊'],['Apricot','🍑'],['Plum','🟣'],
 ['Nectarine','🍑'],['Fig','🟣'],['Date','🟤'],['Lychee','🔴'],['Rambutan','🔴'],
 ['Longan','🟤'],['Jackfruit','🟢'],['Durian','🟢'],['Starfruit','⭐'],['Soursop','🟢'],
 ['Custard apple','🟢'],['Tamarind','🟤'],['Persimmon','🍊'],['Cranberry','🔴'],['Gooseberry','🟢'],
 ['Mulberry','🟣'],['Blackcurrant','🟣'],['Redcurrant','🔴'],['Kumquat','🍊'],['Breadfruit','🟢'],
].map(([name, icon], id) => Object.freeze({id, name, icon}));

export function secureDraw(maximum, fill = values => globalThis.crypto.getRandomValues(values)) {
 if (!Number.isInteger(maximum) || maximum < 1 || maximum > 0x100000000) throw new Error('Invalid draw range.');
 const values = new Uint32Array(1), limit = Math.floor(0x100000000 / maximum) * maximum;
 do { fill(values); } while (values[0] >= limit);
 return values[0] % maximum;
}
function drawIndex(draw, count) {
 const result = draw(count);
 if (!Number.isInteger(result) || result < 0 || result >= count) throw new Error('Invalid random result.');
 return result;
}
export function fruityOutcome(draw = secureDraw) {
 const values = Array.from({length:4}, () => drawIndex(draw, FRUITS.length));
 return {values, prizeMinor:values.every(value => value === values[0]) ? FRUITY_PRIZE_MINOR : 0};
}
export function cranklingOutcome(luckyNumber, draw = secureDraw) {
 if (!Number.isInteger(luckyNumber) || luckyNumber < 1 || luckyNumber > 10) throw new Error('Choose a lucky number from 1 to 10.');
 const values = Array.from({length:3}, () => drawIndex(draw, 10) + 1);
 return {values, prizeMinor:values.every(value => value === luckyNumber) ? CRANKLING_PRIZE_MINOR : 0};
}
export function diceQuote(stakeMinor, target, comparison, returnBps = 9000) {
 if (!Number.isSafeInteger(stakeMinor) || stakeMinor < 100 || stakeMinor > 2000) throw new Error('Choose a stake from 1 to 20 credits.');
 if (!Number.isInteger(target) || target < 2 || target > 12 || !['above','equal','below'].includes(comparison)) throw new Error('Choose a valid dice prediction.');
 if (!Number.isInteger(returnBps) || returnBps < 1 || returnBps > 10000) throw new Error('Invalid payout settings.');
 let wins = 0;
 for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const sum = a + b;
  if (comparison === 'above' ? sum > target : comparison === 'below' ? sum < target : sum === target) wins++;
 }
 if (!wins) throw new Error('This prediction cannot win. Choose another target.');
 // The displayed two-decimal multiplier is also the exact multiplier applied.
 const multiplierHundredths = Math.floor(returnBps * 36 / (wins * 100));
 return {wins, combinations:36, probability:wins / 36, multiplierHundredths, payoutMinor:Math.floor(stakeMinor * multiplierHundredths / 100)};
}
export function diceOutcome(stakeMinor, target, comparison, draw = secureDraw) {
 const quote = diceQuote(stakeMinor, target, comparison);
 const values = [drawIndex(draw, 6) + 1, drawIndex(draw, 6) + 1], total = values[0] + values[1];
 const won = comparison === 'above' ? total > target : comparison === 'below' ? total < target : total === target;
 return {values, total, prizeMinor:won ? quote.payoutMinor : 0};
}
export function fruityWindow(value, now = Date.now()) {
 const startedAt = Number(value?.startedAt), used = Number(value?.used);
 if (!Number.isFinite(startedAt) || startedAt <= 0 || !Number.isInteger(used) || used < 0 || used > FRUITY_ATTEMPTS || now < startedAt || now >= startedAt + FRUITY_PERIOD_MS) return {startedAt:0, used:0};
 return {startedAt, used};
}
export function takeFruityAttempt(value, now = Date.now()) {
 const state = fruityWindow(value, now);
 if (state.used >= FRUITY_ATTEMPTS) throw new Error('Your three demo attempts are used. Wait for the 24-hour reset.');
 return {startedAt:state.startedAt || now, used:state.used + 1};
}
