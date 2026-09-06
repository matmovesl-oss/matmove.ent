import type { UserRole } from '@/types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getUserRoles(_userId: string): Promise<UserRole[]> {
  await delay(300);
  return ['rider'];
}

export async function addRole(
  _userId: string,
  role: UserRole
): Promise<UserRole[]> {
  await delay(500);
  return ['rider', role];
}

export async function removeRole(
  _userId: string,
  _role: UserRole
): Promise<UserRole[]> {
  await delay(400);
  return ['rider'];
}

export const roleLabels: Record<UserRole, string> = {
  rider: 'Rider / Customer',
  driver: 'Driver',
  merchant: 'Merchant',
};

export const roleDescriptions: Record<UserRole, string> = {
  rider: 'Book rides, deliveries, and scheduled services',
  driver: 'Drive and earn with MatMove',
  merchant: 'Receive payments and manage your business',
};
