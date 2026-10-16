
import { supabase } from '@/lib/supabase';
import type { AuthSession, UserRole } from '@/types';
import { normalizeCustomerPhone } from '../../shared/customer-access.js';

export function scopeOnboardingDraft(userId: string | null) {
  if (sessionStorage.getItem('ob_owner_id') !== userId) {
    Object.keys(sessionStorage).filter(key => key.startsWith('ob_')).forEach(key => sessionStorage.removeItem(key));
    if (userId) sessionStorage.setItem('ob_owner_id', userId);
  }
}

export async function getCustomerSession(): Promise<AuthSession | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user) { scopeOnboardingDraft(null); return null; }
  scopeOnboardingDraft(session.user.id);
  const result = await supabase.rpc('matmove_customer_me');
  if (result.error) throw new Error(result.error.message);
  if (result.data) {
    if (result.data.user?.id !== session.user.id || !Array.isArray(result.data.roles) ||
      result.data.roles.some((role: string) => !['rider','driver','merchant'].includes(role))) {
      throw new Error('This account cannot access the customer portal.');
    }
    return result.data as AuthSession;
  }
  // An actual Auth session exists, but phone and customer role still need completing.
  return { user: { id: session.user.id, email: session.user.email || '',
    phone: session.user.phone || session.user.user_metadata?.phone || '', firstName: '', lastName: '' },
    roles: [], kycStatus: 'not_started' };
}

export async function signUp(email: string, phone: string, password: string): Promise<AuthSession | null> {
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!email.trim() || !normalizedPhone || password.length < 8) throw new Error('Enter an email, valid phone number and password of at least 8 characters.');
  const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password,
    options: { data: { phone: normalizedPhone }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
  if (error) throw error;
  // Email confirmation must finish before any customer session is created.
  return data.session ? getCustomerSession() : null;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  const session = await getCustomerSession();
  if (!session) throw new Error('Sign-in was not confirmed. Please try again.');
  return session;
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` } });
  if (error) throw error;
}

export async function saveCustomerAccount(role: UserRole, phone: string): Promise<AuthSession> {
  const result = await supabase.rpc('matmove_save_customer_account', { p_role: role, p_phone: normalizeCustomerPhone(phone) });
  if (result.error) throw new Error(result.error.message);
  const session = await getCustomerSession();
  if (!session || session.roles.length !== 1 || session.roles[0] !== role) throw new Error('Account setup was not confirmed. Retry without creating another account.');
  sessionStorage.setItem('ob_role', role);
  return session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  scopeOnboardingDraft(null);
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/reset-password` });
  if (error) throw error;
}
