
import {normalizeReferralCode,prepareReferralSignup} from '@/services/referralSignup';

import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { CarFront, ArrowRight, Mail, Lock, Phone, Eye, EyeOff, ShieldCheck, Zap, Fingerprint } from 'lucide-react';
import { AuthShell, AuthFormCard, AuthBackButton } from '@/components/AuthShell';
import { useAuth, customerPath } from '@/context/AuthContext';
import { signInWithGoogle, resetPassword } from '@/services/authService';

export function LoginPage() {
  const { signIn, signInWithPasskey, loading, authError } = useAuth();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeySupported = typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  const handlePasskeySignIn = async () => {
    if (!passkeySupported || passkeyBusy || busy || loading) return;
    setPasskeyBusy(true); setError('');
    try { await signInWithPasskey(); }
    catch (err: any) {
      const message = err?.name === 'AbortError' ? 'Passkey sign-in was cancelled. You can sign in with your password instead.' : (err?.message || 'Passkey sign-in could not be completed. Use your password or Google sign-in.');
      setError(message);
    } finally { setPasskeyBusy(false); }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) { setError('Enter your account email address first.'); return; }
    setResetBusy(true); setError(''); setResetNotice('');
    try { await resetPassword(email); setResetNotice('If an account exists for this email, a secure password reset link has been sent.'); }
    catch (err: any) { setError(err?.message || 'Could not request a password reset. Try again.'); }
    finally { setResetBusy(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please check your credentials.');
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <AuthBackButton label="Back to welcome" onClick={() => navigate('/')} />
      <AuthFormCard title="Sign in" subtitle="Welcome back. Let's get you moving.">
        <GoogleButton disabled={busy || loading || passkeyBusy} />
        <div className="my-4 flex items-center gap-3 text-xs font-semibold text-slate-400"><span className="h-px flex-1 bg-slate-200"/><span>OR USE YOUR DEVICE</span><span className="h-px flex-1 bg-slate-200"/></div>
        {passkeySupported ? <button type="button" onClick={() => void handlePasskeySignIn()} disabled={passkeyBusy || busy || loading} className="mb-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"><Fingerprint size={19}/>{passkeyBusy ? 'Waiting for device verification…' : 'Sign in with a passkey'}</button> : <p className="mb-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Passkey sign-in is not available in this browser or connection. Use your password or Google sign-in instead.</p>}
        {authError && <p role="alert" className="mb-4 text-red-700">{authError}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field"><span>Email address</span>
            <div className="input-field"><Mail size={17} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
          </label>
          
          <label className="field">
            <span>Password</span>
            <div className="input-field">
              <Lock size={17} />
              <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" className="input-toggle absolute right-4 top-3.5 text-slate-400" onClick={() => setShowPass(!showPass)}>
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          
          <div className="flex justify-end -mt-2"><button type="button" onClick={() => void handlePasswordReset()} disabled={resetBusy || busy || loading} className="text-sm font-semibold text-[#184f9a] hover:underline disabled:opacity-50">{resetBusy ? 'Sending reset link…' : 'Forgot password?'}</button></div>
          {resetNotice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{resetNotice}</p>}
          {error && <div role="alert" className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-lg border border-red-100">{error}</div>}
          <button className="primary-button full-button" type="submit" disabled={loading || busy}>
            {loading || busy ? <Zap size={17} className="animate-pulse" /> : null}
            {loading || busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-slate-600 text-sm">Don't have an account? <button className="font-semibold text-[#184f9a] hover:underline" onClick={() => navigate('/signup')}>Create one</button></p>
      </AuthFormCard>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp, loading } = useAuth();
  const [referral,setReferral]=useState(()=>{try{return new URLSearchParams(window.location.search).get('ref')||'';}catch{return '';}});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !phone || !password) { setError('All fields are required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setBusy(true);
    try {
      prepareReferralSignup(referral,'email',email);
      const signedIn = await signUp(email, phone, password);
      if (!signedIn) setNotice('Check your email to confirm your account, then return to sign in. Your dashboard opens after confirmation.');
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <AuthBackButton label="Back to welcome" onClick={() => navigate('/')} />
      <AuthFormCard title="Create your account" subtitle="Join MatMove in just a few steps.">
        <label className="mb-4 block text-sm font-semibold">Referral code (optional)<input aria-label="Signup referral code" value={referral} maxLength={30} autoComplete="off" onChange={e=>setReferral(e.target.value.toUpperCase())} placeholder="MM…" className="mt-1 min-h-11 w-full rounded-xl border p-3 text-base"/><span className="mt-1 block text-xs font-normal text-slate-500">Use a friend’s code when creating a new account. Rewards require verification and an active campaign.</span></label>{referral&&<button type="button" onClick={()=>setReferral('')} className="mb-3 min-h-11 text-sm font-semibold underline">Remove referral code</button>}
        <GoogleButton disabled={busy || loading} referral={referral}/>
        {notice && <p role="status" className="mb-4 rounded-xl bg-green-50 p-4 text-green-800">{notice}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field"><span>Email address</span>
            <div className="input-field"><Mail size={17} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
          </label>
          <label className="field"><span>Phone number</span>
            <div className="input-field"><Phone size={17} /><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+232 76 000 000" /></div>
          </label>
          <label className="field"><span>Password</span>
            <div className="input-field">
              <Lock size={17} />
              <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              <button type="button" className="input-toggle absolute right-4 top-3.5 text-slate-400" onClick={() => setShowPass(!showPass)}>
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <label className="field"><span>Confirm password</span>
            <div className="input-field"><Lock size={17} /><input type={showPass ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" /></div>
          </label>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-lg border border-red-100">{error}</div>}
          <button className="primary-button full-button" type="submit" disabled={loading || busy}>
            {loading || busy ? 'Creating account...' : 'Continue'} <ArrowRight size={17} />
          </button>
        </form>
        <p className="mt-6 text-center text-slate-600 text-sm">Already have an account? <button className="font-semibold text-[#184f9a] hover:underline" onClick={() => navigate('/login')}>Sign in</button></p>
      </AuthFormCard>
    </AuthShell>
  );
}
function GoogleButton({ disabled, referral }: { disabled: boolean;referral?:string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startGoogleAuth = () => {
    if (disabled || busy) return;
    try {
      if (referral !== undefined) prepareReferralSignup(normalizeReferralCode(referral), 'google');
    } catch (err: any) {
      setError(err?.message || 'The referral code could not be applied.');
      return;
    }
    setBusy(true);
    setError('');
    void signInWithGoogle().catch((err: any) => {
      setError(err?.message || 'Google sign-in is unavailable. Try email sign-in.');
      setBusy(false);
    });
  };
  return (
    <div className="mb-5">
      <button
        type="button"
        disabled={disabled || busy}
        aria-label="Continue with Google"
        onClick={startGoogleAuth}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#184f9a] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5 shrink-0" focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 37.97 46.98 31.84 46.98 24.55Z"/>
          <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a24 24 0 0 0 0 21.56l7.98-6.19Z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.45-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
        </svg>
        <span>{busy ? 'Opening Google…' : 'Continue with Google'}</span>
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function AuthCallbackPage() {
  const { refreshSession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const providerError = params.get('error_description') || fragment.get('error_description');
    const requestedNext = params.get('next');
    const recoveryNext = requestedNext === '/reset-passcode' ? '/reset-passcode' : '/reset-password';
    const recovery = params.get('type') === 'recovery' || requestedNext === '/reset-password' || requestedNext === '/reset-passcode';
    if (providerError) { setError(providerError); return; }
    // Supabase exchanges the one-time PKCE code before the session read completes.
    void refreshSession().then(current => {
      if (!mounted) return;
      if (!current) throw new Error('Sign-in was not confirmed. Please return to sign in.');
      navigate(recovery ? `${recoveryNext}?type=recovery` : customerPath(current), { replace: true });
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, [refreshSession, navigate]);
  return <AuthShell><AuthFormCard title={error ? 'Sign-in needs attention' : 'Completing sign-in'} subtitle="Your existing MatMove account and wallet stay linked.">
    {error ? <><p role="alert">{error}</p><button className="primary-button mt-4" onClick={() => navigate('/login', {replace:true})}>Return to sign in</button></> : <p role="status">Please wait…</p>}
  </AuthFormCard></AuthShell>;
}
