/**
 * Public configuration. `NEXT_PUBLIC_*` values are inlined at build time, so
 * these are safe to read anywhere.
 */
export const env = {
  supabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, ""),
  // `||`, not `??`: a blank PUBLISHABLE_KEY line (as in .env.example) must not hide the anon key.
  supabaseKey: (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim(),
  /** Preferred provider: `x` (OAuth 2.0) or `twitter` (legacy OAuth 1.0a). Sign-in falls back to whichever is enabled. */
  xProvider: (process.env.NEXT_PUBLIC_SUPABASE_X_PROVIDER === "twitter" ? "twitter" : "x") as "x" | "twitter",
};

/** Without Supabase keys the app runs in local demo mode. */
export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
