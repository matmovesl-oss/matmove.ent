import { createClient } from '@supabase/supabase-js';
import { observePasswordRecoveryEvent } from '@/services/authRecoveryState';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Check your .env file.'
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
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
supabase.auth.onAuthStateChange((event, session) => {
  observePasswordRecoveryEvent(event, session?.user.id);
});