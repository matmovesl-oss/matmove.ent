
export type ArcadeGame = 'dice'|'fruity'|'crankling';
export type DiceRules = {enabled:boolean;minStakeMinor:number;maxStakeMinor:number;returnBps:number;dailyEntryLimitMinor:number};
export type FruityRules = {enabled:boolean;prizeMinor:number;attempts:3;periodHours:24};
export type CranklingRules = {enabled:boolean;entryMinor:number;prizeMinor:number;attempts:3;dailyEntryLimitMinor:number};
export type ArcadeSettings = {dice:DiceRules;fruity:FruityRules;crankling:CranklingRules};
export type ArcadePrediction = {stakeMinor?:number;target?:number;comparison?:'above'|'equal'|'below';luckyNumber?:number};
export type DiceQuote = {wins:number;combinations:number;probability:number;multiplierHundredths:number;payoutMinor:number};
export type ArcadeEntry = {entryMinor:number;attempts:number;maximumPrizeMinor:number;prediction:ArcadePrediction;quote?:DiceQuote};
export const ARCADE_GAMES: ArcadeGame[];
export function defaultArcadeSettings(): ArcadeSettings;
export function validateArcadeSettings(input: unknown): ArcadeSettings;
export function arcadeEntry(game:ArcadeGame,input:ArcadePrediction,settings:ArcadeSettings): ArcadeEntry;
export function arcadeResult(game:ArcadeGame,values:number[],prediction:ArcadePrediction,rules:DiceRules|FruityRules|CranklingRules): {values:number[];total?:number;won:boolean;prizeMinor:number};
export function drawArcadeValues(game:ArcadeGame,draw:(maximum:number)=>number): number[];
export function arcadeOdds(game:ArcadeGame,rules:DiceRules|FruityRules|CranklingRules,prediction?:ArcadePrediction): DiceQuote | {probability:number;description:string;grossPrizeMinor:number};
