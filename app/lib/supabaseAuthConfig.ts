function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export function getSupabaseAuthConfig() {
  const url =
    getEnv("SUPABASE_URL") ??
    getEnv("NEXT_PUBLIC_SUPABASE_URL") ??
    (getEnv("SUPABASE_FUNCTIONS_BASE_URL")
      ? getEnv("SUPABASE_FUNCTIONS_BASE_URL")!.replace(/\/functions\/v1\/?$/, "")
      : null);

  const anonKey =
    getEnv("SUPABASE_ANON_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    getEnv("SUPABASE_ANON_PUBLIC_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY");
  if (!url || !anonKey) {
    throw new Error("supabase_auth_not_configured");
  }
  return { url, anonKey };
}
