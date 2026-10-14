
export interface SpinSector {digit:string;prizeMinor:number;weight?:number}
export interface SpinTier {entryMinor:number;spinCount:number;sectors:SpinSector[]}
export interface SpinOdds {prizeMinor:number;sectors:number;totalSectors:number;weight:number;totalWeight:number;probability:number}
export const SPIN_ENTRY_MINOR:number;
export const SPIN_COUNT:number;
export const SPIN_TIER_AMOUNTS:number[];
export const SPIN_PRIZES:number[];
export function validateSpinSectors(sectors:unknown):Array<SpinSector & {weight:number}>;
export function spinOdds(sectors:SpinSector[]):SpinOdds[];
export function spinEconomics(sectors:SpinSector[],entryMinor?:number):{expectedPrizeMinor:number;expectedRoundPrizeMinor:number;expectedMarginMinor:number;maximumRoundPrizeMinor:number};
export function validateSpinTiers(tiers:unknown):SpinTier[];
export function defaultSpinTiers():SpinTier[];
export function sampleSpinSector(sectors:SpinSector[],draw:(maximum:number)=>number):number;
export function spinSectorCenter(sectors:SpinSector[],index:number):number;
export function spinProfileEligibility(profile:any,wallets?:any[],now?:Date):{eligible:boolean;reason:string|null};
