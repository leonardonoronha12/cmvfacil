import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";
import { isCountableFinalBaseType, isDerivedBaseType, isScopeOnlyBaseType, isStagedOnlyBaseType, parseObjectType } from "../../../../lib/bubbleObjRealMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function extractBubbleUniqueId(obj: any) {
  const direct = pickAny(obj, ["unique_id", "_id", "id", "bubble_id"]);
  return String(direct ?? "").trim();
}

function extractAnyBubbleIdFromText(input: unknown) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function extractBubbleUserIdFromObj(obj: any) {
  const direct = pickAny(obj, ["bubble_user_id", "user_id", "usuario_id", "owner", "created_by", "criado_por", "responsavel_id"]);
  const id = extractAnyBubbleIdFromText(direct);
  if (id) return id;
  for (const v of Object.values(obj ?? {})) {
    const got = extractAnyBubbleIdFromText(v);
    if (got) return got;
  }
  return "";
}

function stableNoIdKey(obj: any) {
  const raw = JSON.stringify(obj ?? "");
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `noid_${hash}`;
}

function readJsonObjectEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStringArrayEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function isUserTypeName(typeName: string) {
  const t = String(typeName ?? "").trim().toLowerCase();
  return t === "user" || t === "users" || t === "usuario" || t === "usuarios" || t === "usuário" || t === "usuários";
}

function constraintKeysForType(objectType: string) {
  const byType = readJsonObjectEnv("BUBBLE_OBJ_USER_CONSTRAINT_KEYS_BY_TYPE");
  const lower = String(objectType ?? "").trim().toLowerCase();
  const fromType = byType ? (byType[lower] as unknown) : null;
  const fromTypeList = Array.isArray(fromType) ? (fromType as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
  if (fromTypeList && fromTypeList.length) return fromTypeList;
  const global = readStringArrayEnv("BUBBLE_OBJ_USER_CONSTRAINT_KEYS");
  if (global && global.length) return global;
  return [
    "Created By",
    "created_by",
    "criado_por",
    "owner",
    "Owner",
    "usuario",
    "usuário",
    "user",
    "User",
    "usuario_id",
    "user_id",
    "bubble_user_id",
    "responsavel_id",
  ];
}

function isConstraintKeyRejected(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.startsWith("bubble_400:")) return false;
  const lower = msg.toLowerCase();
  return lower.includes("constraint") || lower.includes("constraints") || lower.includes("key") || lower.includes("field");
}

function companyUserContainsKeys() {
  return [
    "lista_usuarios",
    "lista_de_usuarios",
    "usuarios",
    "users",
    "lista_usuarios_ids",
    "usuarios_ids",
    "lista_users",
    "lista_user",
  ];
}

function companyIdConstraintKeys() {
  return ["empresa_id", "empresa", "company_id", "company", "restaurante_id", "restaurante"];
}

function clampInt(n: unknown, min: number, max: number) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : NaN;
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

async function tryFetchWithConstraintKeys(args: {
  creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>;
  type: string;
  cursor: number;
  limit: number;
  constraint_type: string;
  value: any;
  keys: string[];
  timeoutMs: number;
}) {
  const { creds, type, cursor, limit, keys, constraint_type, value } = args;
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      return await fetchBubbleObjPageWithConstraints<any>({
        creds,
        type,
        cursor,
        limit,
        constraints: [{ key, constraint_type, value }],
        timeoutMs: args.timeoutMs,
      });
    } catch (err) {
      lastErr = err;
      if (isConstraintKeyRejected(err)) continue;
      throw err;
    }
  }
  const details = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
  throw new Error(`unable_to_scope_query_for_type:${String(type ?? "")}:${details}`);
}

