
export type GameId = 'spin'|'dice'|'fruity'|'crankling';
export type Comparison = 'above'|'equal'|'below';
export type Draw = (maximum:number)=>number;
export interface Fruit {readonly id:number;readonly name:string;readonly icon:string}
export interface FruityWindow {startedAt:number;used:number}
export interface ReelOutcome {values:number[];prizeMinor:number}
export const GAME_IDS:GameId[];
export const FRUITS:Fruit[];
export const FRUITY_ATTEMPTS:number;
export const FRUITY_PERIOD_MS:number;
export const FRUITY_PRIZE_MINOR:number;
export const CRANKLING_ATTEMPTS:number;
export const CRANKLING_ENTRY_MINOR:number;
export const CRANKLING_PRIZE_MINOR:number;
export function secureDraw(maximum:number,fill?:(values:Uint32Array)=>unknown):number;
export function fruityOutcome(draw?:Draw):ReelOutcome;
export function cranklingOutcome(luckyNumber:number,draw?:Draw):ReelOutcome;
export function diceQuote(stakeMinor:number,target:number,comparison:Comparison,returnBps?:number):{wins:number;combinations:number;probability:number;multiplierHundredths:number;payoutMinor:number};
export function diceOutcome(stakeMinor:number,target:number,comparison:Comparison,draw?:Draw):ReelOutcome&{total:number};
export function fruityWindow(value:unknown,now?:number):FruityWindow;
export function takeFruityAttempt(value:unknown,now?:number):FruityWindow;
