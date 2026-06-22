import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

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

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function downloadJsonFromStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) return null;
  try {
    const buf = await dl.data.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    return JSON.parse(text) as any;
  } catch {
    return null;
  }
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, prefix: string) {
  const paths: { path: string; name: string }[] = [];
  async function walk(currentPrefix: string, depth: number) {
    if (depth > 6) return;
    const folders: any[] = [];
    const files: any[] = [];
    for (let offset = 0; offset < 200000; offset += 1000) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(currentPrefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } } as any);
      if (error) throw new Error(error.message);
      const batch = data ?? [];
      for (const it of batch) {
        if ((it as any).id == null) folders.push(it);
        else files.push(it);
      }
      if (batch.length < 1000) break;
    }
    for (const f of files) paths.push({ path: `${currentPrefix}/${f.name}`, name: String(f.name ?? "") });
    for (const folder of folders) await walk(`${currentPrefix}/${folder.name}`, depth + 1);
  }
  await walk(prefix, 0);
  return paths;
}

function pickFirst(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return null;
}

function normalizeMotivoName(value: unknown) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isUuid(userId)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const statePath = `user:${userId}/bootstrap/sync-state.json`;
    const state = await downloadJsonFromStorage(supabase, bucket, statePath);
    const runPrefix = state && typeof state === "object" ? String((state as any)?.runPrefix ?? "").trim().replace(/^\/+|\/+$/g, "") : "";
    if (!runPrefix) return json({ ok: true, rows: [], sourcePath: null }, { status: 200 });

    const all = await listAllPaths(supabase, bucket, runPrefix);
    const candidates = all
      .map((p) => p.path)
      .filter((p) => {
        const lower = p.toLowerCase();
        return lower.includes("bubble-api-motivo") || lower.includes("bubble-api-motivos");
      })
      .sort((a, b) => b.localeCompare(a));

    const latest = candidates[0] ?? "";
    if (!latest) return json({ ok: true, rows: [], sourcePath: null }, { status: 200 });

    const payload = await downloadJsonFromStorage(supabase, bucket, latest);
    const list = payload && typeof payload === "object" ? (payload as any).rows : null;
    const rowsRaw = Array.isArray(list) ? (list as any[]) : [];

    const out: Array<{ id: string; nome: string }> = [];
    const seen = new Set<string>();
    for (const row of rowsRaw) {
      if (!row || typeof row !== "object") continue;
      const id =
        pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]) ||
        pickFirst(row, ["motivo_id", "id_motivo", "codigo", "code", "numero"]) ||
        "";
      const nomeRaw =
        pickFirst(row, ["titulo", "motivo", "nome", "name", "descricao", "descrição", "description", "label", "texto"]) ||
        "";
      const nome = normalizeMotivoName(nomeRaw);
      if (!nome) continue;
      const key = nome.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: String(id || nome).trim(), nome });
      if (out.length >= 300) break;
    }

    return json(
      {
        ok: true,
        sourcePath: latest,
        type: payload && typeof payload === "object" ? String((payload as any)?.type ?? "") : "",
        rows: out,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

