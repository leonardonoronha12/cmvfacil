import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { parseBubbleCsvToObjects, type CsvObjectRow, normalizeKey as normalizeKeyFromLib } from "../../../lib/bubbleCsv";
import { getAuthCookieDomain, shouldUseSecureCookies } from "../../../lib/cookieSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function randomPassword() {
  return crypto.randomBytes(18).toString("base64url");
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
  const emails = new Set(parseCsvEnv(process.env.ADMIN_USER_EMAILS).map((x) => x.toLowerCase()));
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

type StoredPath = { path: string; name: string; updated_at?: string };

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = String(email ?? "").trim().toLowerCase();
  if (!target || !target.includes("@")) return null;
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
      out.push({ path: fullPath, name, updated_at: (it as any).updated_at });
      if (out.length >= maxItems) break;
    }
  }
  return out.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name));
}

function scoreUsersFile(p: StoredPath) {
  const name = p.name.toLowerCase();
  const path = p.path.toLowerCase();
  let s = 0;
  if (name.includes("user") || name.includes("usu")) s += 50;
  if (path.includes("/users") || path.includes("/usuarios") || path.includes("/usuario")) s += 50;
  if (name === "users.csv" || name === "usuarios.csv") s += 50;
  return s;
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

function normalizeRowKeys(row: CsvObjectRow) {
  const out: CsvObjectRow = {};
  for (const [k, v] of Object.entries(row)) (out as any)[normalizeKey(k)] = String(v ?? "").trim();
  return out;
}

function parseBubbleXlsxToRows(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) return [] as CsvObjectRow[];
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
  return rows;
}

async function emailExistsInUsersUpload(supabase: ReturnType<typeof getSupabaseAdmin>, userPrefix: string, email: string) {
  const bucket = "bubble-imports";
  await ensureBucket(supabase, bucket);
  const paths = await listAllPathsDeep(supabase, bucket, userPrefix);
  const candidates = paths
    .filter((p) => {
      const n = p.name.toLowerCase();
      return n.endsWith(".csv") || n.endsWith(".json") || n.endsWith(".xlsx") || n.endsWith(".xls");
    })
    .sort((a, b) => scoreUsersFile(b) - scoreUsersFile(a) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))
    .slice(0, 30);

  const target = normalizeEmail(email);
  for (const f of candidates) {
    const lower = f.name.toLowerCase();
    let rawRows: CsvObjectRow[] = [];
    if (lower.endsWith(".csv")) {
      const text = await downloadText(supabase, bucket, f.path).catch(() => "");
      if (!text) continue;
      rawRows = parseBubbleCsvToObjects(text).rows;
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const buf = await downloadBytes(supabase, bucket, f.path).catch(() => null);
      if (!buf) continue;
      rawRows = parseBubbleXlsxToRows(buf);
    } else if (lower.endsWith(".json")) {
      const text = await downloadText(supabase, bucket, f.path).catch(() => "");
      if (!text) continue;
      const raw = JSON.parse(text) as any;
      const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
      rawRows = arr.filter((x) => x && typeof x === "object").map((x) => x as CsvObjectRow);
    }

    for (const rr of rawRows) {
      const row = normalizeRowKeys(rr);
      const emailRaw = String((row as any).email ?? (row as any).user_email ?? (row as any).usuario_email ?? (row as any).login ?? (row as any).username ?? "").trim();
      const found = emailRaw ? extractEmail(emailRaw) : null;
      if (found && found === target) return true;
    }
  }
  return false;
}

