import { NextRequest, NextResponse } from "next/server";
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

async function uploadJsonToStorage(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
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

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterRaw = String(userId ?? "").trim().toLowerCase();
    const requesterUuid = isUuid(requesterRaw) ? requesterRaw : requesterRaw.includes("@") ? await findAuthUserIdByEmail(supabase, requesterRaw) : null;

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const candidatePrefixes = (() => {
      const out = new Set<string>();
      if (isUuid(requesterRaw)) out.add(`user:${requesterRaw}`);
      if (requesterRaw.includes("@")) out.add(`user:${requesterRaw}`);
      if (requesterUuid && isUuid(requesterUuid)) out.add(`user:${requesterUuid}`);
      return Array.from(out);
    })();

    if (!candidatePrefixes.length) return json({ ok: false, error: "cannot_resolve_user_prefix", requester: requesterRaw }, { status: 400 });

    let userPrefix = candidatePrefixes[0]!;
    let paths: StoredPath[] = [];
    let bestUsersScore = -1;
    for (const prefix of candidatePrefixes) {
      const p = await listAllPathsDeep(supabase, bucket, prefix);
      const usersCandidates = p.filter((x) => {
        const n = x.name.toLowerCase();
        return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
      });
      const scoreTop = usersCandidates.length ? Math.max(...usersCandidates.map((x) => scoreFile(x, "users"))) : -1;
      if (scoreTop > bestUsersScore || (scoreTop === bestUsersScore && p.length > paths.length)) {
        bestUsersScore = scoreTop;
        userPrefix = prefix;
        paths = p;
      }
    }

    const usersPick = pickBest(paths, "users");
    const empresasPick = pickBest(paths, "empresas");
    let usersFile = usersPick.best;
    const empresasFile = empresasPick.best;

    const emailToAuthId = await loadAuthEmailToIdMap(supabase);
    const authIdToEmail = await loadAuthIdToEmailMap(supabase);

    const bubbleUserIdToEmail = new Map<string, string>();
    const bubbleEmails = new Set<string>();

    const parseUsersFile = async (file: StoredPath) => {
      const rawRows = await loadRowsForPath(supabase, bucket, file.path, file.name);
      for (const rr of rawRows) {
        const row = normalizeRowKeys(rr);
        const emailRaw =
          pickFirst(row, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
          pickKeyLike(row, ["email", "mail", "login", "username"], ["id", "uuid"]);
        let email = emailRaw ? extractEmail(emailRaw) : null;
        if (!email) {
          for (const v of Object.values(row)) {
            email = extractEmail(String(v ?? ""));
            if (email) break;
          }
        }
        if (email) bubbleEmails.add(email);
        const bubbleId = pickBubbleId(row) || pickFirst(row, ["user_id", "usuario_id", "id_usuario"]);
        if (bubbleId && email) bubbleUserIdToEmail.set(String(bubbleId).trim(), email);
      }
    };

    if (usersFile) {
      await parseUsersFile(usersFile);
    }

    if (!bubbleEmails.size) {
      const candidates = paths
        .filter((p) => {
          const n = p.name.toLowerCase();
          return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
        })
        .slice()
        .sort((a, b) => scoreFile(b, "users") - scoreFile(a, "users") || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))
        .slice(0, 20);

      for (const cand of candidates) {
        if (usersFile?.path && cand.path === usersFile.path) continue;
        bubbleEmails.clear();
        bubbleUserIdToEmail.clear();
        await parseUsersFile(cand);
        if (bubbleEmails.size) {
          usersFile = cand;
          break;
        }
      }
    }

    const emailToCompanies = new Map<string, Array<{ id: string; name: string }>>();
    const bubbleUserIds = new Set(Array.from(bubbleUserIdToEmail.keys()).map((x) => String(x ?? "").trim()));

    const resolveEmailFromValue = (value: string) => {
      const raw = String(value ?? "").trim();
      if (!raw) return null;
      const em = extractEmail(raw);
      if (em) return em;
      if (isUuid(raw)) return authIdToEmail.get(raw.toLowerCase()) ?? null;
      if (bubbleUserIdToEmail.has(raw)) return bubbleUserIdToEmail.get(raw) ?? null;
      const bubbleIdInJson = raw.match(/"(?:unique_id|_id|id|bubble_id|user_id)"\s*:\s*"([^"]+)"/i);
      const extracted = bubbleIdInJson ? String(bubbleIdInJson[1] ?? "").trim() : "";
      if (extracted && bubbleUserIds.has(extracted)) return bubbleUserIdToEmail.get(extracted) ?? null;
      const loose = raw.match(/\b\d{9,}x\d+\b/);
      if (loose) {
        const v = String(loose[0] ?? "").trim();
        if (v && bubbleUserIds.has(v)) return bubbleUserIdToEmail.get(v) ?? null;
      }
      return null;
    };

    const resolveOwnerEmailFromCompanyRow = (row: CsvObjectRow) => {
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

      const direct = resolveEmailFromValue(ownerRef);
      if (direct) return direct;

      for (const v of Object.values(row)) {
        const em = resolveEmailFromValue(String(v ?? ""));
        if (em) return em;
      }
      return null;
    };

    const parseEmpresasFile = async (file: StoredPath) => {
      const rawRows = await loadRowsForPath(supabase, bucket, file.path, file.name);
      let linked = 0;
      let scanned = 0;
      for (const rr of rawRows) {
        scanned++;
        const row = normalizeRowKeys(rr);
        const companyId = pickBubbleId(row) || pickFirst(row, ["empresa_id", "company_id", "restaurante_id", "id", "_id", "unique_id", "bubble_id"]);
        const name = guessCompanyName(row);
        const email = resolveOwnerEmailFromCompanyRow(row);
        if (!email) continue;
        bubbleEmails.add(email);
        const list = emailToCompanies.get(email) ?? [];
        list.push({ id: String(companyId || `${file.path}:${scanned}`).trim(), name });
        emailToCompanies.set(email, list);
        linked++;
      }
      return { linked, scanned };
    };

    let empresasStats: { linked: number; scanned: number } | null = null;
    if (empresasFile) {
      empresasStats = await parseEmpresasFile(empresasFile);
      if (empresasStats.linked === 0) {
        const candidates = paths
          .filter((p) => {
            const n = p.name.toLowerCase();
            return n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".json");
          })
          .slice()
          .sort((a, b) => scoreFile(b, "empresas") - scoreFile(a, "empresas") || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || b.name.localeCompare(a.name))
          .slice(0, 20);
        for (const cand of candidates) {
          if (cand.path === empresasFile.path) continue;
          const before = emailToCompanies.size;
          const st = await parseEmpresasFile(cand);
          if (st.linked > 0 && emailToCompanies.size > before) {
            empresasStats = st;
            break;
          }
        }
      }
    }

    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    const emailsSorted = Array.from(bubbleEmails).sort((a, b) => collator.compare(a, b));

    const rows = emailsSorted.map((email) => {
        const companiesRaw = emailToCompanies.get(email) ?? [];
        const companies = companiesRaw
          .slice()
          .sort((a, b) => collator.compare(a.name, b.name))
          .filter((c, idx, arr) => idx === arr.findIndex((x) => x.id === c.id));
        const authUserId = emailToAuthId.get(email) ?? null;
        return { email, authUserId, companies, companiesCount: companies.length };
      });

    const now = new Date().toISOString();
    const cachePath = `${userPrefix}/_cache/bubble-users-emails.json`;
    await uploadJsonToStorage(supabase, bucket, cachePath, { v: 1, updatedAt: now, emails: emailsSorted }).catch(() => null);

    return json(
      {
        ok: true,
        targetUserId: requesterUuid,
        files: {
          users: usersFile ? { path: usersFile.path, name: usersFile.name } : null,
          empresas: empresasFile ? { path: empresasFile.path, name: empresasFile.name } : null,
        },
        debug: {
          requester: requesterRaw,
          requesterUuid,
          candidatePrefixes,
          selectedPrefix: userPrefix,
          searchedPrefix: userPrefix,
          filesCount: paths.length,
          usersCandidates: usersPick.candidatesCount,
          empresasCandidates: empresasPick.candidatesCount,
          empresasStats,
          sampleFiles: Array.from(new Set([...usersPick.sampleFiles, ...empresasPick.sampleFiles])).slice(0, 30),
        },
        cache: { path: cachePath, updatedAt: now },
        rows,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
