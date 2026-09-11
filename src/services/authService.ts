import { supabase } from '@/lib/supabase';
import type {
  AuthSession,
  AuthUser,
  UserRole,
} from '@/types';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

function normalizeRole(
  role: unknown
): UserRole | null {
  const value = String(role || '')
    .trim()
    .toLowerCase();

  if (
    value === 'rider' ||
    value === 'driver' ||
    value === 'merchant'
  ) {
    return value;
  }

  return null;
}

function normalizeRoles(
  roles: unknown[]
): UserRole[] {
  const normalized = roles
    .map(normalizeRole)
    .filter(
      (role): role is UserRole =>
        role !== null
    );

  return Array.from(
    new Set(normalized)
  );
}

export async function signUp(
  email: string,
  phone: string,
  password: string
): Promise<AuthSession> {
  const normalizedEmail =
    normalizeEmail(email);

  const normalizedPhone =
    normalizePhone(phone);

  if (!normalizedEmail) {
    throw new Error(
      'Email address is required.'
    );
  }

  if (!normalizedPhone) {
    throw new Error(
      'Phone number is required.'
    );
  }

  if (!password) {
    throw new Error(
      'Password is required.'
    );
  }

  const {
    data: authData,
    error: authError,
  } =
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
    throw new Error(
      authError.message
    );
  }

  if (!authData.user) {
    throw new Error(
      'Account creation failed.'
    );
  }

  /*
   * Profile creation is handled by the
   * database/authentication flow.
   *
   * We deliberately do not perform a
   * second profile upsert here.
   *
   * This keeps signup independent from
   * additional database writes and avoids
   * signup hanging while auth callbacks
   * are still completing.
   */

  const user: AuthUser = {
    id: authData.user.id,
    email:
      authData.user.email ||
      normalizedEmail,
    phone:
      authData.user.phone ||
      normalizedPhone,
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
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Email address is required.'
    );
  }

  if (!password) {
    throw new Error(
      'Password is required.'
    );
  }

  const {
    data: authData,
    error: authError,
  } =
    await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

  if (authError) {
    throw new Error(
      'Invalid email or password.'
    );
  }

  if (!authData.user) {
    throw new Error(
      'Login failed.'
    );
  }

  const {
    data: profile,
    error: profileError,
  } =
    await supabase
      .from('profiles')
      .select(
        'id,email,phone,first_name,last_name,kyc_status,role'
      )
      .eq(
        'id',
        authData.user.id
      )
      .maybeSingle();

  if (profileError) {
    console.warn(
      'Could not load profile after sign in:',
      profileError.message
    );
  }

  const {
    data: rolesData,
    error: rolesError,
  } =
    await supabase
      .from('user_roles')
      .select('role')
      .eq(
        'profile_id',
        authData.user.id
      );

  if (rolesError) {
    console.warn(
      'Could not load user roles after sign in:',
      rolesError.message
    );
  }

  const databaseRoles =
    normalizeRoles(
      (rolesData || []).map(
        (item) => item.role
      )
    );

  const profileRole =
    normalizeRole(
      profile?.role
    );

  /*
   * user_roles is authoritative when
   * available. The profile role is only
   * used as a compatibility fallback for
   * older records.
   */
  const roles =
    databaseRoles.length > 0
      ? databaseRoles
      : profileRole
        ? [profileRole]
        : [];

  const user: AuthUser = {
    id: authData.user.id,
    email:
      profile?.email ||
      authData.user.email ||
      normalizedEmail,
    phone:
      profile?.phone ||
      authData.user.phone ||
      '',
    firstName:
      profile?.first_name ||
      '',
    lastName:
      profile?.last_name ||
      '',
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
  const {
    error,
  } =
    await supabase.auth.signOut();

  if (error) {
    throw new Error(
      error.message
    );
  }
}

/**
 * Customer role changes are deliberately
 * not performed through direct browser
 * writes.
 *
 * Role governance is controlled by the
 * backend/Admin security layer.
 *
 * This function remains for compatibility
 * with the current AuthContext interface.
 * It updates the local session only.
 *
 * Actual persisted role assignment is
 * handled by the secured onboarding flow
 * / backend role-governance RPC.
 */
export async function updateRoles(
  session: AuthSession,
  roles: UserRole[]
): Promise<AuthSession> {
  const normalizedRoles =
    normalizeRoles(
      roles
    );

  if (
    normalizedRoles.length === 0
  ) {
    throw new Error(
      'At least one valid customer role is required.'
    );
  }

  if (
    normalizedRoles.includes(
      'admin' as UserRole
    )
  ) {
    throw new Error(
      'Administrator roles cannot be assigned from the customer application.'
    );
  }

  return {
    ...session,
    roles:
      normalizedRoles,
  };
}

export async function updateKycStatus(
  session: AuthSession,
  kycStatus: AuthSession['kycStatus']
): Promise<AuthSession> {
  const {
    error,
  } =
    await supabase
      .from('profiles')
      .update({
        kyc_status:
          kycStatus,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        session.user.id
      );

  if (error) {
    throw new Error(
      `Failed to update KYC status: ${error.message}`
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
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Email address is required.'
    );
  }

  const {
    error,
  } =
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