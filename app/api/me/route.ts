import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { normalizeKey as normalizeKeyFromLib, parseBubbleCsvToObjects, type CsvObjectRow } from "../../lib/bubbleCsv";

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

function normalizeKey(input: string) {
  return normalizeKeyFromLib(input);
}

function extractEmail(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? String(m[0]).trim().toLowerCase() : null;
}

function pickFirst(row: CsvObjectRow, keys: string[]) {
  for (const k of keys) {
    const v = String((row as any)[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function pickKeyLike(row: CsvObjectRow, includeParts: string[], excludeParts: string[] = []) {
  const keys = Object.keys(row);
  for (const k of keys) {
    const kk = k.toLowerCase();
    if (excludeParts.some((p) => kk.includes(p))) continue;
    if (includeParts.some((p) => kk.includes(p))) {
      const v = String((row as any)[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function pickBubbleId(row: CsvObjectRow) {
  return pickFirst(row, ["unique_id", "_id", "id", "bubble_id"]);
}

function normalizeRowKeys(row: CsvObjectRow) {
  const out: CsvObjectRow = {};
  for (const [k, v] of Object.entries(row)) (out as any)[normalizeKey(k)] = String(v ?? "").trim();
  return out;
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

type StoredPath = { path: string; name: string; created_at?: string; updated_at?: string; size?: number };

async function listAllPathsDeep(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, rootPrefix: string, maxDepth = 8, maxItems = 8000) {
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
  const header = headerRaw.map((h, i) => normalizeKey(String(h ?? "")) || `col_${i + 1}`);
  const rows: CsvObjectRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = (grid[i] ?? []) as unknown[];
    if (!r.length) continue;
    const obj: CsvObjectRow = {};
    for (let c = 0; c < header.length; c++) (obj as any)[header[c]] = String(r[c] ?? "").trim();
    const hasAny = Object.values(obj).some((v) => String(v).trim());
    if (hasAny) rows.push(obj);
  }
  return { header, rows };
}

async function loadRowsForPath(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = await downloadText(supabase, bucket, path);
    return parseBubbleCsvToObjects(text).rows;
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buf = await downloadBytes(supabase, bucket, path);
    return parseBubbleXlsxToObjects(buf).rows;
  }
  if (lower.endsWith(".json")) {
    const text = await downloadText(supabase, bucket, path);
    const raw = JSON.parse(text) as any;
    const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
    return arr.filter((x) => x && typeof x === "object").map((x) => x as CsvObjectRow);
  }
  return [];
}

function scoreFile(path: StoredPath, kind: "users" | "empresas") {
  const name = path.name.toLowerCase();
  const p = path.path.toLowerCase();
  let s = 0;
  if (kind === "users") {
    if (name.includes("user") || name.includes("usu")) s += 50;
    if (p.includes("/users") || p.includes("/usuarios") || p.includes("/usuario")) s += 50;
    if (name === "users.csv" || name === "usuarios.csv") s += 50;
  } else {
    if (name.includes("empresa") || name.includes("company") || name.includes("restaurante")) s += 50;
    if (p.includes("/empresas") || p.includes("/empresa") || p.includes("/companies") || p.includes("/company") || p.includes("/restaurante")) s += 50;
    if (name === "empresas.csv" || name === "companies.csv") s += 50;
  }
  return s;
}

function guessCompanyName(rowNorm: CsvObjectRow) {
  const direct =
    pickFirst(rowNorm, ["nome_fantasia", "fantasy_name", "fantasy", "nome", "name", "empresa_nome", "empresa", "restaurante", "restaurante_nome"]) ||
    pickKeyLike(rowNorm, ["nome", "name", "fantasy", "empresa", "company", "restaurante"], ["id", "uuid", "created", "updated", "email", "telefone", "whatsapp", "cnpj"]);
  const v = String(direct ?? "").trim();
  return v || "—";
}

function extractUrlFromText(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const url = s.match(/https?:\/\/[^\s"')]+/i);
  if (url) return String(url[0] ?? "").trim();
  return "";
}

function resolveOwnerEmailFromCompanyRow(row: CsvObjectRow) {
  const ownerRef =
    pickFirst(row, [
      "user_id",
      "usuario_id",
      "id_usuario",
      "owner",
      "owner_id",
      "created_by",
      "createdby",
      "created_by_user",
      "created_by_id",
      "criador",
      "criador_id",
      "responsavel",
      "responsavel_id",
      "account",
      "account_id",
      "user",
      "usuario",
    ]) || pickKeyLike(row, ["user", "usuario", "owner", "created", "criador", "responsavel", "account"], ["nome", "name", "empresa", "company", "restaurante"]);
  const direct = extractEmail(ownerRef);
  if (direct) return direct;
  for (const v of Object.values(row)) {
    const em = extractEmail(String(v ?? ""));
    if (em) return em;
  }
  return null;
}

function normalizePhone(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return raw;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

function guessUserAvatar(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["avatar", "foto", "foto_url", "imagem", "imagem_url", "photo", "photo_url", "image", "image_url", "profile_photo", "profile_image"]) ||
    pickKeyLike(rowNorm, ["avatar", "foto", "imagem", "photo", "image"], ["id", "uuid"]);
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const url = extractUrlFromText(v);
  if (url) return url;
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v) as any;
      const candidate = extractUrlFromText(String(parsed?.url ?? parsed?.image ?? parsed?.photo ?? parsed?.src ?? ""));
      if (candidate) return candidate;
    } catch {}
  }
  return "";
}

function guessUserNameParts(rowNorm: CsvObjectRow) {
  const first =
    pickFirst(rowNorm, ["nome", "first_name", "firstname", "nome_usuario", "usuario_nome"]) ||
    pickKeyLike(rowNorm, ["nome", "first", "user"], ["sobrenome", "last", "empresa", "company", "email", "whatsapp", "telefone"]);
  const last = pickFirst(rowNorm, ["sobrenome", "last_name", "lastname"]);
  const full = pickFirst(rowNorm, ["nome_completo", "full_name", "name"]);
  const f = String(first ?? "").trim();
  const l = String(last ?? "").trim();
  if (f && l) return { first: f, last: l, full: `${f} ${l}`.trim() };
  const base = f || String(full ?? "").trim();
  if (!base) return { first: "", last: "", full: "" };
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: base, last: "", full: base };
  return { first: parts[0] ?? base, last: parts.slice(1).join(" "), full: parts.join(" ") };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const uid = String(userId ?? "").trim();
    if (!isUuid(uid)) return json({ ok: false, error: "user_not_supabase_uuid" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const authUser = await supabase.auth.admin.getUserById(uid);
    if (authUser.error) return json({ ok: false, error: `auth_get_user:${authUser.error.message}` }, { status: 400 });
    const email = String(authUser.data?.user?.email ?? "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "missing_supabase_email" }, { status: 400 });

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const userPrefix = `user:${uid}`;
    const paths = await listAllPathsDeep(supabase, bucket, userPrefix);

    const fileCandidates = paths
      .filter((p) => {
        const n = p.name.toLowerCase();
        return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
      })
      .slice()
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));

    const pickBest = (kind: "users" | "empresas") =>
      fileCandidates.slice().sort((a, b) => scoreFile(b, kind) - scoreFile(a, kind) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))[0] ??
      null;

    const usersFile = pickBest("users");
    const empresasFile = pickBest("empresas");

    let bubbleRow: CsvObjectRow | null = null;
    let bubbleRowNorm: CsvObjectRow | null = null;

    if (usersFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, usersFile.path, usersFile.name);
      for (const rr of rawRows) {
        const row = normalizeRowKeys(rr);
        const emailRaw =
          pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
          pickKeyLike(row, ["email", "mail", "login", "username"], ["id", "uuid"]);
        let found = emailRaw ? extractEmail(emailRaw) : null;
        if (!found) {
          for (const v of Object.values(row)) {
            found = extractEmail(String(v ?? ""));
            if (found) break;
          }
        }
        if (found && found === email) {
          bubbleRow = rr;
          bubbleRowNorm = row;
          break;
        }
      }
    }

    const nameParts = bubbleRowNorm ? guessUserNameParts(bubbleRowNorm) : { first: "", last: "", full: "" };
    const whatsappRaw = bubbleRowNorm
      ? pickFirst(bubbleRowNorm, ["whatsapp", "telefone", "celular", "fone", "phone", "phone_number"]) || pickKeyLike(bubbleRowNorm, ["whatsapp", "telefone", "celular", "phone"], ["id", "uuid"])
      : "";
    const whatsapp = whatsappRaw ? normalizePhone(whatsappRaw) : "";
    const avatarUrl = bubbleRowNorm ? guessUserAvatar(bubbleRowNorm) : "";

    let companies: Array<{ id: string; name: string }> = [];
    if (empresasFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, empresasFile.path, empresasFile.name);
      const byId = new Map<string, string>();
      for (const rr of rawRows) {
        const row = normalizeRowKeys(rr);
        const ownerEmail = resolveOwnerEmailFromCompanyRow(row);
        if (!ownerEmail || ownerEmail !== email) continue;
        const companyId = pickBubbleId(row) || pickFirst(row, ["empresa_id", "company_id", "restaurante_id", "restaurant_id", "id", "_id", "unique_id", "bubble_id"]);
        const name = guessCompanyName(row);
        if (!name || name === "—") continue;
        const id = String(companyId || `${empresasFile.path}:${companies.length + 1}`).trim();
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, name);
      }
      companies = Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
      companies.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    }

    const companyName = companies[0]?.name ?? "";

    return json({
      ok: true,
      userId: uid,
      email,
      nome: nameParts.first || "",
      sobrenome: nameParts.last || "",
      nomeCompleto: nameParts.full || "",
      whatsapp: whatsapp || "",
      avatarUrl: avatarUrl || "",
      companyName,
      companies,
      source: {
        usersFile: usersFile ? { path: usersFile.path, name: usersFile.name } : null,
        empresasFile: empresasFile ? { path: empresasFile.path, name: empresasFile.name } : null,
        hasBubbleMatch: Boolean(bubbleRowNorm),
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

