import type { Wallet, Transaction, UserRole } from '@/types';

const mockTransactions: Transaction[] = [
  { id: 'TX-88421', type: 'Ride Payment', description: 'MM-1050 · Lumley to Waterloo', date: 'Today, 9:42 AM', amount: 18500, direction: 'out', status: 'Completed' },
  { id: 'TX-88394', type: 'Top Up', description: 'Orange Money wallet top up', date: '28 Aug 2026', amount: 100000, direction: 'in', status: 'Completed' },
];

export async function getWallet(userId: string): Promise<Wallet> {
  try {
    const res = await fetch(`/api/get-live-wallet?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch live balance');
    const data = await res.json();
    return { balance: data.balance || 0, currency: data.currency || 'SLE' };
  } catch (error) {
    console.error('Wallet Fetch Error:', error);
    return { balance: 0, currency: 'SLE' };
  }
}

export async function getTransactions(_userId: string): Promise<Transaction[]> {
  return mockTransactions;
}

export async function topUpWallet(_userId: string, amount: number): Promise<{ status: string; amount: number }> {
  return { status: 'Completed', amount };
}

export async function withdrawWallet(_userId: string, amount: number, _roles: UserRole[]): Promise<{ status: string; amount: number }> {
  return { status: 'Pending', amount };
}

export function canWithdraw(roles: UserRole[]): boolean {
  return roles.includes('driver') || roles.includes('merchant');
}