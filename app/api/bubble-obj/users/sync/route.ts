import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fetchBubbleObjPage, getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";

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

function extractBubbleId(obj: any) {
  const direct = pickAny(obj, ["unique_id", "_id", "id", "bubble_id", "user_id", "usuario_id"]);
  return String(direct ?? "").trim();
}

function normalizeEmail(input: string) {
  const s = String(input ?? "").trim().toLowerCase();
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : "";
}

async function loadSupabaseEmailToIdMap(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const out = new Map<string, string>();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const email = String(u?.email ?? "").trim().toLowerCase();
      if (id && email) out.set(email, id);
    }
    if (users.length < 1000) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const userTypeCandidates = Array.isArray(body?.userTypes) && body.userTypes.length ? (body.userTypes as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : ["User", "Users", "usuario", "usuarios"];
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(200, Math.floor(body.limit)) : 100;

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const creds = await getBubbleObjCredentials();
    const emailToId = await loadSupabaseEmailToIdMap(supabase);

    let usedType = "";
    let fetched = 0;
    let cursor = 0;
    const rows: Array<{ bubble_user_id: string; email: string | null; nome: string | null; supabase_user_id: string | null }> = [];

    for (const typeName of userTypeCandidates) {
      usedType = typeName;
      fetched = 0;
      cursor = 0;
      rows.length = 0;

      try {
        for (let pages = 0; pages < 5000; pages++) {
          const page = await fetchBubbleObjPage<any>({ creds, type: typeName, cursor, limit });
          const list = page.results ?? [];
          for (const u of list) {
            const bubbleUserId = extractBubbleId(u);
            if (!bubbleUserId) continue;
            const email = normalizeEmail(pickAny(u, ["email", "user_email", "usuario_email", "e_mail", "mail", "login", "username"]));
            const nome =
              pickAny(u, ["nome", "name", "nome_completo", "full_name", "fullname"]) ||
              [pickAny(u, ["first_name", "firstname", "primeiro_nome"]), pickAny(u, ["last_name", "lastname", "sobrenome"])].filter(Boolean).join(" ");
            const supabaseUserId = email ? String(emailToId.get(email) ?? "").trim() : "";
            rows.push({ bubble_user_id: bubbleUserId, email: email || null, nome: nome ? String(nome).trim() : null, supabase_user_id: supabaseUserId && isUuid(supabaseUserId) ? supabaseUserId : null });
          }
          fetched += list.length;
          if (list.length < limit) break;
          cursor += list.length;
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("bubble_404") || msg.includes("type_not_found")) {
          continue;
        }
        throw err;
      }
    }

    if (!rows.length) return json({ ok: false, error: "no_users_found", usedType }, { status: 400 });

    const { error } = await supabase.from("bubble_obj_user_map").upsert(rows as any, { onConflict: "bubble_user_id" });
    if (error) return json({ ok: false, error: `bubble_obj_user_map:${error.message}`, usedType, fetched }, { status: 500 });

    const mapped = rows.filter((r) => Boolean(r.supabase_user_id)).length;
    const unmapped = rows.length - mapped;
    const mine = isUuid(userId) ? rows.filter((r) => r.supabase_user_id === userId).length : null;

    return json({ ok: true, usedType, fetched, upserted: rows.length, mapped, unmapped, mine, baseUrl: creds.baseUrl }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

