import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server-side client — respects the signed-in user's session (RLS applies)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore since
            // middleware refreshes the session on every request.
          }
        },
      },
    }
  )
}
