import { supabase } from '@/lib/supabase';
import type { AuthSession, AuthUser, UserRole } from '@/types';

export async function signUp(
  email: string,
  phone: string,
  password: string
): Promise<AuthSession> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.trim();

  const { data: authData, error: authError } =
    await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          phone: normalizedPhone,
        },
      },
    });

  if (authError) {
    throw new Error(authError.message);
  }

  if (!authData.user) {
    throw new Error('Account creation failed.');
  }

  /*
   * Profile creation is handled by the database/authentication
   * flow. Do not perform a second client-side profile upsert here.
   *
   * This keeps signup from becoming dependent on a second
   * database request immediately after authentication.
   */

  const user: AuthUser = {
    id: authData.user.id,
    email: normalizedEmail,
    phone: normalizedPhone,
    firstName: '',
    lastName: '',
  };

  return {
    user,
    roles: [],
    kycStatus: 'not_started',
  };
}

export async function signIn(
  email: string,
  password: string
): Promise<AuthSession> {
  const normalizedEmail = email.trim().toLowerCase();

  const {
    data: authData,
    error: authError,
  } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (authError) {
    throw new Error('Invalid email or password.');
  }

  if (!authData.user) {
    throw new Error('Login failed.');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();

  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('profile_id', authData.user.id);

  const roles =
    (rolesData?.map(
      (r) => r.role
    ) as UserRole[]) || [];

  const user: AuthUser = {
    id: authData.user.id,
    email:
      authData.user.email ||
      normalizedEmail,
    phone:
      profile?.phone ||
      authData.user.phone ||
      '',
    firstName:
      profile?.first_name || '',
    lastName:
      profile?.last_name || '',
  };

  return {
    user,
    roles,
    kycStatus:
      profile?.kyc_status ||
      'not_started',
  };
}

export async function signOut(): Promise<void> {
  const { error } =
    await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateRoles(
  session: AuthSession,
  roles: UserRole[]
): Promise<AuthSession> {
  await supabase
    .from('user_roles')
    .delete()
    .eq(
      'profile_id',
      session.user.id
    );

  const roleInserts = roles.map(
    (role) => ({
      profile_id:
        session.user.id,
      role,
    })
  );

  const { error } =
    await supabase
      .from('user_roles')
      .insert(roleInserts);

  if (error) {
    console.warn(
      'Database role warning:',
      error.message
    );
  }

  return {
    ...session,
    roles,
  };
}

export async function updateKycStatus(
  session: AuthSession,
  kycStatus: AuthSession['kycStatus']
): Promise<AuthSession> {
  const { error } =
    await supabase
      .from('profiles')
      .update({
        kyc_status: kycStatus,
      })
      .eq(
        'id',
        session.user.id
      );

  if (error) {
    throw new Error(
      'Failed to update KYC status.'
    );
  }

  return {
    ...session,
    kycStatus,
  };
}

export async function resetPassword(
  email: string
): Promise<void> {
  const normalizedEmail =
    email.trim().toLowerCase();

  const { error } =
    await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo:
          `${window.location.origin}/reset-password`,
      }
    );

  if (error) {
    throw new Error(
      error.message
    );
  }
}