
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

    setAccess({
      frozen: true,
      approved: false,
    });

    const refresh = async () => {
      if (busy || !userId) return;

      busy = true;

      try {
        const [profile, wallets, roles] =
          await Promise.all([
            supabase
              .from('profiles')
              .select('*')
              .eq('id', userId)
              .single(),

            supabase
              .from('wallets')
              .select('is_frozen')
              .eq('user_id', userId),

            supabase.from('user_roles').select('role').eq('profile_id', userId),
          ]);

        if (!disposed) {
          if (
            profile.error ||
            wallets.error ||
            roles.error
          ) {
            setAccess({
              frozen: true,
              approved: false,
            });
          } else {
            const role = resolveCustomerRole(profile.data, roles.data || []);
            const capabilities = customerCapabilities({ ...profile.data, role }, wallets.data || []);
            setAccess({ frozen: !capabilities.customer || capabilities.frozen, approved: capabilities.customer && capabilities.verified });
          }
        }
      } catch {
        if (!disposed) {
          setAccess({
            frozen: true,
            approved: false,
          });
        }
      } finally {
        busy = false;
      }
    };

    void refresh();

    const timer = window.setInterval(
      () => void refresh(),
      5000
    );

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
        () => void refresh()
      )

      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        () => void refresh()
      )

      .subscribe();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return access;
}
