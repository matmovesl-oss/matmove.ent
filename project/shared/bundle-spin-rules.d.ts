
export interface BundleSector {digit:string;kind:'cash'|'again'|'lose';prizeMinor:number;weight:1}
export interface BundleTier {id:string;entryMinor:number;paidSpins:number;sectors:BundleSector[]}
export const BUNDLE_MODE:string;
export const BUNDLE_SPIN_COUNTS:number[];
export function validateBundleSectors(input:unknown,tierId:string|number):BundleSector[];
export function validateBundleTiers(input:unknown):BundleTier[];
export function defaultBundleTiers():BundleTier[];
export function bundleLabel(s:BundleSector):string;
export function sampleBundle(sectors:BundleSector[],draw:(maximum:number)=>number,bonus?:boolean):number;
export function bundleEconomics(tier:BundleTier):{expectedPrizeMinor:number;expectedMarginMinor:number;maximumPrizeMinor:number};
