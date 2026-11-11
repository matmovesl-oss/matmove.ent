import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { customerPasscode } from '@/components/CustomerPasscode';
import { LockKeyhole, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

type RecoveryMode = 'password' | 'passcode';

export function UpdatePassword({ mode = 'password' }: { mode?: RecoveryMode }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(true);

  useEffect(() => {
    let active = true;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const marker = hashParams.get('type') === 'recovery' ||
      searchParams.get('type') === 'recovery' || searchParams.has('code');
    const providerError = hashParams.get('error_description') || searchParams.get('error_description');

    if (providerError) {
      setError(providerError);
      setCheckingRecovery(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        setRecoveryReady(true);
        setError('');
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        return;
      }
      if (marker && data.session?.user) {
        setRecoveryReady(true);
        setError('');
      } else if (!providerError) {
        setError('This recovery link is invalid or expired. Request a new recovery email from MatMove sign in.');
      }
    }).catch((err: any) => {
      if (active) setError(err?.message || 'Recovery session could not be verified.');
    }).finally(() => {
      if (active) setCheckingRecovery(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!recoveryReady) {
      setError('Open the recovery link from your verified email before changing this credential.');
      return;
    }

    if (mode === 'password') {
      if (password.length < 8) return setError('Password must be at least 8 characters long.');
      if (password !== confirmPassword) return setError('Passwords do not match.');
    } else {
      if (!/^\\d{6}$/.test(newPin)) return setError('Choose a new six-digit passcode.');
      if (newPin !== confirmPin) return setError('The six-digit passcodes do not match.');
    }

    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (sessionError || !userId) throw new Error('Recovery session expired. Request a fresh email and try again.');

      if (mode === 'password') {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
      } else {
        const result = await customerPasscode(userId, 'recover', null, newPin);
        if (!result.ok || result.digits !== 6 || result.code !== 'saved') {
          throw new Error(result.code === 'cooldown'
            ? 'Passcode recovery is temporarily locked. Request a fresh recovery email after the cooldown.'
            : 'The six-digit passcode reset was not confirmed. Request a fresh recovery email and try again.');
        }
      }

      localStorage.removeItem('matmove_pin');
      localStorage.removeItem('matmove_last_active');
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || (mode === 'password' ? 'Failed to update password.' : 'Failed to update passcode.'));
    } finally {
      setLoading(false);
    }
  };

  const credentialLabel = mode === 'password' ? 'Password' : 'Six-digit passcode';
  const title = success ? (mode === 'password' ? 'Password Updated' : 'Passcode Updated')
    : (mode === 'password' ? 'Reset Your Password' : 'Reset Your Passcode');
  const description = mode === 'password'
    ? 'Choose a new account password. Your six-digit MatMove passcode will remain unchanged.'
    : 'Choose a new six-digit MatMove passcode. Your account password will remain unchanged.';

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="text-slate-500 mt-2">Your {credentialLabel.toLowerCase()} has been changed. Your other credential was not changed. Sign in again to continue.</p>
          <button type="button" onClick={() => navigate('/login', { replace: true })} className="mt-6 w-full rounded-xl bg-blue-700 p-3 font-bold text-white">Continue to sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-6">
          <LockKeyhole size={24} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{title}</h2>
        <p className="text-slate-500 text-sm mb-6">{description}</p>

        {checkingRecovery && <p role="status" className="mb-4 text-sm text-slate-600">Verifying your secure recovery link…</p>}
        {!checkingRecovery && !recoveryReady && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">A valid recovery session is required. Return to sign in and request another recovery email.</p>}
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-start gap-3 mb-6 border border-red-100 text-sm">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'password' ? (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">New Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" className="w-full border border-slate-300 p-3.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-600" placeholder="At least 8 characters" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" className="w-full border border-slate-300 p-3.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-600" placeholder="Re-enter your password" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">New six-digit passcode</label>
                <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\\D/g, '').slice(0, 6))} required autoComplete="new-password" className="w-full border border-slate-300 p-3.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-600" placeholder="Six digits" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">Confirm six-digit passcode</label>
                <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\\D/g, '').slice(0, 6))} required autoComplete="new-password" className="w-full border border-slate-300 p-3.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-600" placeholder="Re-enter six digits" />
              </div>
            </>
          )}
          <button type="submit" disabled={loading || checkingRecovery || !recoveryReady} className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold mt-2 hover:bg-blue-700 transition flex justify-center disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin" size={20} /> : (mode === 'password' ? 'Save new password' : 'Save new six-digit passcode')}
          </button>
        </form>
      </div>
    </div>
  );
}
