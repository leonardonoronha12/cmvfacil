import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function normalizeConfirm(v: unknown) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const em = String(u?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
    if (users.length < 1000) break;
  }
  return null;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

type DeleteStep = {
  table: string;
  ok: boolean;
  count: number | null;
  error: string | null;
};

async function deleteByPrefix(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, prefix: string) {
  return await supabase.from(table).delete({ count: "exact" }).like("id", `${prefix}%`);
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    const confirm = normalizeConfirm(body?.confirm);

    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });
    const required = normalizeConfirm("APAGAR DADOS");
    const perEmailLegacy = normalizeConfirm(`APAGAR DADOS DE ${email.toUpperCase()}`);
    const legacy = normalizeConfirm("APAGAR DADOS DO RENAN");
    if (confirm !== required && confirm !== perEmailLegacy && confirm !== legacy) return json({ ok: false, error: "invalid_confirm" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const targetUserId = selfOk ? requesterId : await findAuthUserIdByEmail(supabase, email);
    if (!targetUserId) return json({ ok: false, error: "user_not_found" }, { status: 404 });

    const { data: memberRows, error: memberErr } = await supabase.from("company_members").select("company_id").eq("user_id", targetUserId).eq("company_id", companyId).limit(1);
    if (memberErr) return json({ ok: false, error: memberErr.message }, { status: 500 });
    if (!(memberRows ?? [])[0]) return json({ ok: false, error: "company_not_linked_to_user" }, { status: 400 });

    const steps: DeleteStep[] = [];
    const attempt = async (table: string, deleter: () => Promise<{ count: number | null; error: any }>) => {
      try {
        const { count, error } = await deleter();
        if (error) {
          steps.push({ table, ok: false, count: null, error: String(error.message ?? error) });
        } else {
          steps.push({ table, ok: true, count: typeof count === "number" ? count : null, error: null });
        }
      } catch (err) {
        steps.push({ table, ok: false, count: null, error: err instanceof Error ? err.message : String(err) });
      }
    };

    const stateId = `user:${targetUserId}`;
    const prefix = `${stateId}:`;
    await attempt("entradas (user prefix)", async () => await deleteByPrefix(supabase, "entradas", `${prefix}entrada:`));
    await attempt("desperdicios (user prefix)", async () => await deleteByPrefix(supabase, "desperdicios", `${prefix}desperdicio:`));
    await attempt("inventario (user prefix)", async () => await deleteByPrefix(supabase, "inventario", `${prefix}inventario:`));
    await attempt("insumos_state", async () => await supabase.from("insumos_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("fornecedores_state", async () => await supabase.from("fornecedores_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("fichas_tecnicas_state", async () => await supabase.from("fichas_tecnicas_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("fichas_tecnicas_etiquetas_state", async () => await supabase.from("fichas_tecnicas_etiquetas_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("pre_preparo_state", async () => await supabase.from("pre_preparo_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("pre_preparo_etiquetas_state", async () => await supabase.from("pre_preparo_etiquetas_state").delete({ count: "exact" }).eq("id", stateId));
    await attempt("insumos_templates_state", async () => await supabase.from("insumos_templates_state").delete({ count: "exact" }).eq("id", stateId));

    await attempt("recipe_ingredients", async () => await supabase.from("recipe_ingredients").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("labels", async () => await supabase.from("labels").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("inventory_items", async () => await supabase.from("inventory_items").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("invoice_items", async () => await supabase.from("invoice_items").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("supplier_items", async () => await supabase.from("supplier_items").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("avg_cost_events", async () => await supabase.from("avg_cost_events").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("wastes", async () => await supabase.from("wastes").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("inventories", async () => await supabase.from("inventories").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("invoices", async () => await supabase.from("invoices").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("suppliers", async () => await supabase.from("suppliers").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("items", async () => await supabase.from("items").delete({ count: "exact" }).eq("company_id", companyId));
    await attempt("categories", async () => await supabase.from("categories").delete({ count: "exact" }).eq("company_id", companyId));

    const ok = steps.every((s) => s.ok);
    const tables = steps.map((s) => s.table);

    return json(
      {
        ok,
        error: ok ? null : "delete_failed",
        email,
        userId: targetUserId,
        companyId,
        tables,
        steps,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
