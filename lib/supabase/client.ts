import { createBrowserClient } from '@supabase/ssr'
import { authCookieDomain } from '@/lib/auth/workspace-routing'

export function createClient() {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  const domain = authCookieDomain(hostname);
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookieOptions: { ...(domain ? { domain } : {}), sameSite: 'lax', secure: typeof window !== 'undefined' && window.location.protocol === 'https:' } },
  )
}
