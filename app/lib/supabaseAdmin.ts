import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "./supabaseAuthConfig";

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

export function getSupabaseServerClient(accessToken?: string) {
  try {
    return getSupabaseAdmin();
  } catch {
    const cfg = getSupabaseAuthConfig();
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers },
    });
  }
}
