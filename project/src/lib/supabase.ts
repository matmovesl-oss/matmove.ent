import { createClient } from '@supabase/supabase-js';
import { observePasswordRecoveryEvent } from '@/services/authRecoveryState';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Preview deployments must never fall back to the live production database.
// main.tsx uses this flag to render a safe, disconnected preview notice instead
// of mounting AuthProvider when preview credentials are intentionally absent.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://not-configured.invalid',
  supabaseAnonKey || 'not-configured',
  {
    auth: {
      // Supabase Auth passkeys use the platform WebAuthn authenticator:
      // Face ID, Touch ID, Android biometrics, device PIN or a security key.
      experimental: { passkey: true },
    },
  }
);

// Capture the one-time recovery event as soon as the shared Supabase client
// initializes, before route components can mount or read the recovery URL.
// The disconnected-preview branch never mounts AuthProvider.
if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((event, session) => {
    observePasswordRecoveryEvent(event, session?.user.id);
  });
}
