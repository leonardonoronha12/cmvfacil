import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getUserIdFromRequest } from "./requestUserId";
import { isLocalDevRequest } from "./localDevRequest";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const envSet = (name: string) => new Set(String(process.env[name] ?? "").split(/[,;\n]/).map(v => v.trim().toLowerCase()).filter(Boolean));

export async function requireSystemAdmin(req: NextRequest) {
  if (isLocalDevRequest(req)) return { ok: true as const, userId: "local-admin" };
  const authorization = String(req.headers.get("authorization") ?? "").trim();
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (serviceRoleKey && bearer && bearer === serviceRoleKey) {
    return { ok: true as const, userId: "service-role" };
  }
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return { ok: false as const, status: 401, error: "unauthorized" };
  const value = userId.toLowerCase();
  if (envSet("ADMIN_USER_IDS").has(value) || envSet("ADMIN_USER_EMAILS").has(value)) return { ok: true as const, userId };
  if (!uuidRe.test(userId) && value.includes("@") && process.env.ADMIN_SECRET) return { ok: true as const, userId };
  if (uuidRe.test(userId)) {
    const db = getSupabaseAdmin();
    const [{ data }, { data: dynamicAdmin }] = await Promise.all([
      db.auth.admin.getUserById(userId),
      db.from("system_admins").select("id").eq("user_id", userId).eq("active", true).maybeSingle(),
    ]);
    if (data.user?.email && envSet("ADMIN_USER_EMAILS").has(data.user.email.toLowerCase())) return { ok: true as const, userId };
    if (dynamicAdmin?.id) return { ok: true as const, userId };
  }
  return { ok: false as const, status: 403, error: "forbidden" };
}
