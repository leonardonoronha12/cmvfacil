import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { parseBubbleCsvToObjects, type CsvObjectRow, normalizeKey as normalizeKeyFromLib } from "../../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(parseCsvEnv(process.env.ADMIN_USER_EMAILS).map((x) => x.toLowerCase()));
  const raw = userId.toLowerCase();
  if (!raw) return false;
  if (raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
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

function pickBest(paths: StoredPath[], kind: "users" | "empresas") {
  const candidates = paths.filter((p) => {
    const n = p.name.toLowerCase();
    return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
  });
  const sorted = candidates
    .slice()
    .sort((a, b) => scoreFile(b, kind) - scoreFile(a, kind) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
  return { best: sorted[0] ?? null, candidatesCount: candidates.length, sampleFiles: sorted.slice(0, 20).map((p) => p.path) };
}

function guessCompanyName(rowNorm: CsvObjectRow) {
  const direct =
    pickFirst(rowNorm, ["nome_fantasia", "fantasy_name", "fantasy", "nome", "name", "empresa_nome", "empresa", "restaurante", "restaurante_nome"]) ||
    pickKeyLike(rowNorm, ["nome", "name", "fantasy", "empresa", "company", "restaurante"], ["id", "uuid", "created", "updated", "email", "telefone", "whatsapp", "cnpj"]);
  const v = String(direct ?? "").trim();
  return v || "—";
}

function randomPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

async function loadAuthEmailToIdMap(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const map = new Map<string, string>();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const email = String(u?.email ?? "").trim().toLowerCase();
      if (id && email) map.set(email, id);
    }
    if (users.length < 1000) break;
  }
  return map;
}

async function loadAuthIdToEmailMap(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const map = new Map<string, string>();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim().toLowerCase();
      const email = String(u?.email ?? "").trim().toLowerCase();
      if (id && email) map.set(id, email);
    }
    if (users.length < 1000) break;
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const url = new URL(req.url);
    const targetUserId = isUuid(userId) ? userId : String(url.searchParams.get("userId") ?? "").trim();
    if (!targetUserId || !isUuid(targetUserId)) return json({ ok: false, error: "missing_or_invalid_userId" }, { status: 400 });

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);
    const userPrefix = `user:${targetUserId}`;
    const paths = await listAllPathsDeep(supabase, bucket, userPrefix);

    const usersPick = pickBest(paths, "users");
    const empresasPick = pickBest(paths, "empresas");
    const usersFile = usersPick.best;
    const empresasFile = empresasPick.best;

    const emailToAuthId = await loadAuthEmailToIdMap(supabase);
    const authIdToEmail = await loadAuthIdToEmailMap(supabase);
    let refreshedAuth = false;
    const ensureAuthUserId = async (email: string) => {
      const normalized = String(email ?? "").trim().toLowerCase();
      if (!normalized) return null;
      const existing = emailToAuthId.get(normalized) ?? null;
      if (existing) return existing;
      const created = await supabase.auth.admin
        .createUser({
          email: normalized,
          password: randomPassword(),
          email_confirm: true,
          user_metadata: { source: "bubble-import" },
        } as any)
        .catch((e: any) => ({ error: e, data: null }));
      const newId = (created as any)?.data?.user?.id ? String((created as any).data.user.id).trim() : "";
      if (newId) {
        emailToAuthId.set(normalized, newId);
        authIdToEmail.set(newId.toLowerCase(), normalized);
        return newId;
      }
      if (!refreshedAuth) {
        refreshedAuth = true;
        const fresh = await loadAuthEmailToIdMap(supabase).catch(() => null);
        if (fresh) for (const [k, v] of fresh.entries()) emailToAuthId.set(k, v);
      }
      return emailToAuthId.get(normalized) ?? null;
    };

    const bubbleUserIdToEmail = new Map<string, string>();
    const bubbleEmails = new Set<string>();

    if (usersFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, usersFile.path, usersFile.name);
      for (const rr of rawRows) {
        const row = normalizeRowKeys(rr);
        const bubbleId = pickBubbleId(row) || pickFirst(row, ["user_id", "usuario_id", "id_usuario"]);
        const emailRaw = pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) || pickKeyLike(row, ["email", "mail", "login", "user"]);
        const email = emailRaw ? extractEmail(emailRaw) : null;
        if (!bubbleId || !email) continue;
        bubbleUserIdToEmail.set(String(bubbleId).trim(), email);
        bubbleEmails.add(email);
      }
    }

    const emailToCompanies = new Map<string, Array<{ id: string; name: string }>>();
    if (empresasFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, empresasFile.path, empresasFile.name);
      for (const rr of rawRows) {
        const row = normalizeRowKeys(rr);
        const companyId = pickBubbleId(row) || pickFirst(row, ["empresa_id", "id", "_id", "unique_id", "bubble_id"]);
        if (!companyId) continue;
        const name = guessCompanyName(row);
        const ownerRef =
          pickFirst(row, ["user_id", "usuario_id", "id_usuario", "owner", "owner_id", "created_by", "createdby", "criador", "criador_id", "responsavel_id"]) ||
          pickKeyLike(row, ["user", "usuario", "owner", "created", "criador", "responsavel"], ["email", "nome", "name"]);
        if (!ownerRef) continue;
        const ownerText = String(ownerRef).trim();
        const ownerEmail = extractEmail(ownerText);
        const ownerUuidEmail = !ownerEmail && isUuid(ownerText) ? authIdToEmail.get(ownerText.toLowerCase()) ?? null : null;
        const ownerBubbleEmail = !ownerEmail && !ownerUuidEmail ? bubbleUserIdToEmail.get(ownerText) ?? null : null;
        const email = ownerEmail || ownerUuidEmail || ownerBubbleEmail;
        if (!email) continue;
        bubbleEmails.add(email);
        const list = emailToCompanies.get(email) ?? [];
        list.push({ id: String(companyId).trim(), name });
        emailToCompanies.set(email, list);
      }
    }

    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    const emailsSorted = Array.from(bubbleEmails).sort((a, b) => collator.compare(a, b));
    for (const email of emailsSorted) {
      await ensureAuthUserId(email);
    }

    const rows = emailsSorted.map((email) => {
        const companiesRaw = emailToCompanies.get(email) ?? [];
        const companies = companiesRaw
          .slice()
          .sort((a, b) => collator.compare(a.name, b.name))
          .filter((c, idx, arr) => idx === arr.findIndex((x) => x.id === c.id));
        const authUserId = emailToAuthId.get(email) ?? null;
        return { email, authUserId, companies, companiesCount: companies.length };
      });

    return json(
      {
        ok: true,
        targetUserId,
        files: {
          users: usersFile ? { path: usersFile.path, name: usersFile.name } : null,
          empresas: empresasFile ? { path: empresasFile.path, name: empresasFile.name } : null,
        },
        debug: {
          searchedPrefix: userPrefix,
          filesCount: paths.length,
          usersCandidates: usersPick.candidatesCount,
          empresasCandidates: empresasPick.candidatesCount,
          sampleFiles: Array.from(new Set([...usersPick.sampleFiles, ...empresasPick.sampleFiles])).slice(0, 30),
        },
        rows,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
