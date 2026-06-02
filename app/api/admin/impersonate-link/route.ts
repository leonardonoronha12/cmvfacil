import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

type StoredPath = { path: string; name: string; updated_at?: string };

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

function normalizeRowKeys(row: CsvObjectRow) {
  const out: CsvObjectRow = {};
  for (const [k, v] of Object.entries(row)) (out as any)[normalizeKey(k)] = String(v ?? "").trim();
  return out;
}

async function emailExistsInUsersUpload(supabase: ReturnType<typeof getSupabaseAdmin>, ownerUserId: string, email: string) {
  const bucket = "bubble-imports";
  await ensureBucket(supabase, bucket);
  const userPrefix = `user:${ownerUserId}`;
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
    const text = await downloadText(supabase, bucket, f.path).catch(() => "");
    if (!text) continue;
    const parsed = parseBubbleCsvToObjects(text);
    for (const rr of parsed.rows) {
      const row = normalizeRowKeys(rr);
      const emailRaw = String((row as any).email ?? (row as any).user_email ?? (row as any).usuario_email ?? (row as any).login ?? (row as any).username ?? "").trim();
      const found = emailRaw ? extractEmail(emailRaw) : null;
      if (found && found === target) return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const email = normalizeEmail(url.searchParams.get("email") ?? "");
    if (!email || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const allowed = await emailExistsInUsersUpload(supabase, userId, email);
    if (!allowed) return json({ ok: false, error: "email_not_in_upload" }, { status: 403 });

    const redirectTo = `${url.origin}/dashboard`;
    await supabase.auth.admin
      .createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { source: "bubble-import" },
      } as any)
      .catch(() => null);

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

    return json({ ok: true, email, redirectTo, actionLink }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
