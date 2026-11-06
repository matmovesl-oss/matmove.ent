const PRODUCTION_APP_ORIGIN = 'https://matmoveent.vercel.app';

/**
 * Build the redirect used by Supabase Auth.
 * Production always uses the stable MatMove Customer URL; preview and local
 * builds keep their own origin so review deployments remain testable.
 */
export function customerAuthRedirect(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = window.location.hostname === 'matmoveent.vercel.app'
    ? PRODUCTION_APP_ORIGIN
    : (import.meta.env.VITE_CUSTOMER_APP_URL?.trim() || window.location.origin);
  return new URL(normalized, origin).toString();
}
