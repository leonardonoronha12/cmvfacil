import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { parseBubbleCsvToObjects, type CsvObjectRow } from "../../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

type StoredPath = { path: string; name: string; created_at?: string; updated_at?: string; size?: number };

async function listAllPathsDeep(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, rootPrefix: string, maxDepth = 6, maxItems = 5000) {
  const out: StoredPath[] = [];
  const seen = new Set<string>();
  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: rootPrefix, depth: 0 }];

  while (queue.length && out.length < maxItems) {
    const cur = queue.shift()!;
    if (seen.has(cur.prefix)) continue;
    seen.add(cur.prefix);

    const { data, error } = await supabase.storage.from(bucket).list(cur.prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) continue;

    for (const it of data ?? []) {
      const name = String((it as any)?.name ?? "").trim();
      if (!name) continue;
      const fullPath = `${cur.prefix}/${name}`;
      if ((it as any).id == null) {
        if (cur.depth < maxDepth) queue.push({ prefix: fullPath, depth: cur.depth + 1 });
        continue;
      }

      out.push({
        path: fullPath,
        name,
        created_at: (it as any).created_at,
        updated_at: (it as any).updated_at,
        size: (it as any)?.metadata?.size,
      });
      if (out.length >= maxItems) break;
    }
  }

  return out.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

async function downloadText(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message || "download_failed");
  const buf = await dl.data.arrayBuffer();
  return new TextDecoder().decode(buf);
}

async function downloadBytes(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message || "download_failed");
  return await dl.data.arrayBuffer();
}

function parseBubbleXlsxToObjects(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return { header: [] as string[], rows: [] as CsvObjectRow[] };
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headerRaw = (grid[0] ?? []) as unknown[];
  const header = headerRaw.map((h, i) => {
    const k = String(h ?? "").trim();
    return k ? k : `col_${i + 1}`;
  });
  const normalizedHeader = header.map((h) => h);
  const rows: CsvObjectRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = (grid[i] ?? []) as unknown[];
    if (!r.length) continue;
    const obj: CsvObjectRow = {};
    for (let c = 0; c < normalizedHeader.length; c++) obj[normalizedHeader[c]!] = String(r[c] ?? "").trim();
    const hasAny = Object.values(obj).some((v) => String(v).trim());
    if (hasAny) rows.push(obj);
  }
  return { header: normalizedHeader, rows };
}

function extractEmail(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? String(m[0]).trim().toLowerCase() : null;
}

function looksLikeUsersHeader(header: string[]) {
  const h = new Set(header.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean));
  const hasEmail =
    h.has("email") ||
    h.has("user_email") ||
    h.has("usuario_email") ||
    h.has("e_mail") ||
    h.has("mail") ||
    h.has("login") ||
    h.has("username");
  const hasId = h.has("unique_id") || h.has("_id") || h.has("id") || h.has("bubble_id") || h.has("user_id") || h.has("usuario_id") || h.has("id_usuario");
  return hasEmail && hasId;
}

function normalizeKey(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRowKeys(row: CsvObjectRow) {
  const out: CsvObjectRow = {};
  for (const [k, v] of Object.entries(row)) out[normalizeKey(k)] = String(v ?? "").trim();
  return out;
}

function collectBubbleUserEmails(rows: CsvObjectRow[]) {
  const emails = new Set<string>();
  for (const raw of rows) {
    const row = normalizeRowKeys(raw);
    const emailRaw =
      row.email ||
      row.user_email ||
      row.usuario_email ||
      row.e_mail ||
      row.mail ||
      row.login ||
      row.username ||
      "";
    const email = emailRaw ? extractEmail(emailRaw) : null;
    if (email) emails.add(email);
  }
  return Array.from(emails).sort();
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

    const url = new URL(req.url);
    const maxFiles = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("max") ?? "", 10) || 40));
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const userPrefix = `user:${userId}`;
    const paths = await listAllPathsDeep(supabase, bucket, userPrefix);
    const filesCount = paths.length;
    const candidatesAll = paths
      .filter((p) => {
        const n = p.name.toLowerCase();
        return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
      });

    const score = (p: StoredPath) => {
      const n = p.name.toLowerCase();
      const path = p.path.toLowerCase();
      let s = 0;
      if (n.includes("user") || n.includes("usu")) s += 50;
      if (path.includes("/users") || path.includes("/usuarios") || path.includes("/usuario")) s += 50;
      if (n === "users.csv" || n === "usuarios.csv") s += 50;
      return s;
    };

    const candidates = candidatesAll
      .slice()
      .sort((a, b) => score(b) - score(a) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))
      .slice(0, maxFiles);

    const scanned: string[] = [];
    for (const part of candidates) {
      scanned.push(part.path);
      const lower = part.name.toLowerCase();
      let parsed: { header: string[]; rows: CsvObjectRow[] } = { header: [], rows: [] };
      if (lower.endsWith(".csv")) {
        const text = await downloadText(supabase, bucket, part.path);
        const obj = parseBubbleCsvToObjects(text);
        parsed = { header: obj.header, rows: obj.rows };
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const buf = await downloadBytes(supabase, bucket, part.path);
        const obj = parseBubbleXlsxToObjects(buf);
        parsed = { header: obj.header.map(normalizeKey), rows: obj.rows };
      } else if (lower.endsWith(".json")) {
        const text = await downloadText(supabase, bucket, part.path);
        const raw = JSON.parse(text) as any;
        const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
        const rows: CsvObjectRow[] = arr.filter((x) => x && typeof x === "object").map((x) => x as CsvObjectRow);
        const header = rows.length ? Object.keys(rows[0] ?? {}).map(normalizeKey) : [];
        parsed = { header, rows };
      }

      if (!parsed.rows.length) continue;
      if (!looksLikeUsersHeader(parsed.header.map(normalizeKey))) continue;

      const emails = collectBubbleUserEmails(parsed.rows);
      if (emails.length) {
        return json(
          {
            ok: true,
            sourcePath: part.path,
            emailsCount: emails.length,
            emails,
            scannedCount: scanned.length,
            scanned,
            debug: {
              searchedPrefix: userPrefix,
              filesCount,
              candidatesCount: candidatesAll.length,
              candidatesUsed: candidates.length,
            },
          },
          { status: 200 },
        );
      }
    }

    const sampleFiles = candidatesAll.slice(0, 30).map((p) => p.path);
    return json(
      {
        ok: true,
        sourcePath: null,
        emailsCount: 0,
        emails: [],
        scannedCount: scanned.length,
        scanned,
        debug: {
          searchedPrefix: userPrefix,
          filesCount,
          candidatesCount: candidatesAll.length,
          candidatesUsed: candidates.length,
          sampleFiles,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
