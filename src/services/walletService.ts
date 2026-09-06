import type { Wallet, Transaction, UserRole } from '@/types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockTransactions: Transaction[] = [
  { id: 'TX-88421', type: 'Ride Payment', description: 'MM-1050 · Lumley to Waterloo', date: 'Today, 9:42 AM', amount: 18500, direction: 'out', status: 'Completed' },
  { id: 'TX-88394', type: 'Top Up', description: 'Orange Money wallet top up', date: '28 Aug 2026', amount: 100000, direction: 'in', status: 'Completed' },
  { id: 'TX-88376', type: 'Delivery Payment', description: 'MM-1047 · Congo Cross to Wilberforce', date: '28 Aug 2026', amount: 75000, direction: 'out', status: 'Completed' },
  { id: 'TX-88104', type: 'Promotion Credit', description: 'Welcome to MatMove', date: '18 Aug 2026', amount: 25000, direction: 'in', status: 'Completed' },
  { id: 'TX-87982', type: 'Ride Payment', description: 'MM-1038 · Hill Station to Central', date: '25 Aug 2026', amount: 22000, direction: 'out', status: 'Completed' },
];

export async function getWallet(_userId: string): Promise<Wallet> {
  await delay(400);
  return { balance: 185000, currency: 'SLE' };
}

export async function getTransactions(_userId: string): Promise<Transaction[]> {
  await delay(400);
  return mockTransactions;
}

export async function topUpWallet(
  _userId: string,
  amount: number
): Promise<{ status: string; amount: number }> {
  await delay(1000);
  return { status: 'Completed', amount };
}

export async function withdrawWallet(
  _userId: string,
  amount: number,
  _roles: UserRole[]
): Promise<{ status: string; amount: number }> {
  await delay(1200);
  return { status: 'Pending', amount };
}

export function canWithdraw(roles: UserRole[]): boolean {
  return roles.includes('driver') || roles.includes('merchant');
}
