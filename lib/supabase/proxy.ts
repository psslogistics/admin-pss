import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { authCookieDomain } from '@/lib/auth/workspace-routing'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } }, cookieOptions: { ...(authCookieDomain(request.nextUrl.hostname) ? { domain: authCookieDomain(request.nextUrl.hostname) } : {}), sameSite: 'lax', secure: request.nextUrl.protocol === 'https:' } },
  )
  await supabase.auth.getClaims()
  return response
}
