
import {normalizeReferralCode,prepareReferralSignup} from '@/services/referralSignup';

import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { CarFront, ArrowRight, Mail, Lock, Phone, Eye, EyeOff, ShieldCheck, Zap } from 'lucide-react';
import { AuthShell, AuthFormCard, AuthBackButton } from '@/components/AuthShell';
import { useAuth, customerPath } from '@/context/AuthContext';
import { signInWithGoogle } from '@/services/authService';

export function LoginPage() {
  const { signIn, loading, authError } = useAuth();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

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
        <GoogleButton disabled={busy || loading} />
        {authError && <p role="alert" className="mb-4 text-red-700">{authError}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field"><span>Email address</span>
            <div className="input-field"><Mail size={17} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></div>
          </label>
          
          <label className="field">
            {/* Added Forgot Password Link Here */}
            <div className="flex justify-between items-center w-full">
              <span>Password</span>
              <button 
                type="button" 
                onClick={() => navigate('/forgot-password')} 
                className="text-sm font-semibold text-[#184f9a] hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="input-field">
              <Lock size={17} />
              <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" className="input-toggle absolute right-4 top-3.5 text-slate-400" onClick={() => setShowPass(!showPass)}>
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm font-medium rounded-lg border border-red-100">{error}</div>}
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
  return <div className="mb-5"><button type="button" disabled={disabled || busy}
    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-bold disabled:opacity-50"
    onClick={() => { try{if(referral!==undefined)prepareReferralSignup(normalizeReferralCode(referral),'google');}catch(e:any){setError(e.message);return;} setBusy(true); setError(''); void signInWithGoogle().catch(error => {
      setError(error.message || 'Google sign-in is unavailable. Try email sign-in.'); setBusy(false);
    }); }}>{busy ? 'Opening Google…' : 'Continue with Google'}</button>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>;
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
    if (providerError) { setError(providerError); return; }
    // Supabase's browser client handles the implicit OAuth/email-confirmation callback.
    void refreshSession().then(current => {
      if (!mounted) return;
      if (!current) throw new Error('Sign-in was not confirmed. Please return to sign in.');
      navigate(customerPath(current), { replace: true });
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, [refreshSession, navigate]);
  return <AuthShell><AuthFormCard title={error ? 'Sign-in needs attention' : 'Completing sign-in'} subtitle="Your existing MatMove account and wallet stay linked.">
    {error ? <><p role="alert">{error}</p><button className="primary-button mt-4" onClick={() => navigate('/login', {replace:true})}>Return to sign in</button></> : <p role="status">Please wait…</p>}
  </AuthFormCard></AuthShell>;
}