async function fetchBubbleObjScopedPage(args: {
  creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>;
  objectType: string;
  cursor: number;
  limit: number;
  bubbleUserId: string;
  userEmail: string;
  timeoutMs: number;
}) {
  const { creds, objectType, cursor, limit, bubbleUserId, userEmail, timeoutMs } = args;
  const parsed = parseObjectType(objectType);
  const baseType = parsed.baseType;

  if (isUserTypeName(baseType)) {
    const email = String(userEmail ?? "").trim().toLowerCase();
    const constraints = email
      ? [{ key: "email", constraint_type: "equals", value: email }]
      : [{ key: "unique_id", constraint_type: "equals", value: bubbleUserId }];
    return await fetchBubbleObjPageWithConstraints<any>({ creds, type: baseType, cursor, limit, constraints, timeoutMs });
  }

  if (String(baseType).trim().toLowerCase() === "empresas") {
    const keys = companyUserContainsKeys();
    try {
      return await tryFetchWithConstraintKeys({ creds, type: baseType, cursor, limit, keys, constraint_type: "contains", value: bubbleUserId, timeoutMs });
    } catch (err) {
      if (!(err instanceof Error) || !String(err.message).includes("unable_to_scope_query_for_type")) throw err;
    }
    const fallbackKeys = constraintKeysForType(baseType);
    return await tryFetchWithConstraintKeys({ creds, type: baseType, cursor, limit, keys: fallbackKeys, constraint_type: "equals", value: bubbleUserId, timeoutMs });
  }

  if (parsed.companyId) {
    return await tryFetchWithConstraintKeys({
      creds,
      type: baseType,
      cursor,
      limit,
      keys: companyIdConstraintKeys(),
      constraint_type: "equals",
      value: parsed.companyId,
      timeoutMs,
    });
  }

  const keys = constraintKeysForType(baseType);
  return await tryFetchWithConstraintKeys({ creds, type: baseType, cursor, limit, keys, constraint_type: "equals", value: bubbleUserId, timeoutMs });
}

