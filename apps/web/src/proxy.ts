import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env, isSupabaseConfigured } from "@/lib/env";

/**
 * Keeps the Supabase auth session fresh on every page request. In demo mode
 * (no Supabase keys) it does nothing.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });
  // Refreshes the session if the access token expired.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    // Skip static assets, the SDK bundle, examples and first-party app frames.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|sdk/|examples/|embed/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|map)$).*)",
  ],
};
