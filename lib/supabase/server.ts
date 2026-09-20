import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { authCookieDomain } from '@/lib/auth/workspace-routing'

export async function createClient() {
  const cookieStore = await cookies()
  const requestHeaders = await headers()
  const domain = authCookieDomain(requestHeaders.get('host') ?? '')

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components cannot persist refreshed cookies. Proxy handles that.
          }
        },
      },
      cookieOptions: { ...(domain ? { domain } : {}), sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
    },
  )
}
