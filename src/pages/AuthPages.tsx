import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { CarFront, ArrowRight, Mail, Lock, Phone, Eye, EyeOff, ShieldCheck, Zap } from 'lucide-react';
import { AuthShell, AuthFormCard, AuthBackButton } from '@/components/AuthShell';
import { useAuth } from '@/context/AuthContext';

export function LoginPage() {
  const { signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setError('');
    
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please check your credentials.');
    }
  };

  return (
    <AuthShell>
      <AuthBackButton label="Back to welcome" onClick={() => navigate('/')} />
      <AuthFormCard title="Sign in" subtitle="Welcome back. Let's get you moving.">
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
          <button className="primary-button full-button" type="submit" disabled={loading}>
            {loading ? <Zap size={17} className="animate-pulse" /> : null}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-slate-600 text-sm">Don't have an account? <button className="font-semibold text-[#184f9a] hover:underline" onClick={() => navigate('/signup')}>Create one</button></p>
      </AuthFormCard>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp, loading } = useAuth();
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
    
    try {
      await signUp(email, phone, password);
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up. Please try again.');
    }
  };

  return (
    <AuthShell>
      <AuthBackButton label="Back to welcome" onClick={() => navigate('/')} />
      <AuthFormCard title="Create your account" subtitle="Join MatMove in just a few steps.">
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
          <button className="primary-button full-button" type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Continue'} <ArrowRight size={17} />
          </button>
        </form>
        <p className="mt-6 text-center text-slate-600 text-sm">Already have an account? <button className="font-semibold text-[#184f9a] hover:underline" onClick={() => navigate('/login')}>Sign in</button></p>
      </AuthFormCard>
    </AuthShell>
  );
}