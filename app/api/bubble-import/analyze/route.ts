import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { normalizeKey } from "../../../lib/bubbleCsv";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

const MAX_BYTES = 220_000;
const MAX_XLSX_BYTES = 12_000_000;

function detectDelimiter(headerLine: string) {
  const comma = (headerLine.match(/,/g) ?? []).length;
  const semicolon = (headerLine.match(/;/g) ?? []).length;
  const tab = (headerLine.match(/\t/g) ?? []).length;
  if (semicolon > comma && semicolon > tab) return ";";
  if (tab > comma && tab > semicolon) return "\t";
  return ",";
}

function parseCsvHeader(text: string) {
  const cleaned = text.replace(/^\uFEFF/, "");
  const firstLine = cleaned.split(/\r?\n/)[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const cols = firstLine
    .split(delim)
    .map((c) => c.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .map(normalizeKey)
    .filter(Boolean);
  return cols;
}

function splitFilename(name: string) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base || "arquivo", ext: "" };
  return { stem: base.slice(0, dot) || "arquivo", ext: base.slice(dot).toLowerCase() };
}

function guessTypeFromName(name: string) {
  const n = name.toLowerCase();
  if (n.includes("users")) return "users";
  if (n.includes("fornecedores")) return "fornecedores";
  if (n.includes("notas") || n.includes("nota") || n.includes("fiscais")) return "notas_fiscais";
  if (n.includes("desperd")) return "desperdicios";
  if (n.includes("invent")) return "inventario";
  if (n.includes("pre-preparo") || n.includes("pre_preparo") || n.includes("etiqueta")) return "pre_preparo";
  if (n.includes("ficha") || n.includes("receita")) return "fichas_tecnicas";
  if (n.includes("insumo") || n.includes("ingred") || n.includes("itens")) return "insumos_itens";
  return "unknown";
}

async function listAllPaths(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, userPrefix: string) {
  const { data: level1, error: err1 } = await supabase.storage.from(bucket).list(userPrefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (err1) throw new Error(err1.message);
  const paths: { path: string; name: string; updated_at?: string; size?: number }[] = [];
  const folders = (level1 ?? []).filter((it) => (it as any).id == null);
  const files = (level1 ?? []).filter((it) => (it as any).id != null);

  for (const f of files) {
    paths.push({ path: `${userPrefix}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
  }
  for (const folder of folders) {
    const prefix2 = `${userPrefix}/${folder.name}`;
    const { data: level2, error: err2 } = await supabase.storage.from(bucket).list(prefix2, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (err2) continue;
    for (const f of level2 ?? []) {
      if ((f as any).id == null) continue;
      paths.push({ path: `${prefix2}/${f.name}`, name: f.name, updated_at: (f as any).updated_at, size: (f as any)?.metadata?.size });
    }
  }
  return paths.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

async function fetchHeadText(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${MAX_BYTES - 1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`failed_to_read_${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return text;
}

async function fetchBytes(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`failed_to_read_${res.status}`);
  return await res.arrayBuffer();
}

function parseXlsxHeader(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headerRaw = (grid[0] ?? []) as unknown[];
  return headerRaw.map((h) => normalizeKey(String(h ?? ""))).filter(Boolean);
}

function parseJsonHeader(text: string) {
  const parsed = JSON.parse(text);
  const first =
    (Array.isArray(parsed) ? parsed[0] : parsed && typeof parsed === "object" && Array.isArray((parsed as any).rows) ? (parsed as any).rows[0] : null) ?? null;
  if (!first || typeof first !== "object" || Array.isArray(first)) return [];
  return Object.keys(first as any).map(normalizeKey).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ ok: true, files: [] }, { status: 200 });

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const bucket = "bubble-imports";
  try {
    const userPrefix = `user:${userId}`;
    const paths = await listAllPaths(supabase, bucket, userPrefix);
    const files = [];
    for (const p of paths) {
      const { ext } = splitFilename(p.name);
      const kind = guessTypeFromName(p.name);
      let header: string[] = [];
      let note: string | null = null;
      try {
        if (ext === ".csv") {
          const text = await fetchHeadText(supabase, bucket, p.path);
          header = parseCsvHeader(text);
        } else if (ext === ".json") {
          const text = await fetchHeadText(supabase, bucket, p.path);
          header = parseJsonHeader(text);
        } else if (ext === ".xlsx" || ext === ".xls") {
          const size = p.size ?? null;
          if (typeof size === "number" && size > MAX_XLSX_BYTES) {
            note = "xlsx_muito_grande_para_analisar";
          } else {
            const buf = await fetchBytes(supabase, bucket, p.path);
            header = parseXlsxHeader(buf);
          }
        } else {
          note = "formato_nao_suportado";
        }
      } catch (err) {
        note = err instanceof Error ? err.message : String(err);
      }
      files.push({ path: p.path, name: p.name, size: p.size ?? null, kind, header, note });
    }
    return json({ ok: true, files }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