async function emailAllowedByCache(supabase: ReturnType<typeof getSupabaseAdmin>, userPrefix: string, email: string) {
  const bucket = "bubble-imports";
  await ensureBucket(supabase, bucket);
  const cachePath = `${userPrefix}/_cache/bubble-users-emails.json`;
  const payload = await downloadJsonFromStorage(supabase, bucket, cachePath);
  const list = Array.isArray(payload?.emails) ? (payload.emails as unknown[]) : [];
  const normalized = normalizeEmail(email);
  return list.some((e) => normalizeEmail(String(e ?? "")) === normalized);
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const email = normalizeEmail(url.searchParams.get("email") ?? "");
    const requestedTargetUserId = String(url.searchParams.get("userId") ?? "").trim().toLowerCase();
    const mode = String(url.searchParams.get("mode") ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (requestedTargetUserId && !isUuid(requestedTargetUserId)) {
      return json({ ok: false, error: "invalid_target_user_id" }, { status: 400 });
    }

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    let targetUserId = requestedTargetUserId;
    if (targetUserId) {
      const { data, error } = await supabase.auth.admin.getUserById(targetUserId);
      if (error || !data?.user) return json({ ok: false, error: "auth_user_not_found" }, { status: 404 });
      if (normalizeEmail(data.user.email ?? "") !== email) {
        return json({ ok: false, error: "target_user_email_mismatch" }, { status: 400 });
      }
    } else {
      const requesterRaw = String(userId ?? "").trim().toLowerCase();
      const requesterUuid = isUuid(requesterRaw) ? requesterRaw : requesterRaw.includes("@") ? await findAuthUserIdByEmail(supabase, requesterRaw) : null;
      const candidatePrefixes = (() => {
        const out = new Set<string>();
        if (isUuid(requesterRaw)) out.add(`user:${requesterRaw}`);
        if (requesterRaw.includes("@")) out.add(`user:${requesterRaw}`);
        if (requesterUuid && isUuid(requesterUuid)) out.add(`user:${requesterUuid}`);
        return Array.from(out);
      })();
      if (!candidatePrefixes.length) return json({ ok: false, error: "cannot_resolve_user_prefix", requester: requesterRaw }, { status: 400 });

      let allowed = false;
      for (const prefix of candidatePrefixes) {
        allowed = (await emailAllowedByCache(supabase, prefix, email)) || (await emailExistsInUsersUpload(supabase, prefix, email));
        if (allowed) break;
      }
      if (!allowed) return json({ ok: false, error: "email_not_in_upload" }, { status: 403 });
      targetUserId = (await findAuthUserIdByEmail(supabase, email)) ?? "";
    }

    const redirectTo = `${url.origin}/auth/impersonate`;
    if (!targetUserId) return json({ ok: false, error: "auth_user_not_found" }, { status: 404 });

    let data: any = null;
    let error: any = null;
    const magic = await supabase.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } } as any);
    data = magic.data as any;
    error = magic.error as any;
    if (error) {
      const invite = await supabase.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } } as any);
      data = invite.data as any;
      error = invite.error as any;
    }
    if (error) return json({ ok: false, error: error.message }, { status: 500 });

    const actionLink = (data as any)?.properties?.action_link ? String((data as any).properties.action_link) : "";
    if (!actionLink) return json({ ok: false, error: "missing_action_link" }, { status: 500 });

    if (mode === "redirect" || mode === "session") {
      const verifyRes = await fetch(actionLink, { method: "GET", redirect: "manual", cache: "no-store" });
      const location = String(verifyRes.headers.get("location") ?? "").trim();
      const hash = location.includes("#") ? location.slice(location.indexOf("#") + 1) : "";
      const params = new URLSearchParams(hash);
      const accessToken = String(params.get("access_token") ?? "").trim();
      const refreshToken = String(params.get("refresh_token") ?? "").trim();
      if (!accessToken) return json({ ok: false, error: "missing_access_token_from_verify_redirect" }, { status: 500 });

      const res =
        mode === "session"
          ? json({ ok: true, redirectTo: "/dashboard" }, { status: 200 })
          : NextResponse.redirect(new URL("/dashboard", url.origin), { status: 302 });
      const secure = shouldUseSecureCookies(req);
      const domain = getAuthCookieDomain(req);
      const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", ...(domain ? { domain } : {}) };
      res.cookies.set({ name: "cmv_at", value: accessToken, ...cookieBase, maxAge: 60 * 20 });
      if (refreshToken) res.cookies.set({ name: "cmv_rt", value: refreshToken, ...cookieBase, maxAge: 60 * 60 * 24 * 2 });
      return res;
    }

    return json({ ok: true, email, redirectTo, actionLink }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
