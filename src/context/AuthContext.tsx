import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AuthSession,
  UserRole,
  KycStatus,
} from '@/types';
import {
  signIn as svcSignIn,
  signUp as svcSignUp,
  signOut as svcSignOut,
  updateRoles,
  updateKycStatus,
  resetPassword as svcResetPassword,
} from '@/services/authService';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  signUp: (
    email: string,
    phone: string,
    password: string
  ) => Promise<void>;
  signIn: (
    email: string,
    password: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  setRoles: (
    roles: UserRole[]
  ) => Promise<void>;
  completeKyc: (
    status: KycStatus
  ) => Promise<void>;
  submitKycForReview: () => Promise<void>;
  resubmitKycForReview: () => Promise<void>;
  resetPassword: (
    email: string
  ) => Promise<void>;
}

const AuthContext =
  createContext<AuthContextValue | null>(null);

function getPrimaryCustomerRole(
  session: AuthSession | null
): UserRole {
  if (!session) {
    return 'rider';
  }

  if (session.roles.includes('driver')) {
    return 'driver';
  }

  if (session.roles.includes('merchant')) {
    return 'merchant';
  }

  return 'rider';
}

function getCustomerPortalPath(
  session: AuthSession | null
): string {
  const role =
    getPrimaryCustomerRole(session);

  return `/customer/${role}`;
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] =
    useState<AuthSession | null>(null);

  const [loading, setLoading] =
    useState(true);

  const navigate = useNavigate();

  const restoreSession = useCallback(
    async () => {
      try {
        const {
          data: {
            session: supabaseSession,
          },
          error,
        } =
          await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!supabaseSession?.user) {
          setSession(null);
          return null;
        }

        const userId =
          supabaseSession.user.id;

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (profileError) {
          throw profileError;
        }

        const {
          data: rolesData,
          error: rolesError,
        } =
          await supabase
            .from('user_roles')
            .select('role')
            .eq('profile_id', userId);

        if (rolesError) {
          console.warn(
            'Could not restore user roles:',
            rolesError.message
          );
        }

        const roles =
          (rolesData || [])
            .map(
              (item) => item.role
            )
            .filter(
              Boolean
            ) as UserRole[];

        const profileRole =
          profile?.role
            ? String(
                profile.role
              ).toLowerCase()
            : '';

        const resolvedRoles =
          roles.length > 0
            ? roles
            : profileRole
              ? [
                  profileRole as UserRole,
                ]
              : [];

        const restoredUser = {
          id: userId,
          email:
            profile?.email ||
            supabaseSession.user
              .email ||
            '',
          phone:
            profile?.phone ||
            supabaseSession.user
              .phone ||
            '',
          firstName:
            profile?.first_name ||
            '',
          lastName:
            profile?.last_name ||
            '',
        };

        const restoredSession:
          AuthSession = {
            user: restoredUser,
            roles: resolvedRoles,
            kycStatus:
              profile?.kyc_status ||
              'not_started',
          };

        setSession(
          restoredSession
        );

        return restoredSession;
      } catch (error) {
        console.error(
          'Failed to restore authentication session:',
          error
        );

        setSession(null);

        return null;
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const initialiseAuth =
      async () => {
        if (!mounted) {
          return;
        }

        await restoreSession();

        if (mounted) {
          setLoading(false);
        }
      };

    initialiseAuth();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (
          event,
          supabaseSession
        ) => {
          if (!mounted) {
            return;
          }

          if (
            event ===
              'SIGNED_OUT' ||
            !supabaseSession
          ) {
            setSession(null);
            setLoading(false);
            return;
          }

          /*
           * Do not await Supabase database requests
           * directly inside onAuthStateChange.
           *
           * The auth callback must finish first so that
           * signup/signin can complete without waiting
           * on another Supabase operation.
           */
          if (
            event ===
              'SIGNED_IN' ||
            event ===
              'TOKEN_REFRESHED' ||
            event ===
              'USER_UPDATED' ||
            event ===
              'INITIAL_SESSION'
          ) {
            setTimeout(() => {
              if (!mounted) {
                return;
              }

              restoreSession().catch(
                (error) => {
                  console.error(
                    'Failed to refresh session after auth event:',
                    error
                  );
                }
              );
            }, 0);
          }
        }
      );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [restoreSession]);

  const signUp = useCallback(
    async (
      email: string,
      phone: string,
      password: string
    ) => {
      setLoading(true);

      try {
        const s =
          await svcSignUp(
            email,
            phone,
            password
          );

        setSession(s);

        navigate(
          '/select-role'
        );
      } catch (error) {
        console.error(
          'Signup failed:',
          error
        );

        throw error;
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const signIn = useCallback(
    async (
      email: string,
      password: string
    ) => {
      setLoading(true);

      try {
        const s =
          await svcSignIn(
            email,
            password
          );

        setSession(s);

        navigate(
          getCustomerPortalPath(s)
        );
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const signOut = useCallback(
    async () => {
      setLoading(true);

      try {
        await svcSignOut();

        setSession(null);

        navigate('/');
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const setRoles = useCallback(
    async (
      roles: UserRole[]
    ) => {
      if (!session) {
        return;
      }

      setLoading(true);

      try {
        const updated =
          await updateRoles(
            session,
            roles
          );

        setSession(
          updated
        );
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  const completeKyc = useCallback(
    async (
      status: KycStatus
    ) => {
      if (!session) {
        return;
      }

      setLoading(true);

      try {
        const updated =
          await updateKycStatus(
            session,
            status
          );

        setSession(
          updated
        );
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  const submitKycForReview =
    useCallback(
      async () => {
        if (!session) {
          return;
        }

        setLoading(true);

        try {
          const personalInfo =
            JSON.parse(
              sessionStorage.getItem(
                'ob_personal'
              ) || '{}'
            );

          const storedRole =
            sessionStorage.getItem(
              'ob_role'
            );

          const role =
            storedRole ||
            session.roles[0] ||
            'rider';

          const finalStatus =
            role === 'rider'
              ? 'approved'
              : 'submitted';

          const {
            error:
              profileError,
          } =
            await supabase
              .from('profiles')
              .update({
                first_name:
                  personalInfo.firstName ||
                  '',
                last_name:
                  personalInfo.lastName ||
                  '',
                kyc_status:
                  finalStatus,
                role,
              })
              .eq(
                'id',
                session.user.id
              );

          if (profileError) {
            throw new Error(
              `Profile Update Failed: ${profileError.message}`
            );
          }

          const {
            error:
              roleDeleteError,
          } =
            await supabase
              .from('user_roles')
              .delete()
              .eq(
                'profile_id',
                session.user.id
              );

          if (
            roleDeleteError
          ) {
            console.warn(
              'Could not clear previous roles:',
              roleDeleteError.message
            );
          }

          const {
            error:
              roleInsertError,
          } =
            await supabase
              .from('user_roles')
              .insert({
                profile_id:
                  session.user.id,
                role,
              });

          if (
            roleInsertError
          ) {
            console.warn(
              'Could not synchronize onboarding role:',
              roleInsertError.message
            );
          }

          const {
            error:
              submissionError,
          } =
            await supabase
              .from(
                'kyc_submissions'
              )
              .insert({
                profile_id:
                  session.user.id,
                target_role:
                  role,
                status:
                  finalStatus,
              });

          if (
            submissionError
          ) {
            throw new Error(
              `Submission Insert Failed: ${submissionError.message}`
            );
          }

          const updatedRoles =
            [role] as UserRole[];

          const updatedSession:
            AuthSession = {
              ...session,
              roles:
                updatedRoles,
              kycStatus:
                finalStatus,
              user: {
                ...session.user,
              },
            };

          setSession(
            updatedSession
          );

          sessionStorage.removeItem(
            'ob_personal'
          );
          sessionStorage.removeItem(
            'ob_role'
          );
          sessionStorage.removeItem(
            'ob_identity'
          );
          sessionStorage.removeItem(
            'ob_documents'
          );
          sessionStorage.removeItem(
            'ob_selfie'
          );
          sessionStorage.removeItem(
            'ob_vehicle'
          );

          if (
            finalStatus ===
            'approved'
          ) {
            navigate(
              getCustomerPortalPath(
                updatedSession
              )
            );
          } else {
            navigate(
              '/onboarding/submitted'
            );
          }
        } catch (error: any) {
          console.error(
            'Submission error:',
            error
          );

          alert(
            `Error details: ${
              error.message ||
              JSON.stringify(
                error
              )
            }`
          );
        } finally {
          setLoading(false);
        }
      },
      [session, navigate]
    );

  const resubmitKycForReview =
    useCallback(
      async () => {
        if (!session) {
          return;
        }

        setLoading(true);

        try {
          const updated =
            await updateKycStatus(
              session,
              'draft'
            );

          setSession(
            updated
          );

          navigate(
            '/onboarding/personal'
          );
        } catch (error) {
          console.error(
            error
          );
        } finally {
          setLoading(false);
        }
      },
      [session, navigate]
    );

  const resetPassword =
    useCallback(
      async (
        email: string
      ) => {
        setLoading(true);

        try {
          await svcResetPassword(
            email
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );

  const value:
    AuthContextValue = {
    session,
    loading,
    signUp,
    signIn,
    signOut,
    setRoles,
    completeKyc,
    submitKycForReview,
    resubmitKycForReview,
    resetPassword,
  };

  return (
    <AuthContext.Provider
      value={value}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx =
    useContext(
      AuthContext
    );

  if (!ctx) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return ctx;
}