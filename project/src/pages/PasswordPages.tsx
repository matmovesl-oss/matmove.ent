import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { resetPasscode } from '@/services/authService';
import { AuthBackButton, AuthFormCard, AuthShell } from '@/components/AuthShell';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';

type RecoveryCredential = 'password' | 'passcode';

function ForgotCredentialPage({ credential }: { credential: RecoveryCredential }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { resetPassword } = useAuth();
  const routeEmail = (location.state as { email?: unknown } | null)?.email;
  const [email, setEmail] = useState(typeof routeEmail === 'string' ? routeEmail : '');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const isPasscode = credential === 'passcode';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter the email address registered to your MatMove account.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (isPasscode) await resetPasscode(normalizedEmail);
      else await resetPassword(normalizedEmail);
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The recovery email could not be requested. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <AuthBackButton label="Back to sign in" onClick={() => navigate('/login')} />
      <AuthFormCard
        title={isPasscode ? 'Forgot your passcode?' : 'Forgot your password?'}
        subtitle={isPasscode
          ? 'Verify your email to receive a secure link for creating a new MatMove passcode.'
          : 'Verify your email to receive a secure link for creating a new MatMove account password.'}
      >
        {submitted ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={30} />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900">Check your email</h2>
            <p className="text-sm leading-6 text-slate-600">
              If a MatMove account exists for <strong>{email.trim()}</strong>, we have requested a secure recovery link.
              Check your inbox and spam folder. The link can only be used once.
            </p>
            <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              {isPasscode
                ? 'This link changes your MatMove passcode only. Your account password will stay the same.'
                : 'This link changes your account password only. Your MatMove passcode will stay the same.'}
            </p>
            <button type="button" onClick={() => setSubmitted(false)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
              Send another recovery link
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label className="field">
              <span>Account email address</span>
              <div className="input-field">
                <Mail size={17} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={event => { setEmail(event.target.value); setError(''); }}
                  placeholder="you@email.com"
                />
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={busy || !email.trim()} className="primary-button full-button">
              {busy ? 'Sending secure link…' : 'Email me a recovery link'} <ArrowRight size={17} />
            </button>
            <p className="text-xs leading-5 text-slate-500">
              For your security, MatMove does not reveal whether an email address has an account.
            </p>
          </form>
        )}
      </AuthFormCard>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  return <ForgotCredentialPage credential="password" />;
}

export function ForgotPasscodePage() {
  return <ForgotCredentialPage credential="passcode" />;
}