async function getRun(supabase: ReturnType<typeof getSupabaseAdmin>, runId: string, userId: string) {
  const { data, error } = await supabase.from("bubble_obj_import_run").select("*").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as any;
  if (!row) throw new Error("run_not_found");
  if (String(row.triggered_by_supabase_user_id ?? "") !== userId) throw new Error("forbidden");
  return row as any;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const runId = String(body?.runId ?? "").trim();
    if (!runId) return json({ ok: false, error: "missing_runId" }, { status: 400 });
    const maxPages = typeof body?.maxPages === "number" && Number.isFinite(body.maxPages) && body.maxPages > 0 ? Math.min(20, Math.floor(body.maxPages)) : 3;

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    let run: any;
    try {
      run = await getRun(supabase, runId, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: `run_lookup:${msg}` }, { status: 500 });
    }
    const batchLimit = typeof run.batch_limit === "number" && run.batch_limit > 0 ? Math.min(200, Math.floor(run.batch_limit)) : 100;

    const { data: nextItem, error: itemErr } = await supabase
      .from("bubble_obj_import_run_item")
      .select("*")
      .eq("run_id", runId)
      .eq("supabase_user_id", userId)
      .in("status", ["running", "pending"])
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (itemErr) return json({ ok: false, error: `run_item_next:${itemErr.message}` }, { status: 500 });
    const item = nextItem as any;
    if (!item) {
      const doneRes = await supabase.from("bubble_obj_import_run").update({ status: "done", finished_at: new Date().toISOString() } as any).eq("id", runId);
      if (doneRes.error) return json({ ok: false, error: `run_done_update:${doneRes.error.message}` }, { status: 500 });
      return json({ ok: true, done: true }, { status: 200 });
    }

    const bubbleUserId = String(item.bubble_user_id ?? "").trim();
    const objectType = String(item.object_type ?? "").trim();
    if (!bubbleUserId || !objectType) return json({ ok: false, error: "invalid_run_item" }, { status: 500 });

    const { data: cp, error: cpErr } = await supabase
      .from("bubble_obj_import_checkpoint")
      .select("*")
      .eq("bubble_user_id", bubbleUserId)
      .eq("object_type", objectType)
      .eq("supabase_user_id", userId)
      .maybeSingle();
    if (cpErr) return json({ ok: false, error: `checkpoint_lookup:${cpErr.message}` }, { status: 500 });
    const checkpoint = cp as any;
    if (!checkpoint) return json({ ok: false, error: "checkpoint_not_found" }, { status: 500 });

    const creds = await getBubbleObjCredentials();
    const bubbleTimeoutMs = clampInt(Number(process.env.BUBBLE_OBJ_REQUEST_TIMEOUT_MS ?? 0) || 12_000, 3000, 20000);
    let cursor = typeof checkpoint.last_cursor === "number" && Number.isFinite(checkpoint.last_cursor) && checkpoint.last_cursor >= 0 ? checkpoint.last_cursor : 0;
    let checkpointImported = typeof checkpoint.total_imported === "number" && Number.isFinite(checkpoint.total_imported) && checkpoint.total_imported >= 0 ? checkpoint.total_imported : 0;
    const userEmail = String(checkpoint.user_email ?? "").trim();

    let totalReceived = 0;
    let totalSaved = 0;
    let totalDup = 0;
    let totalErr = 0;
    let totalPending = 0;
    let lastError = "";
    let finishedThisType = false;

    for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
      let page;
      try {
        page = await fetchBubbleObjScopedPage({ creds, objectType, cursor, limit: batchLimit, bubbleUserId, userEmail, timeoutMs: bubbleTimeoutMs });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const isTypeNotFound = lastError.includes(":type_not_found:") || lastError.includes("Type not found");
        if (isTypeNotFound) {
          await supabase
            .from("bubble_obj_import_run_item")
            .update({ status: "done", last_error: lastError, total_error: (item.total_error ?? 0) + 1 } as any)
            .eq("id", item.id);
          await supabase
            .from("bubble_obj_import_checkpoint")
            .update({ status: "done" } as any)
            .eq("id", checkpoint.id);
          return json({ ok: true, skippedType: true, reason: "type_not_found", error: lastError, runId, bubbleUserId, objectType }, { status: 200 });
        }
        const isTransient =
          lastError.startsWith("bubble_timeout:") ||
          lastError.startsWith("bubble_429:") ||
          lastError.startsWith("bubble_500:") ||
          lastError.startsWith("bubble_502:") ||
          lastError.startsWith("bubble_503:") ||
          lastError.startsWith("bubble_504:");
        if (isTransient) {
          totalErr += 1;
          const retryAfterIso = new Date(Date.now() + 20_000).toISOString();
          await supabase
            .from("bubble_obj_import_run_item")
            .update({ status: "retrying", last_error: `retry_after=${retryAfterIso}|${lastError}`, total_error: (item.total_error ?? 0) + 1 } as any)
            .eq("id", item.id);
          await supabase
            .from("bubble_obj_import_checkpoint")
            .update({ status: "retrying" } as any)
            .eq("id", checkpoint.id);
          return json({ ok: true, transient: true, retryAfter: retryAfterIso, error: lastError, runId, bubbleUserId, objectType }, { status: 200 });
        }
        totalErr += 1;
        await supabase
          .from("bubble_obj_import_run_item")
          .update({ status: "error", last_error: lastError } as any)
          .eq("id", item.id);
        await supabase
          .from("bubble_obj_import_checkpoint")
          .update({ status: "error" } as any)
          .eq("id", checkpoint.id);
        return json({ ok: false, error: lastError, runId, bubbleUserId, objectType }, { status: 400 });
      }

      const results = page.results ?? [];
      const receivedThisPage = results.length;
      totalReceived += receivedThisPage;

      const stagedRows: any[] = [];
      const controlRows: any[] = [];

      for (const r of results) {
        const raw = r ?? {};
        const bubbleUniqueIdRaw = extractBubbleUniqueId(raw);
        const bubbleUniqueId = bubbleUniqueIdRaw || stableNoIdKey(raw);
        const derivedBubbleUserId = extractBubbleUserIdFromObj(raw);
        const finalBubbleUserId = derivedBubbleUserId || bubbleUserId;
        const name = pickAny(raw, ["nome", "name", "titulo", "title", "descricao", "description"]);
        const missingUniqueId = !bubbleUniqueIdRaw;
        const baseType = parseObjectType(objectType).baseType;
        const isCoreType = isCountableFinalBaseType(baseType) || isDerivedBaseType(baseType) || isScopeOnlyBaseType(baseType);
        const pendingReview = !isCoreType && (missingUniqueId || !finalBubbleUserId || (!name && Object.keys(raw ?? {}).length <= 3));
        if (pendingReview) totalPending += 1;
        const status = pendingReview ? "pending_review" : isStagedOnlyBaseType(baseType) ? "staged_only" : "staged";
        const errorMessage = missingUniqueId ? "missing_unique_id" : "";
        stagedRows.push({
          bubble_object_type: objectType,
          bubble_unique_id: bubbleUniqueId,
          bubble_user_id: finalBubbleUserId || null,
          supabase_user_id: userId,
          run_id: runId,
          cursor,
          fetched_at: new Date().toISOString(),
          status,
          error_message: errorMessage,
          raw_payload_json: raw,
        });
        controlRows.push({
          bubble_object_type: objectType,
          bubble_unique_id: bubbleUniqueId,
          bubble_user_id: finalBubbleUserId || null,
          supabase_user_id: userId,
          status,
          error_message: errorMessage,
          imported_at: new Date().toISOString(),
          raw_payload_json: raw,
        });
      }

      const uniqueIds = Array.from(new Set(stagedRows.map((x) => String(x.bubble_unique_id ?? "").trim()).filter(Boolean)));
      const { data: existing, error: exErr } = uniqueIds.length
        ? await supabase
            .from("bubble_obj_import_control")
            .select("bubble_unique_id")
            .eq("supabase_user_id", userId)
            .eq("bubble_object_type", objectType)
            .in("bubble_unique_id", uniqueIds)
        : { data: [] as any[], error: null as any };
      if (exErr) throw new Error(`control_existing:${exErr.message}`);
      const existingSet = new Set((existing ?? []).map((x: any) => String(x?.bubble_unique_id ?? "").trim()).filter(Boolean));

      const toInsertStaging = stagedRows.filter((x) => !existingSet.has(String(x.bubble_unique_id).trim()));
      const toInsertControl = controlRows.filter((x) => !existingSet.has(String(x.bubble_unique_id).trim()));
      let dupThisPage = stagedRows.length - toInsertStaging.length;
      let savedThisPage = 0;
      let errThisPage = 0;

      if (toInsertStaging.length) {
        const { error: stErr } = await supabase.from("bubble_obj_import_staging").insert(toInsertStaging as any);
        if (stErr) {
          if (String((stErr as any).code ?? "") === "23505") {
            dupThisPage += toInsertStaging.length;
          } else {
            lastError = `staging_insert:${stErr.message}`;
            errThisPage += 1;
          }
        } else {
          savedThisPage += toInsertStaging.length;
        }
      }

      if (toInsertControl.length) {
        const { error: cErr } = await supabase.from("bubble_obj_import_control").insert(toInsertControl as any);
        if (cErr) {
          if (String((cErr as any).code ?? "") === "23505") {
            dupThisPage += toInsertControl.length;
          } else {
            lastError = `control_insert:${cErr.message}`;
            errThisPage += 1;
          }
        }
      }

      totalDup += dupThisPage;
      totalSaved += savedThisPage;
      totalErr += errThisPage;

      cursor += receivedThisPage;
      checkpointImported += savedThisPage;
      const cpUpd = await supabase
        .from("bubble_obj_import_checkpoint")
        .update({ last_cursor: cursor, total_imported: checkpointImported, status: "running" } as any)
        .eq("id", checkpoint.id);
      if (cpUpd.error) throw new Error(`checkpoint_update:${cpUpd.error.message}`);

      if (results.length < batchLimit || page.remaining === 0) {
        finishedThisType = true;
        break;
      }
    }

    const itemUpd = await supabase
      .from("bubble_obj_import_run_item")
      .update({
        status: finishedThisType ? "done" : "running",
        last_cursor: cursor,
        total_received: (item.total_received ?? 0) + totalReceived,
        total_saved_staging: (item.total_saved_staging ?? 0) + totalSaved,
        total_duplicate_ignored: (item.total_duplicate_ignored ?? 0) + totalDup,
        total_error: (item.total_error ?? 0) + totalErr,
        total_pending_review: (item.total_pending_review ?? 0) + totalPending,
        last_error: lastError,
      } as any)
      .eq("id", item.id);
    if (itemUpd.error) throw new Error(`run_item_update:${itemUpd.error.message}`);

    if (finishedThisType) {
      const cpDone = await supabase.from("bubble_obj_import_checkpoint").update({ status: "done" } as any).eq("id", checkpoint.id);
      if (cpDone.error) throw new Error(`checkpoint_done_update:${cpDone.error.message}`);
    }

    return json(
      {
        ok: true,
        runId,
        bubbleUserId,
        objectType,
        batchLimit,
        nextCursor: cursor,
        pageStats: { received: totalReceived, savedStaging: totalSaved, duplicateIgnored: totalDup, error: totalErr, pendingReview: totalPending },
        finishedThisType,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
