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
    let refreshQueued = false;

    setAccess({ frozen: true, approved: false });
    if (!userId) return;

    const refresh = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      if (busy) {
        refreshQueued = true;
        return;
      }

      busy = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const [profile, wallets, roles] = await Promise.all([
          supabase.from('profiles')
            .select('id,role,kyc_status,is_wallet_frozen')
            .eq('id', userId)
            .single()
            .abortSignal(controller.signal),
          supabase.from('wallets')
            .select('is_frozen')
            .eq('user_id', userId)
            .abortSignal(controller.signal),
          supabase.from('user_roles')
            .select('role')
            .eq('profile_id', userId)
            .abortSignal(controller.signal),
        ]);

        if (!disposed) {
          if (profile.error || wallets.error || roles.error) {
            setAccess({ frozen: true, approved: false });
          } else {
            const role = resolveCustomerRole(profile.data, roles.data || []);
            const capabilities = customerCapabilities(
              { ...profile.data, role },
              wallets.data || [],
            );
            setAccess({
              frozen: !capabilities.customer || capabilities.frozen,
              approved: capabilities.customer && capabilities.verified,
            });
          }
        }
      } catch {
        if (!disposed) setAccess({ frozen: true, approved: false });
      } finally {
        window.clearTimeout(timeout);
        busy = false;
        if (refreshQueued) {
          refreshQueued = false;
          if (!disposed && document.visibilityState === 'visible') void refresh();
        }
      }
    };

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    void refresh();

    // Realtime is the fast path; this slower poll repairs missed notifications.
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refreshWhenActive);
    window.addEventListener('focus', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);

    const channel = supabase
      .channel('wallet-access:' + userId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'wallets',
        filter: 'user_id=eq.' + userId,
      }, refreshWhenActive)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: 'id=eq.' + userId,
      }, refreshWhenActive)
      .subscribe();

    return () => {
      disposed = true;
      refreshQueued = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenActive);
      window.removeEventListener('focus', refreshWhenActive);
      window.removeEventListener('online', refreshWhenActive);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return access;
}
