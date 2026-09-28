/**
 * Public configuration. `NEXT_PUBLIC_*` values are inlined at build time, so
 * these are safe to read anywhere.
 */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** `x` (OAuth 2.0, recommended) or `twitter` (legacy OAuth 1.0a). */
  xProvider: (process.env.NEXT_PUBLIC_SUPABASE_X_PROVIDER === "twitter" ? "twitter" : "x") as "x" | "twitter",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
};

/** Without Supabase keys the app runs in local demo mode. */
export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
