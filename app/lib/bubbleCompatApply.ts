"use server";

import { getSupabaseAdmin } from "./supabaseAdmin";
import { parseObjectType } from "./bubbleObjRealMapping";
import { dryRunBubbleCompatImportForEmail } from "./bubbleCompatImporter";

type ControlRow = {
  bubble_object_type: string;
  bubble_unique_id: string;
  bubble_user_id: string | null;
  supabase_user_id: string | null;
  raw_payload_json: any;
  status: string;
};

type BubbleUserMapRow = {
  bubble_user_id: string;
  email: string | null;
  nome: string | null;
  supabase_user_id: string | null;
};

type ApplyPlan = {
  ok: boolean;
  email: string;
  bubbleUser: BubbleUserMapRow;
  dryRun: Awaited<ReturnType<typeof dryRunBubbleCompatImportForEmail>>;
  affectedTables: string[];
  statsByTable: Record<
    string,
    {
      wouldCreate: number;
      wouldUpdate: number;
      wouldIgnore: number;
      brokenRelations: number;
    }
  >;
  relations: { resolved: number; broken: number; brokenSamples: any[] };
};

type ApplyReport = {
  ok: boolean;
  email: string;
  plan: ApplyPlan;
  execution: {
    startedAt: string;
    finishedAt: string;
    perTable: Record<
      string,
      {
        attempted: number;
        created: number;
        updated: number;
        ignored: number;
        errors: Array<{ bubble_id: string; error: string }>;
      }
    >;
    brokenRelations: number;
    brokenSamples: Array<{ table: string; bubble_id: string; relation: string; expectedBubbleId: string; reason: string }>;
  };
  counts: {
    before: Record<string, number>;
    after: Record<string, number>;
  };
  postDryRun: Awaited<ReturnType<typeof dryRunBubbleCompatImportForEmail>>;
};

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLower(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeCnpj(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return digits ? digits : null;
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: unknown) {
  const s = normalizeLower(v);
  if (s === "1" || s === "true" || s === "sim" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "nao" || s === "não" || s === "no") return false;
  return Boolean(v);
}

function parseDateOnly(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseTime(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    try {
      const s = JSON.stringify(input);
      const m = s.match(/\d{8,}x\d{6,}/);
      return m ? String(m[0]).trim() : "";
    } catch {
      return "";
    }
  }
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

async function resolveBubbleUserByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const e = normalizeLower(email);
  const { data, error } = await supabase
    .from("bubble_obj_user_map")
    .select("bubble_user_id,email,nome,supabase_user_id")
    .eq("email", e)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = ((data ?? [])[0] ?? null) as any;
  if (!row) return null;
  return {
    bubble_user_id: String(row.bubble_user_id ?? "").trim(),
    email: row.email ? String(row.email) : null,
    nome: row.nome ? String(row.nome) : null,
    supabase_user_id: row.supabase_user_id ? String(row.supabase_user_id) : null,
  } as BubbleUserMapRow;
}

async function fetchAllControlRowsForBubbleUser(args: { supabase: ReturnType<typeof getSupabaseAdmin>; bubbleUserId: string; supabaseUserId: string }) {
  const out: ControlRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 200_000; from += pageSize) {
    const { data, error } = await args.supabase
      .from("bubble_obj_import_control")
      .select("bubble_object_type,bubble_unique_id,bubble_user_id,supabase_user_id,raw_payload_json,status")
      .eq("bubble_user_id", args.bubbleUserId)
      .eq("supabase_user_id", args.supabaseUserId)
      .in("status", ["staged", "processed", "staged_only"])
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    for (const r of rows) out.push(r as ControlRow);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function buildBubbleCompatApplyPlanForEmail(email: string): Promise<ApplyPlan> {
  const supabase = getSupabaseAdmin();
  const e = normalizeLower(email);
  const bubbleUser = await resolveBubbleUserByEmail(supabase, e);
  if (!bubbleUser?.bubble_user_id || !bubbleUser.supabase_user_id) throw new Error("missing_user_mapping");
  const dryRun = await dryRunBubbleCompatImportForEmail(e);
  if (!dryRun.ok) throw new Error("dry_run_failed");

  const statsByTable: ApplyPlan["statsByTable"] = {};
  for (const [table, st] of Object.entries(dryRun.statsByTable ?? {})) {
    statsByTable[table] = {
      wouldCreate: Number((st as any)?.wouldCreate ?? 0) || 0,
      wouldUpdate: Number((st as any)?.wouldUpdate ?? 0) || 0,
      wouldIgnore: Number((st as any)?.wouldIgnore ?? 0) || 0,
      brokenRelations: Number((st as any)?.brokenRelations ?? 0) || 0,
    };
  }

  const affectedTables = Object.entries(statsByTable)
    .filter(([, st]) => (st.wouldCreate ?? 0) > 0 || (st.wouldUpdate ?? 0) > 0 || (st.wouldIgnore ?? 0) > 0)
    .map(([t]) => t);

  return {
    ok: true,
    email: e,
    bubbleUser,
    dryRun,
    affectedTables,
    statsByTable,
    relations: dryRun.relations,
  };
}

type ApplyOptions = {
  tables?: string[];
  skipPrereqs?: boolean;
};

async function countCompaniesByBubbleIds(supabase: ReturnType<typeof getSupabaseAdmin>, bubbleIds: string[]) {
  if (!bubbleIds.length) return 0;
  const { data, error } = await supabase.from("companies").select("id").in("bubble_id", bubbleIds);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

async function countByCompanyId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return Number(count ?? 0) || 0;
}

async function countUserProfile(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const { count, error } = await supabase.from("user_profiles").select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return Number(count ?? 0) || 0;
}

async function countCompanyMember(supabase: ReturnType<typeof getSupabaseAdmin>, companyId: string, userId: string) {
  const { count, error } = await supabase.from("company_members").select("*", { count: "exact", head: true }).eq("company_id", companyId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return Number(count ?? 0) || 0;
}

async function getCompaniesByBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, bubbleIds: string[]) {
  if (!bubbleIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("companies").select("id,bubble_id").in("bubble_id", bubbleIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const b = String(r?.bubble_id ?? "").trim();
    const id = String(r?.id ?? "").trim();
    if (b && id) map.set(b, id);
  }
  return map;
}

async function getByCompanyBubbleId(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, companyId: string, bubbleIds: string[]) {
  if (!bubbleIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from(table).select("id,bubble_id").eq("company_id", companyId).in("bubble_id", bubbleIds);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    const b = String(r?.bubble_id ?? "").trim();
    const id = String(r?.id ?? "").trim();
    if (b && id) map.set(b, id);
  }
  return map;
}

async function upsertRows(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  table: string;
  rows: any[];
  onConflict: string;
  chunkSize?: number;
  existingBubbleIds?: Set<string>;
}) {
  const { supabase, table, rows, onConflict } = args;
  const chunkSize = typeof args.chunkSize === "number" && args.chunkSize > 0 ? args.chunkSize : 1;
  const existingBubbleIds = args.existingBubbleIds ?? null;
  const errors: Array<{ bubble_id: string; error: string }> = [];
  let attempted = 0;
  let created = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const part = rows.slice(i, i + chunkSize);
    for (const row of part) {
      attempted += 1;
      const bubbleId = String(row?.bubble_id ?? "").trim();
      const existed = existingBubbleIds ? existingBubbleIds.has(bubbleId) : false;
      const { error } = await supabase.from(table).upsert(row, { onConflict });
      if (error) {
        errors.push({ bubble_id: bubbleId || String(row?.id ?? ""), error: error.message });
        continue;
      }
      if (existed) updated += 1;
      else created += 1;
    }
  }
  return { attempted, created, updated, errors };
}

async function upsertCompanyByBubbleOrIdentity(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  bubbleId: string;
  payload: any;
  createdByUserId: string;
}) {
  const { supabase, bubbleId, payload, createdByUserId } = args;
  const cnpj = normalizeCnpj(payload?.cnpj);
  const email = normalizeLower(payload?.email) || null;

  const { data: byBubble, error: errBubble } = await supabase.from("companies").select("id,raw").eq("bubble_id", bubbleId).maybeSingle();
  if (errBubble) throw new Error(errBubble.message);
  if (byBubble?.id) {
    const existingRaw = (byBubble as any)?.raw ?? {};
    const mergedRaw = { ...(existingRaw ?? {}), bubble: payload };
    const { error } = await supabase
      .from("companies")
      .update({
        fantasy_name: normalizeText(payload?.nome) || (payload?.fantasy_name ?? "Empresa"),
        legal_name: normalizeText(payload?.nome) || (payload?.legal_name ?? "Empresa"),
        cnpj,
        email: email || null,
        phone_e164: normalizeText(payload?.whatsapp) || null,
        meta_cmv: parseNumber(payload?.meta_cmv),
        plan_code: normalizeText(payload?.plano) || null,
        plan_status: normalizeText(payload?.status_plano) || null,
        created_by_user_id: createdByUserId,
        raw: mergedRaw,
      } as any)
      .eq("id", String((byBubble as any).id));
    if (error) throw new Error(error.message);
    return { id: String((byBubble as any).id), action: "updated" as const };
  }

  let existingId: string | null = null;
  if (cnpj) {
    const { data, error } = await supabase.from("companies").select("id,bubble_id,raw").eq("cnpj", cnpj).order("updated_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]?.id) existingId = String((data[0] as any).id);
  }
  if (!existingId && email) {
    const { data, error } = await supabase.from("companies").select("id,bubble_id,raw").eq("email", email).order("updated_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]?.id) existingId = String((data[0] as any).id);
  }

  if (existingId) {
    const { data: existingRow, error: exErr } = await supabase.from("companies").select("id,raw,bubble_id").eq("id", existingId).maybeSingle();
    if (exErr) throw new Error(exErr.message);
    const existingRaw = (existingRow as any)?.raw ?? {};
    const mergedRaw = { ...(existingRaw ?? {}), bubble: payload };
    const { error } = await supabase
      .from("companies")
      .update({
        bubble_id: bubbleId,
        fantasy_name: normalizeText(payload?.nome) || "Empresa",
        legal_name: normalizeText(payload?.nome) || "Empresa",
        cnpj,
        email: email || null,
        phone_e164: normalizeText(payload?.whatsapp) || null,
        meta_cmv: parseNumber(payload?.meta_cmv),
        plan_code: normalizeText(payload?.plano) || null,
        plan_status: normalizeText(payload?.status_plano) || null,
        created_by_user_id: createdByUserId,
        raw: mergedRaw,
      } as any)
      .eq("id", existingId);
    if (error) throw new Error(error.message);
    return { id: existingId, action: "updated" as const };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("companies")
    .insert({
      bubble_id: bubbleId,
      fantasy_name: normalizeText(payload?.nome) || "Empresa",
      legal_name: normalizeText(payload?.nome) || "Empresa",
      cnpj,
      email: email || null,
      phone_e164: normalizeText(payload?.whatsapp) || null,
      meta_cmv: parseNumber(payload?.meta_cmv),
      plan_code: normalizeText(payload?.plano) || null,
      plan_status: normalizeText(payload?.status_plano) || null,
      created_by_user_id: createdByUserId,
      raw: { bubble: payload },
    } as any)
    .select("id")
    .maybeSingle();
  if (insErr) throw new Error(insErr.message);
  const id = String((inserted as any)?.id ?? "").trim();
  if (!id) throw new Error("company_insert_failed");
  return { id, action: "created" as const };
}

export async function applyBubbleCompatForEmail(email: string, options?: ApplyOptions): Promise<ApplyReport> {
  const supabase = getSupabaseAdmin();
  const plan = await buildBubbleCompatApplyPlanForEmail(email);
  const dryRun = plan.dryRun;
  if (!dryRun.ok) throw new Error("dry_run_failed");

  const tablesFilter = Array.isArray(options?.tables) && options?.tables.length ? new Set(options!.tables) : null;
  const skipPrereqs = Boolean(options?.skipPrereqs);
  const shouldApplyTable = (t: string) => (tablesFilter ? tablesFilter.has(t) : true);

  const brokenRelations = Number(dryRun.relations?.broken ?? 0) || 0;
  const anyBrokenInStats = Object.entries(dryRun.statsByTable ?? {}).some(([t, x]: any) => {
    if (tablesFilter && !tablesFilter.has(String(t))) return false;
    return Number(x?.brokenRelations ?? 0) > 0;
  });
  const samples = Array.isArray((dryRun.relations as any)?.brokenSamples) ? ((dryRun.relations as any).brokenSamples as any[]) : [];
  const anyBrokenSamples = samples.some((s: any) => (tablesFilter ? tablesFilter.has(String(s?.table ?? "")) : true));
  if ((tablesFilter ? anyBrokenInStats || anyBrokenSamples : brokenRelations > 0 || anyBrokenInStats || samples.length > 0)) {
    throw new Error("plan_has_broken_relations");
  }

  const bubbleUser = plan.bubbleUser;
  const supabaseUserId = String(bubbleUser.supabase_user_id ?? "").trim();
  const bubbleUserId = String(bubbleUser.bubble_user_id ?? "").trim();
  if (!supabaseUserId || !bubbleUserId) throw new Error("missing_user_mapping");

  const startedAt = new Date().toISOString();
  const controlRows = await fetchAllControlRowsForBubbleUser({ supabase, bubbleUserId, supabaseUserId });

  const byBaseType: Record<string, ControlRow[]> = {};
  for (const r of controlRows) {
    const parsed = parseObjectType(String(r.bubble_object_type ?? ""));
    const bt = normalizeLower(parsed.baseType);
    if (!bt) continue;
    (byBaseType[bt] ??= []).push(r);
  }

  const targetCompanyBubbleIds = (dryRun.companyScope?.bubbleCompanyIds ?? []).map((x: any) => String(x ?? "").trim()).filter(Boolean);
  const countsBefore: Record<string, number> = {};
  const countsAfter: Record<string, number> = {};

  const execution: ApplyReport["execution"] = {
    startedAt,
    finishedAt: startedAt,
    perTable: {},
    brokenRelations: 0,
    brokenSamples: [],
  };

  const perTableInit = (t: string) => {
    execution.perTable[t] = execution.perTable[t] ?? { attempted: 0, created: 0, updated: 0, ignored: 0, errors: [] };
    return execution.perTable[t]!;
  };

  const companiesRows = byBaseType["empresas"] ?? [];
  const companiesToApply = companiesRows
    .map((r) => ({ bubble_id: String(r.bubble_unique_id ?? "").trim(), raw: (r as any).raw_payload_json ?? {} }))
    .filter((x) => x.bubble_id);

  if (!skipPrereqs && shouldApplyTable("companies")) {
    const companiesTable = perTableInit("companies");
    countsBefore.companies = await countCompaniesByBubbleIds(supabase, companiesToApply.map((x) => x.bubble_id));

    for (const c of companiesToApply) {
      companiesTable.attempted += 1;
      try {
        const res = await upsertCompanyByBubbleOrIdentity({ supabase, bubbleId: c.bubble_id, payload: c.raw, createdByUserId: supabaseUserId });
        if (res.action === "created") companiesTable.created += 1;
        else companiesTable.updated += 1;
      } catch (err) {
        companiesTable.errors.push({ bubble_id: c.bubble_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const companyIdByBubbleId = await getCompaniesByBubbleId(supabase, targetCompanyBubbleIds.length ? targetCompanyBubbleIds : companiesToApply.map((x) => x.bubble_id));
  if (!skipPrereqs && shouldApplyTable("companies")) {
    countsAfter.companies = await countCompaniesByBubbleIds(supabase, companiesToApply.map((x) => x.bubble_id));
  }

  const firstCompanyId = (() => {
    const id = targetCompanyBubbleIds.length ? companyIdByBubbleId.get(targetCompanyBubbleIds[0]!) : null;
    if (id) return id;
    const any = companiesToApply.length ? companyIdByBubbleId.get(companiesToApply[0]!.bubble_id) : null;
    return any ?? null;
  })();
  if (!firstCompanyId) throw new Error("company_id_not_resolved_after_apply");

  const userRows = byBaseType["user"] ?? [];
  const userPayload = (userRows[0] as any)?.raw_payload_json ?? {};
  if (!skipPrereqs && shouldApplyTable("user_profiles")) {
    countsBefore.user_profiles = await countUserProfile(supabase, supabaseUserId);
    const userProfilesTable = perTableInit("user_profiles");
    userProfilesTable.attempted += 1;
    try {
      const { data: existing, error: exErr } = await supabase.from("user_profiles").select("user_id,raw").eq("user_id", supabaseUserId).maybeSingle();
      if (exErr) throw new Error(exErr.message);
      const existingRaw = (existing as any)?.raw ?? {};
      const mergedRaw = { ...(existingRaw ?? {}), bubble: userPayload };
      if (existing?.user_id) {
        const { error } = await supabase
          .from("user_profiles")
          .update({
            bubble_user_id: bubbleUserId,
            email: normalizeLower(userPayload?.email) || bubbleUser.email || null,
            nome: normalizeText(userPayload?.nome) || null,
            sobrenome: normalizeText(userPayload?.sobrenome) || null,
            nome_completo: normalizeText(userPayload?.nome_completo) || null,
            whatsapp: normalizeText(userPayload?.whatsapp) || null,
            nivel_permissao: normalizeText(userPayload?.nivel_permissao) || null,
            proprietario_empresa: parseBool(userPayload?.proprietario_empresa),
            raw: mergedRaw,
          } as any)
          .eq("user_id", supabaseUserId);
        if (error) throw new Error(error.message);
        userProfilesTable.updated += 1;
      } else {
        const { error } = await supabase.from("user_profiles").insert({
          user_id: supabaseUserId,
          bubble_user_id: bubbleUserId,
          email: normalizeLower(userPayload?.email) || bubbleUser.email || null,
          nome: normalizeText(userPayload?.nome) || null,
          sobrenome: normalizeText(userPayload?.sobrenome) || null,
          nome_completo: normalizeText(userPayload?.nome_completo) || null,
          whatsapp: normalizeText(userPayload?.whatsapp) || null,
          nivel_permissao: normalizeText(userPayload?.nivel_permissao) || null,
          proprietario_empresa: parseBool(userPayload?.proprietario_empresa),
          raw: { bubble: userPayload },
        } as any);
        if (error) throw new Error(error.message);
        userProfilesTable.created += 1;
      }
    } catch (err) {
      userProfilesTable.errors.push({ bubble_id: bubbleUserId, error: err instanceof Error ? err.message : String(err) });
    }
    countsAfter.user_profiles = await countUserProfile(supabase, supabaseUserId);
  }

  const permissionLevel = normalizeText(userPayload?.nivel_permissao) || "";
  const ownerFlag = parseBool(userPayload?.proprietario_empresa) || /owner/i.test(permissionLevel);
  const role = ownerFlag ? "owner" : /admin|administrador/i.test(permissionLevel) ? "admin" : "member";

  if (!skipPrereqs && shouldApplyTable("company_members")) {
    countsBefore.company_members = await countCompanyMember(supabase, firstCompanyId, supabaseUserId);
    const membersTable = perTableInit("company_members");
    membersTable.attempted += 1;
    try {
      const { data: existing, error: exErr } = await supabase
        .from("company_members")
        .select("id,raw")
        .eq("company_id", firstCompanyId)
        .eq("user_id", supabaseUserId)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      const existingRaw = (existing as any)?.raw ?? {};
      const mergedRaw = { ...(existingRaw ?? {}), bubble: userPayload };
      if (existing?.id) {
        const { error } = await supabase
          .from("company_members")
          .update({ role, permission_level: permissionLevel, bubble_user_id: bubbleUserId, raw: mergedRaw } as any)
          .eq("id", String((existing as any).id));
        if (error) throw new Error(error.message);
        membersTable.updated += 1;
      } else {
        const { error } = await supabase.from("company_members").insert({
          company_id: firstCompanyId,
          user_id: supabaseUserId,
          role,
          permission_level: permissionLevel,
          bubble_user_id: bubbleUserId,
          raw: { bubble: userPayload },
        } as any);
        if (error) throw new Error(error.message);
        membersTable.created += 1;
      }
    } catch (err) {
      membersTable.errors.push({ bubble_id: bubbleUserId, error: err instanceof Error ? err.message : String(err) });
    }
    countsAfter.company_members = await countCompanyMember(supabase, firstCompanyId, supabaseUserId);
  }

  const companyBubbleId = targetCompanyBubbleIds[0] ?? companiesToApply[0]?.bubble_id ?? "";
  if (!companyBubbleId) throw new Error("missing_company_bubble_id");

  const applyCompanyScopedByBubbleId = async (table: string, baseType: string, builder: (r: ControlRow) => any) => {
    if (!shouldApplyTable(table)) return;
    const rows = (byBaseType[baseType] ?? []).map((r) => ({ src: r, bubble_id: String(r.bubble_unique_id ?? "").trim(), raw: (r as any).raw_payload_json ?? {} }));
    const valid = rows.filter((x) => x.bubble_id);
    const pt = perTableInit(table);
    countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
    const toUpsert = [];
    for (const x of valid) {
      try {
        const row = builder(x.src);
        if (!row) {
          pt.ignored += 1;
          continue;
        }
        toUpsert.push(row);
      } catch (err) {
        pt.errors.push({ bubble_id: x.bubble_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
    const { data: existingRows, error: exErr } = bubbleIds.length
      ? await supabase.from(table).select("bubble_id,raw").eq("company_id", firstCompanyId).in("bubble_id", bubbleIds)
      : ({ data: [], error: null } as any);
    if (exErr) throw new Error(exErr.message);
    const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean));
    const existingRawByBubbleId = new Map<string, any>();
    for (const r of existingRows ?? []) {
      const b = String((r as any)?.bubble_id ?? "").trim();
      if (b) existingRawByBubbleId.set(b, (r as any)?.raw ?? {});
    }
    for (const row of toUpsert) {
      const b = String(row?.bubble_id ?? "").trim();
      const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
      row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
    }

    const { attempted, created, updated, errors } = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingBubbleIds: existing });
    pt.attempted += attempted;
    pt.created += created;
    pt.updated += updated;
    pt.errors.push(...errors);
    countsAfter[table] = await countByCompanyId(supabase, table, firstCompanyId);
  };

  await applyCompanyScopedByBubbleId("categories", "categorias", (r) => {
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      name: normalizeText((r as any).raw_payload_json?.nome) || "Sem categoria",
      created_by_user_id: supabaseUserId,
      raw: { bubble: (r as any).raw_payload_json ?? {} },
    };
  });

  const categoriesBubbleIds = (byBaseType["categorias"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const categoryIdByBubbleId = await getByCompanyBubbleId(supabase, "categories", firstCompanyId, categoriesBubbleIds);

  await applyCompanyScopedByBubbleId("items", "item", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const categoriaBubbleId = extractBubbleId(raw?.categoria_id) || normalizeText(raw?.categoria_id);
    const categoryId = categoriaBubbleId ? categoryIdByBubbleId.get(categoriaBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      name: normalizeText(raw?.nome) || "Item",
      descricao: normalizeText(raw?.descricao) || "",
      modo_preparo: normalizeText(raw?.modo_preparo) || "",
      rendimento: parseNumber(raw?.rendimento),
      custo_medio: parseNumber(raw?.custo_medio),
      validade_data: parseDateOnly(raw?.validade_data),
      validade_dias: raw?.validade_dias != null ? Math.trunc(Number(parseNumber(raw?.validade_dias) ?? 0)) : null,
      cmv_desejado: parseNumber(raw?.cmv_desejado),
      dias_estoque_minimo: parseNumber(raw?.dias_estoque_minimo),
      ocultar_cmv: parseBool(raw?.boolean_ocultar_cmv),
      item_receita: parseBool(raw?.boolean_item_receita),
      item_do_cardapio: parseBool(raw?.boolean_item_do_cardapio),
      preco_venda_total: parseNumber(raw?.preco_venda_total),
      custo_total_receita: parseNumber(raw?.custo_total_receita),
      dias_prazo_fornecedor: raw?.dias_prazo_fornecedor != null ? Math.trunc(Number(parseNumber(raw?.dias_prazo_fornecedor) ?? 0)) : null,
      dias_total_estoque_minimo: raw?.dias_total_estoque_minimo != null ? Math.trunc(Number(parseNumber(raw?.dias_total_estoque_minimo) ?? 0)) : null,
      popularidade: normalizeText(raw?.popularidade) || null,
      quadrante_ficha_tecnica: normalizeText(raw?.quadrante_ficha_tecnica) || null,
      unidade_medida: normalizeText(raw?.unidade_medida) || null,
      category_id: categoryId,
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const itemsBubbleIds = (byBaseType["item"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const itemIdByBubbleId = await getByCompanyBubbleId(supabase, "items", firstCompanyId, itemsBubbleIds);

  await applyCompanyScopedByBubbleId("suppliers", "fornecedores", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      nome: normalizeText(raw?.nome) || "",
      endereco: normalizeText(raw?.endereco) || "",
      vendedor: normalizeText(raw?.vendedor) || "",
      whatsapp: normalizeText(raw?.whatsapp) || "",
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const suppliersBubbleIds = (byBaseType["fornecedores"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const supplierIdByBubbleId = await getByCompanyBubbleId(supabase, "suppliers", firstCompanyId, suppliersBubbleIds);

  {
    const baseType = "itens_fornecedores";
    const table = "supplier_items";
    const explicitRows = byBaseType[baseType] ?? [];
    const srcRows = explicitRows.length
      ? explicitRows
      : (() => {
          const supplierByInvoiceId = new Map<string, string>();
          for (const invoice of byBaseType["notas_fiscais"] ?? []) {
            const raw = (invoice as any)?.raw_payload_json ?? {};
            const invoiceId = String((invoice as any)?.bubble_unique_id ?? raw?._id ?? "").trim();
            const supplierId = extractBubbleId(raw?.fornecedor_id) || normalizeText(raw?.fornecedor_id);
            if (invoiceId && supplierId) supplierByInvoiceId.set(invoiceId, supplierId);
          }
          return (byBaseType["itens_notas"] ?? []).flatMap((invoiceItem: any) => {
            const raw = invoiceItem?.raw_payload_json ?? {};
            const invoiceId = extractBubbleId(raw?.nota_id) || normalizeText(raw?.nota_id);
            const supplierId = supplierByInvoiceId.get(invoiceId) ?? "";
            const itemId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
            if (!supplierId || !itemId) return [];
            return [{
              ...invoiceItem,
              bubble_unique_id: `derived:${String(invoiceItem?.bubble_unique_id ?? `${invoiceId}:${itemId}`).trim()}`,
              raw_payload_json: { ...raw, fornecedor_id: supplierId, item_id: itemId, derived_from_invoice: invoiceId },
            }];
          });
        })();
    if (!shouldApplyTable(table)) {
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      countsAfter[table] = countsBefore[table];
    } else {
    const pt = perTableInit(table);
    countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
    const toUpsert: any[] = [];
    for (const r of srcRows) {
      const bubbleId = String(r.bubble_unique_id ?? "").trim();
      if (!bubbleId) {
        pt.ignored += 1;
        continue;
      }
      const raw = (r as any).raw_payload_json ?? {};
      const supplierBubbleId = extractBubbleId(raw?.fornecedor_id) || normalizeText(raw?.fornecedor_id);
      const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
      const supplierId = supplierBubbleId ? supplierIdByBubbleId.get(supplierBubbleId) ?? null : null;
      const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
      if (!supplierId || !itemId) {
        pt.ignored += 1;
        continue;
      }
      toUpsert.push({
        company_id: firstCompanyId,
        bubble_id: bubbleId,
        supplier_id: supplierId,
        item_id: itemId,
        created_by_user_id: supabaseUserId,
        raw: { bubble: raw },
      });
    }
    const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
    const { data: existingRows, error: exErr } = bubbleIds.length
      ? await supabase.from(table).select("bubble_id,raw").eq("company_id", firstCompanyId).in("bubble_id", bubbleIds)
      : ({ data: [], error: null } as any);
    if (exErr) throw new Error(exErr.message);
    const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean));
    const existingRawByBubbleId = new Map<string, any>();
    for (const r of existingRows ?? []) {
      const b = String((r as any)?.bubble_id ?? "").trim();
      if (b) existingRawByBubbleId.set(b, (r as any)?.raw ?? {});
    }
    for (const row of toUpsert) {
      const b = String(row?.bubble_id ?? "").trim();
      const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
      row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
    }
    const { attempted, created, updated, errors } = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingBubbleIds: existing });
    pt.attempted += attempted;
    pt.created += created;
    pt.updated += updated;
    pt.errors.push(...errors);
    countsAfter[table] = await countByCompanyId(supabase, table, firstCompanyId);
    }
  }

  await applyCompanyScopedByBubbleId("invoices", "notas_fiscais", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const supplierBubbleId = extractBubbleId(raw?.fornecedor_id) || normalizeText(raw?.fornecedor_id);
    const supplierId = supplierBubbleId ? supplierIdByBubbleId.get(supplierBubbleId) ?? null : null;
    const responsavelBubbleId = extractBubbleId(raw?.responsavel_id) || normalizeText(raw?.responsavel_id);
    const responsavelUserId = responsavelBubbleId && responsavelBubbleId === bubbleUserId ? supabaseUserId : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      codigo: normalizeText(raw?.codigo) || "",
      responsavel_user_id: responsavelUserId,
      fornecedor_id: supplierId,
      data_criacao: parseTime(raw?.data_criacao),
      data_recebimento: parseDateOnly(raw?.data_recebimento),
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const invoicesBubbleIds = (byBaseType["notas_fiscais"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const invoiceIdByBubbleId = await getByCompanyBubbleId(supabase, "invoices", firstCompanyId, invoicesBubbleIds);

  {
    const baseType = "itens_notas";
    const table = "invoice_items";
    const srcRows = byBaseType[baseType] ?? [];
    if (!shouldApplyTable(table)) {
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      countsAfter[table] = countsBefore[table];
    } else {
    const pt = perTableInit(table);
    countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
    const toUpsert: any[] = [];
    const invoicesByItemId = new Map<
      string,
      Array<{ invoiceBubbleId: string; supplierBubbleId: string; dataRecebimento: string; dataCriacao: string }>
    >();
    for (const inv of byBaseType["notas_fiscais"] ?? []) {
      const invBubbleId = String(inv.bubble_unique_id ?? "").trim();
      if (!invBubbleId) continue;
      const invRaw = (inv as any).raw_payload_json ?? {};
      const supplierBubbleId = extractBubbleId(invRaw?.fornecedor_id) || normalizeText(invRaw?.fornecedor_id);
      const dataRecebimento = String(invRaw?.data_recebimento ?? "").trim();
      const dataCriacao = String(invRaw?.data_criacao ?? invRaw?.["Created Date"] ?? "").trim();
      const list = invRaw?.lista_itens;
      const entries = Array.isArray(list) ? list : typeof list === "string" ? [list] : [];
      for (const e of entries) {
        const itemId = extractBubbleId(e) || normalizeText(e);
        if (!itemId) continue;
        const arr = invoicesByItemId.get(itemId) ?? [];
        arr.push({ invoiceBubbleId: invBubbleId, supplierBubbleId, dataRecebimento, dataCriacao });
        invoicesByItemId.set(itemId, arr);
      }
    }
    const dateOnly = (s: string) => String(s ?? "").trim().slice(0, 10);
    const timeMs = (s: string) => {
      const d = new Date(String(s ?? "").trim());
      const t = d.getTime();
      return Number.isFinite(t) ? t : null;
    };
    for (const r of srcRows) {
      const bubbleId = String(r.bubble_unique_id ?? "").trim();
      if (!bubbleId) {
        pt.ignored += 1;
        continue;
      }
      const raw = (r as any).raw_payload_json ?? {};
      const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
      const derivedInvoiceBubbleId = (() => {
        const explicit = extractBubbleId(raw?.nota_id) || normalizeText(raw?.nota_id);
        if (explicit) return explicit;
        if (!itemBubbleId) return "";
        const candidates = invoicesByItemId.get(itemBubbleId) ?? [];
        if (!candidates.length) return "";
        if (candidates.length === 1) return candidates[0]!.invoiceBubbleId;
        const itemDate = dateOnly(String(raw?.data_lancamento ?? raw?.["Created Date"] ?? ""));
        const itemTime = timeMs(String(raw?.data_lancamento ?? raw?.["Created Date"] ?? ""));
        const scored = candidates
          .map((c) => {
            const invDate = dateOnly(c.dataRecebimento);
            const datePenalty = itemDate && invDate ? (invDate === itemDate ? 0 : 1) : 1;
            const invTime = timeMs(c.dataCriacao);
            const timePenalty = itemTime != null && invTime != null ? Math.abs(invTime - itemTime) : Number.MAX_SAFE_INTEGER;
            return { c, datePenalty, timePenalty };
          })
          .sort((a, b) => (a.datePenalty - b.datePenalty) || (a.timePenalty - b.timePenalty));
        return scored[0]?.c.invoiceBubbleId ?? "";
      })();
      const invoiceBubbleId = derivedInvoiceBubbleId;
      const supplierBubbleId = extractBubbleId(raw?.fornecedor_id) || normalizeText(raw?.fornecedor_id);
      const invoiceId = invoiceBubbleId ? invoiceIdByBubbleId.get(invoiceBubbleId) ?? null : null;
      const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
      const supplierId = (() => {
        const direct = supplierBubbleId ? supplierIdByBubbleId.get(supplierBubbleId) ?? null : null;
        if (direct) return direct;
        if (!invoiceBubbleId) return null;
        const candidates = itemBubbleId ? invoicesByItemId.get(itemBubbleId) ?? [] : [];
        const match = candidates.find((c) => c.invoiceBubbleId === invoiceBubbleId);
        const invSupplierBubbleId = match?.supplierBubbleId ? String(match.supplierBubbleId).trim() : "";
        return invSupplierBubbleId ? supplierIdByBubbleId.get(invSupplierBubbleId) ?? null : null;
      })();
      if (!invoiceId) {
        pt.ignored += 1;
        continue;
      }
      toUpsert.push({
        company_id: firstCompanyId,
        bubble_id: bubbleId,
        invoice_id: invoiceId,
        item_id: itemId,
        fornecedor_id: supplierId,
        data_lancamento: parseDateOnly(raw?.data_lancamento),
        quantidade: parseNumber(raw?.quantidade),
        custo_unitario: parseNumber(raw?.custo_unitario),
        subtotal: parseNumber(raw?.subtotal),
        ocultar_cmv: parseBool(raw?.ocultar_cmv),
        cadastro_item: parseBool(raw?.cadastro_Item),
        excluivel_detalhes_item: parseBool(raw?.excluível_detalhes_item),
        created_by_user_id: supabaseUserId,
        raw: { bubble: raw },
      });
    }
    const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
    const { data: existingRows, error: exErr } = bubbleIds.length
      ? await supabase.from(table).select("bubble_id,raw").eq("company_id", firstCompanyId).in("bubble_id", bubbleIds)
      : ({ data: [], error: null } as any);
    if (exErr) throw new Error(exErr.message);
    const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean));
    const existingRawByBubbleId = new Map<string, any>();
    for (const r of existingRows ?? []) {
      const b = String((r as any)?.bubble_id ?? "").trim();
      if (b) existingRawByBubbleId.set(b, (r as any)?.raw ?? {});
    }
    for (const row of toUpsert) {
      const b = String(row?.bubble_id ?? "").trim();
      const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
      row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
    }
    const { attempted, created, updated, errors } = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingBubbleIds: existing });
    pt.attempted += attempted;
    pt.created += created;
    pt.updated += updated;
    pt.errors.push(...errors);
    countsAfter[table] = await countByCompanyId(supabase, table, firstCompanyId);
    }
  }

  await applyCompanyScopedByBubbleId("inventories", "inventarios", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      nome: normalizeText(raw?.nome) || "",
      data_contagem: parseTime(raw?.data_contagem),
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const inventoriesBubbleIds = (byBaseType["inventarios"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const inventoryIdByBubbleId = await getByCompanyBubbleId(supabase, "inventories", firstCompanyId, inventoriesBubbleIds);

  {
    const baseType = "itens_inventarios";
    const table = "inventory_items";
    const srcRows = byBaseType[baseType] ?? [];
    if (!shouldApplyTable(table)) {
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      countsAfter[table] = countsBefore[table];
    } else {
      const pt = perTableInit(table);
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      const toUpsert: any[] = [];
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_unique_id ?? "").trim();
        if (!bubbleId) {
          pt.ignored += 1;
          continue;
        }
        const raw = (r as any).raw_payload_json ?? {};
        const inventoryBubbleId = extractBubbleId(raw?.inventario_id) || normalizeText(raw?.inventario_id);
        const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
        const inventoryId = inventoryBubbleId ? inventoryIdByBubbleId.get(inventoryBubbleId) ?? null : null;
        const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
        if (!inventoryId) {
          pt.ignored += 1;
          continue;
        }
        toUpsert.push({
          company_id: firstCompanyId,
          bubble_id: bubbleId,
          inventory_id: inventoryId,
          item_id: itemId,
          data_contagem: parseTime(raw?.data_contagem),
          quantidade_contada: parseNumber(raw?.quantidade_contada),
          ocultar_cmv: parseBool(raw?.ocultar_cmv),
          item_temporario: parseBool(raw?.item_temporario),
          created_by_user_id: supabaseUserId,
          raw: { bubble: raw },
        });
      }
      const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
      const { data: existingRows, error: exErr } = bubbleIds.length
        ? await supabase.from(table).select("bubble_id,raw").eq("company_id", firstCompanyId).in("bubble_id", bubbleIds)
        : ({ data: [], error: null } as any);
      if (exErr) throw new Error(exErr.message);
      const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean));
      const existingRawByBubbleId = new Map<string, any>();
      for (const r of existingRows ?? []) {
        const b = String((r as any)?.bubble_id ?? "").trim();
        if (b) existingRawByBubbleId.set(b, (r as any)?.raw ?? {});
      }
      for (const row of toUpsert) {
        const b = String(row?.bubble_id ?? "").trim();
        const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
        row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
      }
      const { attempted, created, updated, errors } = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingBubbleIds: existing });
      pt.attempted += attempted;
      pt.created += created;
      pt.updated += updated;
      pt.errors.push(...errors);
      countsAfter[table] = await countByCompanyId(supabase, table, firstCompanyId);
    }
  }

  await applyCompanyScopedByBubbleId("waste_reasons", "motivos_desperdicios", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    return { company_id: firstCompanyId, bubble_id: bubbleId, titulo: normalizeText(raw?.titulo) || "", created_by_user_id: supabaseUserId, raw: { bubble: raw } };
  });

  const reasonsBubbleIds = (byBaseType["motivos_desperdicios"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const reasonIdByBubbleId = await getByCompanyBubbleId(supabase, "waste_reasons", firstCompanyId, reasonsBubbleIds);

  await applyCompanyScopedByBubbleId("labels", "etiquetas", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
    const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      codigo: normalizeText(raw?.codigo) || "",
      item_nome: normalizeText(raw?.item_nome) || "",
      data_criacao_log: parseTime(raw?.data_criacao_log),
      data_producao: parseDateOnly(raw?.data_producao),
      data_validade: parseDateOnly(raw?.data_validade),
      responsavel_user_id: null,
      boolean_desperdicado: parseBool(raw?.boolean_desperdiçado),
      dias_validade: raw?.dias_validade != null ? Math.trunc(Number(parseNumber(raw?.dias_validade) ?? 0)) : null,
      item_id: itemId,
      boolean_baixa_vencimento: parseBool(raw?.boolean_baixa_vencimento),
      quantidade_produzida: parseNumber(raw?.quantidade_produzida),
      responsavel_nome_completo: normalizeText(raw?.responsavel_nome_completo) || "",
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const labelsBubbleIds = (byBaseType["etiquetas"] ?? []).map((r) => String(r.bubble_unique_id ?? "").trim()).filter(Boolean);
  const labelIdByBubbleId = await getByCompanyBubbleId(supabase, "labels", firstCompanyId, labelsBubbleIds);

  await applyCompanyScopedByBubbleId("wastes", "desperdicio", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
    const motivoBubbleId = extractBubbleId(raw?.motivo) || normalizeText(raw?.motivo);
    const etiquetaBubbleId = extractBubbleId(raw?.etiqueta_id) || normalizeText(raw?.etiqueta_id);
    const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
    const motivoId = motivoBubbleId ? reasonIdByBubbleId.get(motivoBubbleId) ?? null : null;
    const etiquetaId = etiquetaBubbleId ? labelIdByBubbleId.get(etiquetaBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      lancamento: parseDateOnly(raw?.lancamento),
      motivo_text: normalizeText(raw?.motivo_text) || "",
      quantidade: parseNumber(raw?.quantidade),
      custo_total: parseNumber(raw?.custo_total),
      custo_unitario: parseNumber(raw?.custo_unitario),
      unidade_medida: normalizeText(raw?.unidade_medida) || "",
      item_id: itemId,
      motivo_id: motivoId,
      etiqueta_id: etiquetaId,
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  {
    const baseType = "ingredientes";
    const table = "recipe_ingredients";
    const srcRows = byBaseType[baseType] ?? [];
    if (!shouldApplyTable(table)) {
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      countsAfter[table] = countsBefore[table];
    } else {
      const pt = perTableInit(table);
      countsBefore[table] = await countByCompanyId(supabase, table, firstCompanyId);
      const toUpsert: any[] = [];
      const recipeByIngredientRowId = new Map<string, string>();
      for (const it of byBaseType["item"] ?? []) {
        const recipeBubbleId = String(it.bubble_unique_id ?? "").trim();
        if (!recipeBubbleId) continue;
        const itRaw = (it as any).raw_payload_json ?? {};
        const list = itRaw?.lista_ingredientes;
        const entries = Array.isArray(list) ? list : typeof list === "string" ? [list] : [];
        for (const e of entries) {
          const ingredientRowId = extractBubbleId(e) || normalizeText(e);
          if (ingredientRowId) recipeByIngredientRowId.set(ingredientRowId, recipeBubbleId);
        }
      }
      for (const r of srcRows) {
        const bubbleId = String(r.bubble_unique_id ?? "").trim();
        if (!bubbleId) {
          pt.ignored += 1;
          continue;
        }
        const parsed = parseObjectType(String(r.bubble_object_type ?? ""));
        const companyBubbleFromType = String(parsed.companyId ?? "").trim() || null;
        if (companyBubbleFromType && companyBubbleFromType !== companyBubbleId) {
          pt.ignored += 1;
          continue;
        }
        const raw = (r as any).raw_payload_json ?? {};
        const recipeBubbleId =
          extractBubbleId(raw?.receita_id) || normalizeText(raw?.receita_id) || recipeByIngredientRowId.get(bubbleId) || "";
        const ingredientBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
        const recipeId = recipeBubbleId ? itemIdByBubbleId.get(recipeBubbleId) ?? null : null;
        const ingredientId = ingredientBubbleId ? itemIdByBubbleId.get(ingredientBubbleId) ?? null : null;
        if (!recipeId || !ingredientId) {
          pt.ignored += 1;
          continue;
        }
        toUpsert.push({
          company_id: firstCompanyId,
          bubble_id: bubbleId,
          recipe_item_id: recipeId,
          ingredient_item_id: ingredientId,
          quantidade: parseNumber(raw?.quantidade),
          custo: parseNumber(raw?.custo),
          ingrediente_temporario: parseBool(raw?.ingrediente_temporario),
          created_by_user_id: supabaseUserId,
          raw: { bubble: raw },
        });
      }
      const bubbleIds = toUpsert.map((r) => String(r?.bubble_id ?? "").trim()).filter(Boolean);
      const { data: existingRows, error: exErr } = bubbleIds.length
        ? await supabase.from(table).select("bubble_id,raw").eq("company_id", firstCompanyId).in("bubble_id", bubbleIds)
        : ({ data: [], error: null } as any);
      if (exErr) throw new Error(exErr.message);
      const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.bubble_id ?? "").trim()).filter(Boolean));
      const existingRawByBubbleId = new Map<string, any>();
      for (const r of existingRows ?? []) {
        const b = String((r as any)?.bubble_id ?? "").trim();
        if (b) existingRawByBubbleId.set(b, (r as any)?.raw ?? {});
      }
      for (const row of toUpsert) {
        const b = String(row?.bubble_id ?? "").trim();
        const prev = b ? existingRawByBubbleId.get(b) ?? {} : {};
        row.raw = { ...(prev ?? {}), ...(row.raw ?? {}) };
      }
      const { attempted, created, updated, errors } = await upsertRows({ supabase, table, rows: toUpsert, onConflict: "company_id,bubble_id", existingBubbleIds: existing });
      pt.attempted += attempted;
      pt.created += created;
      pt.updated += updated;
      pt.errors.push(...errors);
      countsAfter[table] = await countByCompanyId(supabase, table, firstCompanyId);
    }
  }

  await applyCompanyScopedByBubbleId("shopping_list_items", "itens_lista_compras", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
    const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      item_id: itemId,
      item_nome: normalizeText(raw?.Item_nome) || "",
      item_medida: normalizeText(raw?.item_medida) || "",
      qtd_compra: parseNumber(raw?.qtd_compra),
      qtd_sugestao: parseNumber(raw?.qtd_sugestao),
      tipo: normalizeText(raw?.tipo) || "",
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  await applyCompanyScopedByBubbleId("purchase_real_qty", "qtd_compra_real", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const itemBubbleId = extractBubbleId(raw?.item_id) || normalizeText(raw?.item_id);
    const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
    if (!itemId) {
      return null;
    }
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      item_id: itemId,
      quantidade: parseNumber(raw?.quantidade) ?? 0,
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  await applyCompanyScopedByBubbleId("revenues", "faturamentos", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const invInicialBubbleId = extractBubbleId(raw?.inventario_inicial) || normalizeText(raw?.inventario_inicial);
    const invFinalBubbleId = extractBubbleId(raw?.inventario_final) || normalizeText(raw?.inventario_final);
    const invInicialId = invInicialBubbleId ? inventoryIdByBubbleId.get(invInicialBubbleId) ?? null : null;
    const invFinalId = invFinalBubbleId ? inventoryIdByBubbleId.get(invFinalBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      data_inicial: parseDateOnly(raw?.data_inicial),
      data_final: parseDateOnly(raw?.data_final),
      faturamento: parseNumber(raw?.faturamento),
      responsavel_user_id: null,
      inventario_inicial_id: invInicialId,
      inventario_final_id: invFinalId,
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  await applyCompanyScopedByBubbleId("avg_cost_events", "custo_medio_item", (r) => {
    const raw = (r as any).raw_payload_json ?? {};
    const bubbleId = String(r.bubble_unique_id ?? "").trim();
    if (!bubbleId) return null;
    const itemBubbleId = extractBubbleId(raw?.item) || normalizeText(raw?.item);
    const itemId = itemBubbleId ? itemIdByBubbleId.get(itemBubbleId) ?? null : null;
    return {
      company_id: firstCompanyId,
      bubble_id: bubbleId,
      data_lancamento: parseDateOnly(raw?.data_lancamento),
      item_id: itemId,
      custo_medio: parseNumber(raw?.custo_medio),
      alteracao_custo_inicial: parseBool(raw?.alteracao_custo_inicial),
      created_by_user_id: supabaseUserId,
      raw: { bubble: raw },
    };
  });

  const finishedAt = new Date().toISOString();
  execution.finishedAt = finishedAt;

  const postDryRun = await dryRunBubbleCompatImportForEmail(email);

  return {
    ok: true,
    email: normalizeLower(email),
    plan,
    execution,
    counts: { before: countsBefore, after: countsAfter },
    postDryRun,
  };
}

type GroupId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type GroupApplyResult = {
  ok: boolean;
  groupId: GroupId;
  groupName: string;
  tables: string[];
  pre: {
    statsByTable: Record<string, any>;
  };
  execution: ApplyReport["execution"];
  counts: ApplyReport["counts"];
  post: {
    statsByTable: Record<string, any>;
    relations: any;
  };
  flags?: {
    itemsTotal: number;
    itemReceitaTrue: number;
    itemDoCardapioTrue: number;
  };
};

export async function applyBubbleCompatGroupsForEmail(email: string): Promise<{ ok: boolean; email: string; groups: GroupApplyResult[] }> {
  const e = normalizeLower(email);
  const supabase = getSupabaseAdmin();

  const groups: Array<{ id: GroupId; name: string; tables: string[] }> = [
    { id: 1, name: "grupo1_catalogo", tables: ["categories", "items", "avg_cost_events"] },
    { id: 2, name: "grupo2_fornecedores", tables: ["suppliers", "supplier_items"] },
    { id: 3, name: "grupo3_entradas", tables: ["invoices", "invoice_items"] },
    { id: 4, name: "grupo4_inventario", tables: ["inventories", "inventory_items"] },
    { id: 5, name: "grupo5_desperdicios", tables: ["waste_reasons", "wastes"] },
    { id: 6, name: "grupo6_receitas", tables: ["recipe_ingredients"] },
    { id: 7, name: "grupo7_lista_compras_cmv", tables: [] },
  ];

  const out: GroupApplyResult[] = [];

  for (const g of groups) {
    if (g.id === 7) {
      out.push({
        ok: true,
        groupId: g.id,
        groupName: g.name,
        tables: g.tables,
        pre: { statsByTable: {} },
        execution: { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), perTable: {}, brokenRelations: 0, brokenSamples: [] },
        counts: { before: {}, after: {} },
        post: { statsByTable: {}, relations: { resolved: 0, broken: 0, brokenSamples: [] } },
      });
      continue;
    }

    const res = await applyBubbleCompatForEmail(e, { tables: g.tables, skipPrereqs: true });

    const preStats: Record<string, any> = {};
    for (const t of g.tables) preStats[t] = (res.plan?.dryRun as any)?.statsByTable?.[t] ?? null;

    const postStats: Record<string, any> = {};
    for (const t of g.tables) postStats[t] = (res.postDryRun as any)?.statsByTable?.[t] ?? null;

    const groupResult: GroupApplyResult = {
      ok: true,
      groupId: g.id,
      groupName: g.name,
      tables: g.tables,
      pre: { statsByTable: preStats },
      execution: {
        startedAt: res.execution.startedAt,
        finishedAt: res.execution.finishedAt,
        perTable: Object.fromEntries(Object.entries(res.execution.perTable ?? {}).filter(([k]) => g.tables.includes(k))),
        brokenRelations: res.execution.brokenRelations,
        brokenSamples: res.execution.brokenSamples,
      },
      counts: {
        before: Object.fromEntries(Object.entries(res.counts.before ?? {}).filter(([k]) => g.tables.includes(k))),
        after: Object.fromEntries(Object.entries(res.counts.after ?? {}).filter(([k]) => g.tables.includes(k))),
      },
      post: { statsByTable: postStats, relations: (res.postDryRun as any)?.relations ?? null },
    };

    if (g.id === 6) {
      const bubbleCompanyId = String((res.plan?.dryRun as any)?.companyScope?.bubbleCompanyIds?.[0] ?? "").trim();
      const { data: companyRow, error: companyErr } = bubbleCompanyId
        ? await supabase.from("companies").select("id").eq("bubble_id", bubbleCompanyId).maybeSingle()
        : ({ data: null, error: null } as any);
      const companyId = String((companyRow as any)?.id ?? "").trim();
      if (!companyErr && companyId) {
        const { data, error } = await supabase.from("items").select("item_receita,item_do_cardapio").eq("company_id", companyId);
        if (!error) {
          const rows = (data ?? []) as any[];
          groupResult.flags = {
            itemsTotal: rows.length,
            itemReceitaTrue: rows.filter((r) => Boolean(r?.item_receita)).length,
            itemDoCardapioTrue: rows.filter((r) => Boolean(r?.item_do_cardapio)).length,
          };
        }
      }
    }

    out.push(groupResult);

    const anyErrors = Object.values(groupResult.execution.perTable ?? {}).some((t: any) => Array.isArray(t?.errors) && t.errors.length > 0);
    if (anyErrors) break;
  }

  return { ok: true, email: e, groups: out };
}
