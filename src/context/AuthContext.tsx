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

function normalizeKycStatus(
  status: string | null | undefined
): KycStatus {
  const normalized =
    String(status || '')
      .trim()
      .toLowerCase();

  /*
   * Database status:
   *
   * not_started
   * draft
   * submitted
   * under_review
   * approved
   * rejected
   * resubmission_required
   *
   * Customer UI uses:
   *
   * not_started
   * draft
   * submitted
   * approved
   * declined
   *
   * Historical/internal review states are represented
   * to the customer as submitted/pending.
   */
  if (
    normalized === 'approved'
  ) {
    return 'approved';
  }

  if (
    normalized === 'rejected' ||
    normalized === 'declined'
  ) {
    return 'declined' as KycStatus;
  }

  if (
    normalized === 'draft'
  ) {
    return 'draft';
  }

  if (
    normalized === 'submitted' ||
    normalized === 'pending' ||
    normalized === 'under_review' ||
    normalized === 'resubmission_required' ||
    normalized === 'in_review' ||
    normalized === 'review'
  ) {
    return 'submitted';
  }

  return 'not_started';
}

function getPrimaryCustomerRole(
  session: AuthSession | null
): UserRole {
  if (!session) {
    return 'rider';
  }

  if (
    session.roles.includes(
      'driver'
    )
  ) {
    return 'driver';
  }

  if (
    session.roles.includes(
      'merchant'
    )
  ) {
    return 'merchant';
  }

  return 'rider';
}

function getCustomerPortalPath(
  session: AuthSession | null
): string {
  const role =
    getPrimaryCustomerRole(
      session
    );

  return `/customer/${role}`;
}

