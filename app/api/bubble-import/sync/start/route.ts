import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
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

function safeType(input: unknown) {
  return String(input ?? "").trim();
}

function prioritizeTypes(types: string[]) {
  const priority = ["User", "empresas"];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const p of priority) {
    const exact = types.find((t) => t === p);
    if (exact) push(exact);
    else {
      const ci = types.find((t) => t.toLowerCase() === p.toLowerCase());
      if (ci) push(ci);
    }
  }
  for (const t of types) push(t);
  return out;
}

type SyncState = {
  v: 1;
  runId: string;
  runPrefix: string;
  statePath: string;
  startedAt: string;
  updatedAt: string;
  phase: "pulling" | "importing" | "done" | "error";
  types: string[];
  currentTypeIndex: number;
  perType: Record<
    string,
    {
      status: "pending" | "pulling" | "segmentando" | "done" | "error";
      fetched: number;
      parts: number;
      cursor: number;
      remaining: number | null;
      segmentAfter: string | null;
      lastCreated: string | null;
      lastPath: string;
      errorCount: number;
      lastError: string;
    }
  >;
  import: {
    domains: string[];
    index: number;
    status: "pending" | "running" | "done" | "error";
    lastError: string;
  };
};

function newState(runId: string, runPrefix: string, statePath: string, types: string[]): SyncState {
  const now = new Date().toISOString();
  const perType: SyncState["perType"] = {};
  for (const t of types) {
    perType[t] = {
      status: "pending",
      fetched: 0,
      parts: 0,
      cursor: 0,
      remaining: null,
      segmentAfter: null,
      lastCreated: null,
      lastPath: "",
      errorCount: 0,
      lastError: "",
    };
  }
  return {
    v: 1,
    runId,
    runPrefix,
    statePath,
    startedAt: now,
    updatedAt: now,
    phase: "pulling",
    types,
    currentTypeIndex: 0,
    perType,
    import: { domains: ["insumos", "fornecedores", "entradas", "desperdicios", "inventario", "pre_preparo", "fichas_tecnicas"], index: 0, status: "pending", lastError: "" },
  };
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const typesRaw = Array.isArray(body?.types) ? (body.types as unknown[]) : [];
    const types = prioritizeTypes(typesRaw.map((t) => safeType(t)).filter(Boolean));
    if (!types.length) return json({ ok: false, error: "missing_types" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const runId = crypto.randomUUID();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const runPrefix = `user:${userId}/${day}/${runId}`;
    const statePath = `${runPrefix}/sync-state.json`;
    const state = newState(runId, runPrefix, statePath, types);

    const { error } = await supabase.storage.from(bucket).upload(statePath, JSON.stringify(state), { contentType: "application/json", upsert: true });
    if (error) throw new Error(error.message);

    return json({ ok: true, state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
