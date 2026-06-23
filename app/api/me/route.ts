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

function extractBubbleIdFromText(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const bubbleIdInJson = s.match(/"(?:unique_id|_id|id|bubble_id|company_id|empresa_id|restaurante_id|restaurant_id|account_id)"\s*:\s*"([^"]+)"/i);
  if (bubbleIdInJson) {
    const extracted = String(bubbleIdInJson[1] ?? "").trim();
    if (extracted) return extracted;
  }
  const loose = s.match(/\b\d{6,}x\d+\b/);
  if (loose) return String(loose[0] ?? "").trim();
  return "";
}

function formatDateTimePt(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return raw;
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} às ${hh}:${mi}h`;
}

function guessJoinedAt(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["data_admissao", "admissao", "created_at", "created_date", "created", "signup_at", "data_criacao", "data"]) ||
    pickKeyLike(rowNorm, ["admiss", "created", "signup", "data"], ["updated", "delete", "id", "uuid", "email", "whatsapp", "telefone"]);
  return formatDateTimePt(raw);
}

function guessRole(rowNorm: CsvObjectRow) {
  const raw =
    pickFirst(rowNorm, ["permissao", "permission", "role", "nivel", "type", "user_type", "tipo"]) ||
    pickKeyLike(rowNorm, ["permiss", "role", "admin", "owner", "nivel", "tipo"], ["email", "nome", "name", "company", "empresa"]);
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("admin") || s.includes("administrador") || s.includes("owner") || s.includes("propriet")) return "Administrador";
  if (s.includes("colab")) return "Colaborador";
  if (s === "true" || s === "1" || s === "sim") return "Administrador";
  return "";
}

function guessPlanFromCompanyRow(rowNorm: CsvObjectRow) {
  const planRaw =
    pickFirst(rowNorm, ["plano", "plan", "plan_name", "assinatura_plano", "subscription_plan", "tipo_plano"]) ||
    pickKeyLike(rowNorm, ["plano", "plan", "assinatura", "subscription"], ["id", "uuid", "email", "telefone", "whatsapp"]);
  const statusRaw =
    pickFirst(rowNorm, ["status", "assinatura_status", "subscription_status", "plano_status"]) ||
    pickKeyLike(rowNorm, ["status", "ativo", "assinatura", "subscription"], ["id", "uuid", "email", "telefone", "whatsapp", "plano", "plan"]);
  const cardRaw =
    pickFirst(rowNorm, ["card_last4", "last4", "cartao_final", "final_cartao", "card", "cartao"]) ||
    pickKeyLike(rowNorm, ["last4", "cartao", "card"], ["id", "uuid", "email"]);

  const type = String(planRaw ?? "").trim();
  const status = String(statusRaw ?? "").trim();
  const digits = String(cardRaw ?? "").replace(/[^\d]/g, "");
  const cardLast4 = digits.length >= 4 ? digits.slice(-4) : "";
  return { type, status, cardLast4 };
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
    let usersAllRows: CsvObjectRow[] = [];

    if (usersFile) {
      usersAllRows = await loadRowsForPath(supabase, bucket, usersFile.path, usersFile.name);
      for (const rr of usersAllRows) {
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

    const companyIdToName = new Map<string, string>();
    const companyOwnerEmailsById = new Map<string, Set<string>>();
    const companyRowNormById = new Map<string, CsvObjectRow>();
    const myCompanyIds = new Set<string>();

    if (empresasFile) {
      const rawRows = await loadRowsForPath(supabase, bucket, empresasFile.path, empresasFile.name);
      let idx = 0;
      for (const rr of rawRows) {
        idx++;
        const row = normalizeRowKeys(rr);
        const companyIdRaw = pickBubbleId(row) || pickFirst(row, ["empresa_id", "company_id", "restaurante_id", "restaurant_id", "id", "_id", "unique_id", "bubble_id"]);
        const name = guessCompanyName(row);
        const companyId = String(companyIdRaw || "").trim() || (name && name !== "—" ? `${empresasFile.path}:${idx}` : "");
        if (companyId && name && name !== "—") {
          if (!companyIdToName.has(companyId)) companyIdToName.set(companyId, name);
          if (!companyRowNormById.has(companyId)) companyRowNormById.set(companyId, row);
        }
        const ownerEmail = resolveOwnerEmailFromCompanyRow(row);
        if (companyId && ownerEmail) {
          const set = companyOwnerEmailsById.get(companyId) ?? new Set<string>();
          set.add(ownerEmail);
          companyOwnerEmailsById.set(companyId, set);
        }
        if (companyId && ownerEmail && ownerEmail === email) myCompanyIds.add(companyId);
      }
    }

    if (bubbleRowNorm && companyIdToName.size) {
      const knownIds = new Set(Array.from(companyIdToName.keys()).map((x) => String(x ?? "").trim()).filter(Boolean));
      const candidates: string[] = [];
      for (const k of Object.keys(bubbleRowNorm)) {
        const kk = k.toLowerCase();
        if (kk.includes("empresa") || kk.includes("company") || kk.includes("restaurante") || kk.includes("restaurant") || kk.includes("account")) {
          candidates.push(String((bubbleRowNorm as any)[k] ?? ""));
        }
      }
      for (const v of Object.values(bubbleRowNorm)) candidates.push(String(v ?? ""));
      for (const raw of candidates) {
        const s = String(raw ?? "").trim();
        if (!s || s.includes("@")) continue;
        const direct = knownIds.has(s) ? s : "";
        const extracted = direct || extractBubbleIdFromText(s);
        if (extracted && knownIds.has(extracted)) myCompanyIds.add(extracted);
      }
    }

    const companies = Array.from(myCompanyIds)
      .map((id) => ({ id, name: String(companyIdToName.get(id) ?? "").trim() || "—" }))
      .filter((c) => c.name && c.name !== "—")
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));

    const primaryCompanyId = companies[0]?.id ?? "";
    const companyName = companies[0]?.name ?? "";
    const plan = primaryCompanyId ? guessPlanFromCompanyRow(companyRowNormById.get(primaryCompanyId) ?? {}) : { type: "", status: "", cardLast4: "" };

    const members: Array<{ name: string; email: string; role: "Administrador" | "Colaborador"; joinedAt: string; avatarUrl: string }> = [];
    if (usersAllRows.length) {
      const knownIds = new Set(companies.map((c) => String(c.id ?? "").trim()).filter(Boolean));
      for (const rr of usersAllRows) {
        const rowNorm = normalizeRowKeys(rr);
        const emailRaw =
          pickFirst(rowNorm, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]) ||
          pickKeyLike(rowNorm, ["email", "mail", "login", "username"], ["id", "uuid"]);
        let memberEmail = emailRaw ? extractEmail(emailRaw) : null;
        if (!memberEmail) {
          for (const v of Object.values(rowNorm)) {
            memberEmail = extractEmail(String(v ?? ""));
            if (memberEmail) break;
          }
        }
        if (!memberEmail) continue;

        let inCompany = false;
        if (knownIds.size) {
          const candidates: string[] = [];
          for (const k of Object.keys(rowNorm)) {
            const kk = k.toLowerCase();
            if (kk.includes("empresa") || kk.includes("company") || kk.includes("restaurante") || kk.includes("restaurant") || kk.includes("account")) {
              candidates.push(String((rowNorm as any)[k] ?? ""));
            }
          }
          for (const v of Object.values(rowNorm)) candidates.push(String(v ?? ""));
          for (const raw of candidates) {
            const s = String(raw ?? "").trim();
            if (!s || s.includes("@")) continue;
            const direct = knownIds.has(s) ? s : "";
            const extracted = direct || extractBubbleIdFromText(s);
            if (extracted && knownIds.has(extracted)) {
              inCompany = true;
              break;
            }
          }
        } else {
          inCompany = memberEmail === email;
        }
        if (!inCompany) continue;

        const parts = guessUserNameParts(rowNorm);
        const ownerEmails = primaryCompanyId ? companyOwnerEmailsById.get(primaryCompanyId) ?? new Set<string>() : new Set<string>();
        const roleFromRow = guessRole(rowNorm);
        const role = ownerEmails.has(memberEmail) || roleFromRow === "Administrador" ? "Administrador" : "Colaborador";
        const joinedAt = guessJoinedAt(rowNorm);
        const avatar = guessUserAvatar(rowNorm);
        const displayName = String(parts.full ?? "").trim() || memberEmail;
        members.push({
          name: ownerEmails.has(memberEmail) ? `${displayName} (Proprietário)` : displayName,
          email: memberEmail,
          role,
          joinedAt,
          avatarUrl: avatar,
        });
      }
    }

    if (!members.length) {
      const displayName = String(nameParts.full ?? "").trim() || email;
      members.push({ name: displayName, email, role: "Administrador", joinedAt: "", avatarUrl });
    }

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
      plan,
      members,
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