function getStoredDocuments():
  StoredKycDocument[] {
  try {
    const raw =
      sessionStorage.getItem(
        'ob_documents'
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return [];
    }

    return Object.values(
      parsed
    ).filter(
      (
        item
      ): item is StoredKycDocument => {
        if (
          !item ||
          typeof item !==
            'object'
        ) {
          return false;
        }

        const document =
          item as StoredKycDocument;

        return (
          typeof document.id ===
            'string' &&
          document.id.length > 0 &&
          document.id !== 'temp' &&
          typeof document.type ===
            'string' &&
          typeof document.fileName ===
            'string'
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
      JSON.parse(
        raw
      ) as StoredKycDocument;

    if (
      !parsed ||
      typeof parsed.id !==
        'string' ||
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

function readStoredPersonalInfo(): {
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
} {
  try {
    const raw =
      sessionStorage.getItem(
        'ob_personal'
      );

    if (!raw) {
      return {};
    }

    const parsed =
      JSON.parse(
        raw
      );

    if (
      !parsed ||
      typeof parsed !==
        'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    return {
      firstName:
        typeof parsed.firstName ===
        'string'
          ? parsed.firstName
          : '',

      lastName:
        typeof parsed.lastName ===
        'string'
          ? parsed.lastName
          : '',

      phone:
        typeof parsed.phone ===
        'string'
          ? parsed.phone
          : '',

      address:
        typeof parsed.address ===
        'string'
          ? parsed.address
          : '',
    };
  } catch (error) {
    console.error(
      'Could not read stored personal information:',
      error
    );

    return {};
  }
}

function normalizePhone(
  phone: string | null | undefined
): string {
  return String(phone || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCustomerRole(
  role: string | null | undefined
): UserRole {
  const normalized =
    String(role || '')
      .trim()
      .toLowerCase();

  if (
    normalized === 'driver'
  ) {
    return 'driver';
  }

  if (
    normalized === 'merchant' ||
    normalized === 'vendor'
  ) {
    return 'merchant';
  }

  return 'rider';
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] =
    useState<AuthSession | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const navigate =
    useNavigate();

  const restoreSession =
    useCallback(
      async () => {
        try {
          const {
            data: {
              session:
                supabaseSession,
            },
            error,
          } =
            await supabase.auth.getSession();

          if (error) {
            throw error;
          }

          if (
            !supabaseSession?.user
          ) {
            setSession(null);
            return null;
          }

          const userId =
            supabaseSession.user.id;

          /*
           * Load profile.
           */
          const {
            data: profile,
            error:
              profileError,
          } =
            await supabase
              .from('profiles')
              .select('*')
              .eq(
                'id',
                userId
              )
              .maybeSingle();

          if (
            profileError
          ) {
            throw profileError;
          }

          /*
           * Load roles.
           *
           * Customers can read their own roles,
           * but cannot write them directly.
           */
          const {
            data: rolesData,
            error:
              rolesError,
          } =
            await supabase
              .from('user_roles')
              .select('role')
              .eq(
                'profile_id',
                userId
              );

          if (
            rolesError
          ) {
            console.warn(
              'Could not restore user roles:',
              rolesError.message
            );
          }

          const roles =
            (rolesData || [])
              .map(
                (
                  item
                ) =>
                  String(
                    item.role
                  )
              )
              .map(
                normalizeCustomerRole
              );

          const uniqueRoles =
            Array.from(
              new Set(
                roles
              )
            );

          /*
           * Compatibility fallback for older profiles.
           */
          const profileRole =
            profile?.role
              ? normalizeCustomerRole(
                  String(
                    profile.role
                  )
                )
              : null;

          const resolvedRoles =
            uniqueRoles.length >
            0
              ? uniqueRoles
              : profileRole
                ? [
                    profileRole,
                  ]
                : [];

          /*
           * KYC submissions are authoritative.
           *
           * The latest submission takes precedence
           * over profiles.kyc_status.
           */
          const {
            data:
              latestSubmission,
            error:
              submissionError,
          } =
            await supabase
              .from(
                'kyc_submissions'
              )
              .select(
                'id,status,created_at'
              )
              .eq(
                'profile_id',
                userId
              )
              .order(
                'created_at',
                {
                  ascending:
                    false,
                }
              )
              .limit(1)
              .maybeSingle();

          if (
            submissionError
          ) {
            console.warn(
              'Could not restore latest KYC submission:',
              submissionError.message
            );
          }

          const authoritativeKycStatus =
            normalizeKycStatus(
              latestSubmission?.status ||
                profile?.kyc_status ||
                'not_started'
            );

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
              supabaseSession.user
                .user_metadata
                ?.phone ||
              supabaseSession.user
                .user_metadata
                ?.phone_number ||
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
            user:
              restoredUser,

            roles:
              resolvedRoles,

            kycStatus:
              authoritativeKycStatus,
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

  useEffect(
    () => {
      let mounted = true;

      const initialiseAuth =
        async () => {
          if (!mounted) {
            return;
          }

          await restoreSession();

          if (mounted) {
            setLoading(
              false
            );
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
              setLoading(
                false
              );
              return;
            }

            /*
             * Never await database requests directly
             * inside onAuthStateChange.
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
              setTimeout(
                () => {
                  if (!mounted) {
                    return;
                  }

                  restoreSession().catch(
                    (
                      error
                    ) => {
                      console.error(
                        'Failed to refresh session after auth event:',
                        error
                      );
                    }
                  );
                },
                0
              );
            }
          }
        );

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    },
    [
      restoreSession,
    ]
  );

  const signUp =
    useCallback(
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
          setLoading(
            false
          );
        }
      },
      [navigate]
    );

  const signIn =
    useCallback(
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
            getCustomerPortalPath(
              s
            )
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [navigate]
    );

  const signOut =
    useCallback(
      async () => {
        setLoading(true);

        try {
          await svcSignOut();

          setSession(null);

          navigate('/');
        } finally {
          setLoading(
            false
          );
        }
      },
      [navigate]
    );

  const setRoles =
    useCallback(
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
          setLoading(
            false
          );
        }
      },
      [session]
    );

  const completeKyc =
    useCallback(
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
          setLoading(
            false
          );
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

          const personalInfo =
            readStoredPersonalInfo();

          const storedRole =
            sessionStorage.getItem(
              'ob_role'
            );

          const role =
            normalizeCustomerRole(
              storedRole ||
                session.roles[0] ||
                'rider'
            );

          /*
           * Every customer role requires Admin review.
           *
           * No customer role is auto-approved.
           */
          const finalStatus =
            'submitted' as KycStatus;

          // ==================================================
          // 2. Read uploaded documents
          // ==================================================

          const storedDocuments =
            getStoredDocuments();

          const storedSelfie =
            getStoredSelfie();

          // ==================================================
          // 3. Resolve phone
          // ==================================================

          const normalizedPhone =
            normalizePhone(
              personalInfo.phone ||
                session.user.phone ||
                ''
            );

          // ==================================================
          // 4. Build secure RPC document payload
          // ==================================================

          const documentRows = [
            ...storedDocuments,
            ...(storedSelfie
              ? [storedSelfie]
              : []),
          ]
            .filter(
              (
                document,
                index,
                array
              ) =>
                document &&
                document.id &&
                document.id !==
                  'temp' &&
                array.findIndex(
                  (
                    item
                  ) =>
                    item.id ===
                    document.id
                ) === index
            )
            .map(
              (
                document
              ) => ({
                document_type:
                  document.type,

                storage_path:
                  document.id,

                file_name:
                  document.fileName,

                file_size_bytes:
                  document.fileSize,
              })
            );

          // ==================================================
          // 5. Call secure backend onboarding RPC
          // ==================================================
          /*
           * IMPORTANT:
           *
           * We no longer directly INSERT/DELETE user_roles.
           *
           * We no longer rely on the browser to change
           * profiles.role.
           *
           * submit_customer_kyc() is SECURITY DEFINER and
           * performs the controlled customer onboarding
           * transaction on the backend.
           */

          const {
            data:
              onboardingResult,
            error:
              onboardingError,
          } =
            await supabase.rpc(
              'submit_customer_kyc',
              {
                p_role:
                  role,

                p_first_name:
                  personalInfo.firstName ||
                  session.user.firstName ||
                  '',

                p_last_name:
                  personalInfo.lastName ||
                  session.user.lastName ||
                  '',

                p_phone:
                  normalizedPhone,

                p_address:
                  personalInfo.address ||
                  '',

                p_documents:
                  documentRows,
              }
            );

          if (
            onboardingError
          ) {
            throw new Error(
              `KYC submission failed: ${onboardingError.message}`
            );
          }

          if (
            !onboardingResult ||
            onboardingResult.success !==
              true
          ) {
            throw new Error(
              'KYC submission did not return a successful confirmation from MatMove.'
            );
          }

          // ==================================================
          // 6. Confirm authoritative backend result
          // ==================================================

          const returnedRole =
            normalizeCustomerRole(
              String(
                onboardingResult.role ||
                  role
              )
            );

          const returnedKycStatus =
            normalizeKycStatus(
              String(
                onboardingResult.kyc_status ||
                  finalStatus
              )
            );

          // ==================================================
          // 7. Update local session only
          // ==================================================

          const updatedSession:
            AuthSession = {
            ...session,

            roles: [
              returnedRole,
            ],

            kycStatus:
              returnedKycStatus,

            user: {
              ...session.user,

              phone:
                normalizedPhone ||
                session.user.phone ||
                '',

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
          // 8. Clear onboarding state
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
          // 9. Navigate to submitted state
          // ==================================================

          navigate(
            '/onboarding/submitted'
          );
        } catch (error: unknown) {
          console.error(
            'KYC submission error:',
            error
          );

          const message =
            error instanceof Error
              ? error.message
              : 'Unable to submit KYC for review.';

          alert(
            `KYC submission failed: ${message}`
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        session,
        navigate,
      ]
    );

  const resubmitKycForReview =
    useCallback(
      async () => {
        if (!session) {
          return;
        }

        setLoading(true);

        try {
          /*
           * Resubmission preparation remains local/draft.
           *
           * The actual new submission will go through
           * submit_customer_kyc() again.
           */
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
            'KYC resubmission preparation failed:',
            error
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        session,
        navigate,
      ]
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
          setLoading(
            false
          );
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
      value={
        value
      }
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