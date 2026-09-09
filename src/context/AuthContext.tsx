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

interface StoredKycDocument {
  id: string;
  type: string;
  fileName: string;
  fileSize: number;
  status: 'uploaded';
}

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

function getStoredDocuments(): StoredKycDocument[] {
  try {
    const raw =
      sessionStorage.getItem(
        'ob_documents'
      );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return [];
    }

    return Object.values(parsed).filter(
      (item): item is StoredKycDocument => {
        if (
          !item ||
          typeof item !== 'object'
        ) {
          return false;
        }

        const document =
          item as StoredKycDocument;

        return (
          typeof document.id === 'string' &&
          document.id.length > 0 &&
          document.id !== 'temp' &&
          typeof document.type === 'string' &&
          typeof document.fileName === 'string'
        );
      }
    );
  } catch (error) {
    console.error(
      'Could not read stored KYC documents:',
      error
    );

    return [];
  }
}

function getStoredSelfie():
  | StoredKycDocument
  | null {
  try {
    const raw =
      sessionStorage.getItem(
        'ob_selfie'
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw) as StoredKycDocument;

    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      !parsed.id ||
      parsed.id === 'temp'
    ) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      'Could not read stored selfie metadata:',
      error
    );

    return null;
  }
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
          // ==================================================
          // 1. Read onboarding information
          // ==================================================

          let personalInfo: {
            firstName?: string;
            lastName?: string;
          } = {};

          try {
            personalInfo =
              JSON.parse(
                sessionStorage.getItem(
                  'ob_personal'
                ) || '{}'
              );
          } catch {
            personalInfo = {};
          }

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

          // ==================================================
          // 2. Read uploaded document metadata
          // ==================================================

          const storedDocuments =
            getStoredDocuments();

          const storedSelfie =
            getStoredSelfie();

          // ==================================================
          // 3. GUARANTEE THE PROFILE EXISTS
          // ==================================================
          /*
           * The previous implementation used UPDATE here.
           * UPDATE does nothing when the profile row does not
           * already exist. That caused the subsequent
           * user_roles INSERT to violate:
           *
           * user_roles_profile_id_fkey
           *
           * Upsert guarantees that the parent profiles row
           * exists before we create the child role record.
           */

          const {
            data:
              ensuredProfile,
            error:
              profileError,
          } =
            await supabase
              .from('profiles')
              .upsert(
                {
                  id:
                    session.user.id,
                  email:
                    session.user.email ||
                    '',
                  phone:
                    session.user.phone ||
                    '',
                  first_name:
                    personalInfo.firstName ||
                    session.user.firstName ||
                    '',
                  last_name:
                    personalInfo.lastName ||
                    session.user.lastName ||
                    '',
                  kyc_status:
                    finalStatus,
                  role,
                  updated_at:
                    new Date().toISOString(),
                },
                {
                  onConflict:
                    'id',
                }
              )
              .select('id')
              .single();

          if (profileError) {
            throw new Error(
              `Profile Synchronization Failed: ${profileError.message}`
            );
          }

          if (
            !ensuredProfile?.id
          ) {
            throw new Error(
              'Profile synchronization completed but no profile ID was returned.'
            );
          }

          // ==================================================
          // 4. Synchronize role
          // ==================================================

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
            throw new Error(
              `Role Cleanup Failed: ${roleDeleteError.message}`
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
                  ensuredProfile.id,
                role,
              });

          if (
            roleInsertError
          ) {
            throw new Error(
              `Role Synchronization Failed: ${roleInsertError.message}`
            );
          }

          // ==================================================
          // 5. Create KYC submission
          // ==================================================

          const {
            data:
              submission,
            error:
              submissionError,
          } =
            await supabase
              .from(
                'kyc_submissions'
              )
              .insert({
                profile_id:
                  ensuredProfile.id,
                target_role:
                  role,
                status:
                  finalStatus,
              })
              .select('id')
              .single();

          if (
            submissionError
          ) {
            throw new Error(
              `Submission Insert Failed: ${submissionError.message}`
            );
          }

          if (!submission?.id) {
            throw new Error(
              'KYC submission was created but no submission ID was returned.'
            );
          }

          // ==================================================
          // 6. Prepare KYC document records
          // ==================================================

          const documentRows = [
            ...storedDocuments,
            ...(storedSelfie
              ? [storedSelfie]
              : []),
          ]
            .filter(
              (document, index, array) =>
                document &&
                document.id &&
                document.id !== 'temp' &&
                array.findIndex(
                  (item) =>
                    item.id ===
                    document.id
                ) === index
            )
            .map(
              (document) => ({
                submission_id:
                  submission.id,
                document_type:
                  document.type,
                file_name:
                  document.fileName,
                storage_path:
                  document.id,
                file_size_bytes:
                  document.fileSize,
              })
            );

          // ==================================================
          // 7. Insert uploaded documents
          // ==================================================

          if (
            documentRows.length > 0
          ) {
            const {
              error:
                documentsError,
            } =
              await supabase
                .from(
                  'kyc_documents'
                )
                .insert(
                  documentRows
                );

            if (
              documentsError
            ) {
              throw new Error(
                `KYC Documents Insert Failed: ${documentsError.message}`
              );
            }
          }

          // ==================================================
          // 8. Build updated local session
          // ==================================================

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
                firstName:
                  personalInfo.firstName ||
                  session.user.firstName ||
                  '',
                lastName:
                  personalInfo.lastName ||
                  session.user.lastName ||
                  '',
              },
            };

          setSession(
            updatedSession
          );

          // ==================================================
          // 9. Clear onboarding state
          // ==================================================

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

          // ==================================================
          // 10. Navigate
          // ==================================================

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
        } catch (error: unknown) {
          console.error(
            'Submission error:',
            error
          );

          const message =
            error instanceof Error
              ? error.message
              : JSON.stringify(
                  error
                );

          alert(
            `Error details: ${message}`
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