import type { PersonalInfo, AuthUser } from '@/types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getProfile(userId: string): Promise<AuthUser> {
  await delay(400);
  return {
    id: userId,
    email: 'aisha.kamara@email.com',
    phone: '+232 76 442 108',
    firstName: 'Aisha',
    lastName: 'Kamara',
  };
}

export async function updateProfile(
  userId: string,
  info: Partial<PersonalInfo>
): Promise<AuthUser> {
  await delay(600);
  return {
    id: userId,
    email: info.email ?? 'aisha.kamara@email.com',
    phone: info.phone ?? '+232 76 442 108',
    firstName: info.firstName ?? 'Aisha',
    lastName: info.lastName ?? 'Kamara',
  };
}
