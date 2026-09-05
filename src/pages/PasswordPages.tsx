import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const { resetPassword, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await resetPassword(email);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md">
        {!submitted ? (
          <>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Reset Password</h2>
            <p className="text-slate-500 mb-6">Enter your email address and we'll send you a link to reset your password.</p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Email address</label>
                <input 
                  type="email" 
                  required
                  className="w-full p-3 border border-slate-300 rounded-xl focus:border-[#184f9a] outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                />
              </div>
              
              {error && <div className="text-red-600 bg-red-50 p-3 rounded-lg text-sm">{error}</div>}
              
              <button 
                type="submit" 
                disabled={loading || !email}
                className="w-full bg-[#184f9a] text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send reset link'} <ArrowRight size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-green-100 text-[#32a84a] rounded-full flex items-center justify-center mx-auto mb-4">
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h2>
            <p className="text-slate-500 mb-6">We've sent instructions to <strong>{email}</strong>.</p>
          </div>
        )}
        
        <div className="mt-6 text-center">
          <button onClick={() => navigate('/signin')} className="text-sm font-semibold text-slate-600 flex items-center justify-center gap-2 mx-auto hover:text-[#184f9a]">
            <ArrowLeft size={16} /> Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Supabase automatically detects the hash token in the URL when they click the email link
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const { error } = await supabase.auth.updateUser({ password: password });
    
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      alert("Password updated successfully!");
      navigate('/customer'); // Send them to the dashboard
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Create new password</h2>
        <p className="text-slate-500 mb-6">Your new password must be at least 6 characters.</p>
        
        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">New Password</label>
            <input 
              type="password" 
              required
              minLength={6}
              className="w-full p-3 border border-slate-300 rounded-xl focus:border-[#184f9a] outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="text-red-600 bg-red-50 p-3 rounded-lg text-sm">{error}</div>}
          <button 
            type="submit" 
            disabled={loading || !password}
            className="w-full bg-[#184f9a] text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update password'} <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}