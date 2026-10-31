
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthSession, UserRole, KycStatus } from '@/types';
import * as auth from '@/services/authService';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  authError: string;
  refreshSession: () => Promise<AuthSession | null>;
  signUp: (email: string, phone: string, password: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveAccount: (role: UserRole, phone: string) => Promise<AuthSession>;
  setRoles: (roles: UserRole[]) => Promise<void>;
  completeKyc: (status: KycStatus) => Promise<void>;
  submitKycForReview: () => Promise<void>;
  resubmitKycForReview: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function customerPath(session: AuthSession): string {
  return session.roles.length === 1 && session.user.phone ? `/customer/${session.roles[0]}` : '/select-role';
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const revision = useRef(0);
  const navigate = useNavigate();
  const refreshSession = useCallback(async () => {
    const version = ++revision.current;
    try {
      const current = await auth.getCustomerSession();
      if (version === revision.current) { setSession(current); setAuthError(''); }
      return current;
    } catch (error) {
      if (version === revision.current) { setSession(null); setAuthError(error instanceof Error ? error.message : 'Unable to load your account.'); }
      throw error;
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const restore = () => {
      if (!mounted) return;
      void refreshSession().catch(() => {}).finally(() => { if (mounted) setLoading(false); });
    };
    restore();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, current) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !current) {
        revision.current++; setSession(null); setLoading(false); auth.scopeOnboardingDraft(null);
      } else { setTimeout(restore, 0); }
    });
    return () => { mounted = false; revision.current++; subscription.unsubscribe(); };
  }, [refreshSession]);
  const signUp = async (email: string, phone: string, password: string) => {
    const current = await auth.signUp(email, phone, password);
    setSession(current);
    if (current) navigate(customerPath(current));
    return !!current;
  };
  const signIn = async (email: string, password: string) => {
    const current = await auth.signIn(email, password); setSession(current); navigate(customerPath(current));
  };
  const signOut = async () => { await auth.signOut(); revision.current++; setSession(null); navigate('/'); };
  const saveAccount = async (role: UserRole, phone: string) => {
    const current = await auth.saveCustomerAccount(role, phone); setSession(current); return current;
  };
  const setRoles = async (roles: UserRole[]) => {
    if (!session || roles.length !== 1) throw new Error('Choose one customer account type.');
    await saveAccount(roles[0], session.user.phone);
  };
  const completeKyc = async (_status: KycStatus) => { await refreshSession(); };
  const submitKycForReview = async () => { navigate('/onboarding/review'); };
  const resubmitKycForReview = async () => {
    if (!session?.roles[0]) { navigate('/select-role'); return; }
    sessionStorage.setItem('ob_role', session.roles[0]); navigate('/onboarding/personal');
  };
  return <AuthContext.Provider value={{ session, loading, authError, refreshSession, signUp, signIn, signOut,
    saveAccount, setRoles, completeKyc, submitKycForReview, resubmitKycForReview, resetPassword: auth.resetPassword }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
