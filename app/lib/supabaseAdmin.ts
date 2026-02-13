import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL") ?? getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ??
    getEnv("SUPABASE_SERVICE_ROLE") ??
    getEnv("SERVICE_ROLE_KEY") ??
    getEnv("SUPABASE_SERVICE_KEY");

  if (!url || !serviceRole) {
    throw new Error("supabase_not_configured");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

