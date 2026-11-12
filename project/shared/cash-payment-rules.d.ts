export type CashRideSplit = Readonly<{
  currency: 'SLE';
  fareMinor: number;
  driverCashMinor: number;
  matmoveFeeMinor: number;
  fare: number;
  driverCash: number;
  matmoveFee: number;
}>;
export function moneyToMinor(value: string | number): number;
export function calculateCashRideSplit(fare: string | number): CashRideSplit;
