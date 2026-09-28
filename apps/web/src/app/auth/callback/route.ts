import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getServerSupabase } from "@/platform/supabase/server";

/** Finishes "Sign in with X": swaps the OAuth code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  // Only allow same-site relative redirects.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!isSupabaseConfigured) {
    return NextResponse.redirect(new URL("/login?error=not-configured", origin));
  }
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError || !code) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", oauthError ?? "missing-code");
    return NextResponse.redirect(url);
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", error.message);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(next, origin));
}
