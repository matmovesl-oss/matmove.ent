import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthSession, UserRole, KycStatus } from '@/types';
import { signIn as svcSignIn, signUp as svcSignUp, signOut as svcSignOut, updateRoles, updateKycStatus, resetPassword as svcResetPassword } from '@/services/authService';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  signUp: (email: string, phone: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setRoles: (roles: UserRole[]) => Promise<void>;
  completeKyc: (status: KycStatus) => Promise<void>;
  submitKycForReview: () => Promise<void>;
  resubmitKycForReview: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const signUp = useCallback(async (email: string, phone: string, password: string) => {
    setLoading(true);
    try {
      const s = await svcSignUp(email, phone, password);
      setSession(s);
      navigate('/select-role');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const s = await svcSignIn(email, password);
      setSession(s);
      navigate('/customer');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await svcSignOut();
      setSession(null);
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const setRoles = useCallback(async (roles: UserRole[]) => {
    if (!session) return;
    setLoading(true);
    try {
      const updated = await updateRoles(session, roles);
      setSession(updated);
    } finally {
      setLoading(false);
    }
  }, [session]);

  const completeKyc = useCallback(async (status: KycStatus) => {
    if (!session) return;
    setLoading(true);
    try {
      const updated = await updateKycStatus(session, status);
      setSession(updated);
    } finally {
      setLoading(false);
    }
  }, [session]);

  const submitKycForReview = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const personalInfo = JSON.parse(sessionStorage.getItem('ob_personal') || '{}');
      const role = sessionStorage.getItem('ob_role') || session.roles[0] || 'rider';
      const finalStatus = role === 'rider' ? 'approved' : 'submitted';

      // 1. Update Profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          first_name: personalInfo.firstName || '',
          last_name: personalInfo.lastName || '',
          kyc_status: finalStatus
        })
        .eq('id', session.user.id);

      if (profileError) {
        throw new Error(`Profile Update Failed: ${profileError.message}`);
      }

      // 2. Insert Submission
      const { error: submissionError } = await supabase
        .from('kyc_submissions')
        .insert({
          profile_id: session.user.id,
          target_role: role,
          status: finalStatus
        });

      if (submissionError) {
        throw new Error(`Submission Insert Failed: ${submissionError.message}`);
      }

      // Success
      setSession({ ...session, kycStatus: finalStatus });
      sessionStorage.clear();
      
      if (finalStatus === 'approved') {
        navigate('/customer');
      } else {
        navigate('/onboarding/submitted');
      }
    } catch (error: any) {
      console.error('Submission error:', error);
      // This will popup the EXACT database error so we know what to fix
      alert(`Error details: ${error.message || JSON.stringify(error)}`);
    } finally {
      setLoading(false);
    }
  }, [session, navigate]);

  const resubmitKycForReview = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const updated = await updateKycStatus(session, 'draft');
      setSession(updated);
      navigate('/onboarding/personal');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [session, navigate]);

  const resetPassword = useCallback(async (email: string) => {
    setLoading(true);
    try {
      await svcResetPassword(email);
    } finally {
      setLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    session, loading,
    signUp, signIn, signOut, setRoles, completeKyc, submitKycForReview, resubmitKycForReview, resetPassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}