import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env, isSupabaseConfigured } from "@/lib/env";

/**
 * Keeps the Supabase auth session fresh on every page request. In demo mode
 * (no Supabase keys) it does nothing.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  // When the redirect URL isn't on Supabase's allow list, Supabase sends people to
  // the Site URL instead (usually "/?code=…"). Finish the sign-in anyway.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname !== "/auth/callback" && (searchParams.has("code") || searchParams.has("error_description"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    url.search = "";
    const rest = new URLSearchParams(searchParams);
    for (const key of ["code", "error", "error_code", "error_description"]) {
      const value = searchParams.get(key);
      if (value) url.searchParams.set(key, value);
      rest.delete(key);
    }
    const back = rest.size ? `${pathname}?${rest}` : pathname;
    url.searchParams.set("next", back.startsWith("/login") ? "/" : back);
    return NextResponse.redirect(url);
  }

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
    // Skip static assets, the SDK bundle, examples, first-party app frames and the
    // server API (/api/v1: app servers authenticate with a secret, not a session) and
    // demo-mode uploads (/api/demo-media).
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|sdk/|examples/|embed/|api/meme-image|api/x-media|api/trending-memes|api/demo-media|api/v1/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|map)$).*)",
  ],
};
