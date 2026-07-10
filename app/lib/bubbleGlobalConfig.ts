import { getSupabaseAdmin } from "./supabaseAdmin";

function safeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  const stripped = noTrail.replace(/\/api\/1\.1\/obj$/i, "").replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

function isMissingTableError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  if (msg.includes("schema cache") && msg.includes("could not find the table")) return true;
  return false;
}

export type BubbleGlobalConfig = {
  baseUrl: string;
  token: string;
  updatedAt: string | null;
};

export async function readBubbleGlobalConfigFromDb() {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { ok: false as const, error: "supabase_not_configured" };
  }

  const { data, error } = await supabase
    .from("bubble_global_config")
    .select("base_url,api_token,updated_at")
    .eq("id", "global")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { ok: true as const, value: null as BubbleGlobalConfig | null, tableMissing: true as const };
    return { ok: false as const, error: error.message };
  }

  const baseUrl = safeBaseUrl(String((data as any)?.base_url ?? ""));
  const token = safeToken(String((data as any)?.api_token ?? ""));
  const updatedAt = String((data as any)?.updated_at ?? "").trim() || null;
  const hasAny = Boolean(baseUrl || token);
  return { ok: true as const, value: hasAny ? ({ baseUrl, token, updatedAt } as BubbleGlobalConfig) : null, tableMissing: false as const };
}

export async function upsertBubbleGlobalConfigToDb(input: { baseUrl?: string; token?: string; clearToken?: boolean; clearBaseUrl?: boolean }) {
  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { ok: false as const, error: "supabase_not_configured" };
  }

  const currentRes = await readBubbleGlobalConfigFromDb();
  const current = currentRes.ok ? currentRes.value : null;

  const nextBaseUrl = input.clearBaseUrl ? "" : safeBaseUrl(String(input.baseUrl ?? current?.baseUrl ?? ""));
  const nextToken = input.clearToken ? "" : safeToken(String(input.token ?? current?.token ?? ""));

  const { error } = await supabase
    .from("bubble_global_config")
    .upsert({ id: "global", base_url: nextBaseUrl || null, api_token: nextToken || null } as any, { onConflict: "id" });

  if (error) {
    if (isMissingTableError(error)) return { ok: false as const, error: "missing_bubble_global_config_table" };
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}

export function readBubbleGlobalConfigFromEnv() {
  const baseUrl = safeBaseUrl(String(process.env.BUBBLE_BASE_URL ?? ""));
  const token = safeToken(String(process.env.BUBBLE_API_TOKEN ?? ""));
  const hasAny = Boolean(baseUrl || token);
  return hasAny ? ({ baseUrl, token, updatedAt: null } as BubbleGlobalConfig) : null;
}
