export function transactionDirection(
  tx: any
): 'credit' | 'debit' | 'unknown';

export function transactionTitle(
  tx: any
): string;

export function transactionAmount(
  tx: any
): string;

export function transactionReceipt(
  tx: any
): string;