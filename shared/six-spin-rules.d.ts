
export interface SixSector {digit:string;kind:'cash'|'again'|'lose';prizeMinor:number;weight:1}
export interface SixTier {id:string;entryMinor:number;sectors:SixSector[]}
export const SIX_MODE:string;
export function validateSixSectors(input:unknown):SixSector[];
export function validateSixTiers(input:unknown):SixTier[];
export function defaultSixTiers():SixTier[];
export function sixLabel(s:SixSector):string;
export function sampleSix(sectors:SixSector[],draw:(maximum:number)=>number,bonus?:boolean):number;
export function sixEconomics(sectors:SixSector[],fee:number):{expectedPrizeMinor:number;expectedMarginMinor:number;maximumPrizeMinor:number};
