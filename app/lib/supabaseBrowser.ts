import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export function getSupabaseBrowser() {
  const url =
    getEnv("NEXT_PUBLIC_SUPABASE_URL") ??
    getEnv("SUPABASE_URL") ??
    (getEnv("SUPABASE_FUNCTIONS_BASE_URL") ? getEnv("SUPABASE_FUNCTIONS_BASE_URL")!.replace(/\/functions\/v1\/?$/, "") : null);
  const anon =
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    getEnv("SUPABASE_ANON_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_KEY") ??
    getEnv("SUPABASE_KEY");
  if (!url || !anon) throw new Error("supabase_auth_not_configured");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

