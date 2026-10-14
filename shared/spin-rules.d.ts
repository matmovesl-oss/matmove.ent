
export interface SpinSector { digit: string; prizeMinor: number }
export const SPIN_ENTRY_MINOR: number;
export const SPIN_COUNT: number;
export const SPIN_PRIZES: number[];
export function validateSpinSectors(sectors: unknown): SpinSector[];
export function spinOdds(sectors: SpinSector[]): Array<{prizeMinor: number; sectors: number; totalSectors: number; probability: number}>;
export function spinEconomics(sectors: SpinSector[]): {expectedPrizeMinor: number; expectedRoundPrizeMinor: number; expectedMarginMinor: number; maximumRoundPrizeMinor: number};
