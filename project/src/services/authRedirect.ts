const PRODUCTION_APP_ORIGIN = 'https://matmove.space';
const PRODUCTION_CUSTOMER_HOSTS = new Set([
  'matmove.space',
  'www.matmove.space',
  'matmoveent.vercel.app',
]);

/**
 * Resolve one stable origin for every customer email action.
 * Production hostnames always use the branded MatMove domain; Vercel preview
 * and local development origins remain isolated for safe end-to-end testing.
 */
export function resolveCustomerAuthOrigin(
  hostname: string,
  currentOrigin: string,
  configuredOrigin?: string | null,
): string {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (PRODUCTION_CUSTOMER_HOSTS.has(normalizedHost)) return PRODUCTION_APP_ORIGIN;

  const configured = configuredOrigin?.trim();
  if (!configured) return currentOrigin;

  try {
    const candidate = new URL(configured);
    if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') return currentOrigin;
    return candidate.origin;
  } catch {
    return currentOrigin;
  }
}

/**
 * Build the redirect used by Supabase Auth for signup confirmation, password
 * reset and passcode recovery. Auth secrets and tokens remain with Supabase.
 */
export function customerAuthRedirect(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = resolveCustomerAuthOrigin(
    window.location.hostname,
    window.location.origin,
    import.meta.env.VITE_CUSTOMER_APP_URL,
  );
  return new URL(normalized, origin).toString();
}
