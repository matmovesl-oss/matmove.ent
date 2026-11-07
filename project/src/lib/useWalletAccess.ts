import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { resolveCustomerRole, customerCapabilities } from '../../shared/customer-access.js';

export function useWalletAccess(userId: string) {
  const [access, setAccess] = useState({
    frozen: true,
    approved: false,
  });

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let loaded = false;

    setAccess({ frozen: true, approved: false });
    if (!userId) return;

    const refresh = async () => {
      if (busy || disposed) return;
      busy = true;

      try {
        // Only fetch fields that affect access. The customer profile is not
        // needed here, and Realtime replaces the old five-second poll.
        const [profile, wallets, roles] = await Promise.all([
          supabase
            .from('profiles')
            .select('role,is_wallet_frozen,kyc_status')
            .eq('id', userId)
            .maybeSingle(),

          supabase
            .from('wallets')
            .select('is_frozen')
            .eq('user_id', userId),

          supabase
            .from('user_roles')
            .select('role')
            .eq('profile_id', userId),
        ]);

        if (disposed) return;
        if (profile.error || !profile.data || wallets.error || roles.error) {
          throw profile.error || wallets.error || roles.error || new Error('Wallet access could not be verified.');
        }

        const role = resolveCustomerRole(profile.data, roles.data || []);
        if (!role) throw new Error('Customer role could not be verified.');

        const capabilities = customerCapabilities(
          { ...profile.data, role },
          wallets.data || [],
        );

        setAccess({
          frozen: !capabilities.customer || capabilities.frozen,
          approved: capabilities.customer && capabilities.verified,
        });
        loaded = true;
      } catch {
        // Before the first successful check, fail closed. After that, keep the
        // last verified UI state during a transient network interruption.
        // Every money-moving API/RPC must still re-check permissions server-side.
        if (!disposed && !loaded) {
          setAccess({ frozen: true, approved: false });
        }
      } finally {
        busy = false;
      }
    };

    void refresh();

    const channel = supabase
      .channel(`wallet-access:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_roles',
          filter: `profile_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe();

    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);

    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return access;
}
