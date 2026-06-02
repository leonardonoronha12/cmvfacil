import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";

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

async function downloadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string) {
  const fileName = path.split("/").slice(-1)[0] || "file";
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message || "failed_to_download_state");
  const buf = await dl.data.arrayBuffer();
  const text = new TextDecoder().decode(buf);
  const trimmed = String(text ?? "").trimStart();
  if (trimmed.startsWith("<")) throw new Error(`invalid_json_from_storage:${fileName}`);
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`invalid_json_from_storage:${fileName}`);
  }
}

async function uploadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

function buildCookieHeader(req: NextRequest) {
  const raw = (req.headers.get("cookie") ?? "").trim();
  if (raw) return raw;
  try {
    const all = req.cookies.getAll();
    if (!all.length) return "";
    return all.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const statePath = String(body?.statePath ?? "").trim();
    if (!statePath) return json({ ok: false, error: "missing_statePath" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const bucket = "bubble-imports";
    await ensureBucket(supabase, bucket);

    const state = (await downloadJson(supabase, bucket, statePath)) as any;
    const ownerId = String(state?.storageOwnerUserId ?? "").trim();
    if (!ownerId || !isUuid(ownerId)) return json({ ok: false, error: "invalid_state" }, { status: 400 });

    const isAdminSession = !isUuid(userId);
    if (!isAdminSession && userId !== ownerId) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const now = new Date().toISOString();
    state.updatedAt = now;

    if (state.phase === "done" || state.phase === "error") {
      return json({ ok: true, state }, { status: 200 });
    }

    if (state.phase === "deleting") {
      const tables = Array.isArray(state?.delete?.tables) ? (state.delete.tables as any[]) : [];
      const index = typeof state?.delete?.index === "number" ? state.delete.index : 0;
      state.delete.status = "running";
      state.delete.lastError = "";

      if (index >= tables.length) {
        state.delete.status = "done";
        state.phase = "importing";
        await uploadJson(supabase, bucket, statePath, state);
        return json({ ok: true, state }, { status: 200 });
      }

      const table = String(tables[index] ?? "").trim();
      try {
        const { error } = await supabase.from(table).delete().like("id", "user:%");
        if (error) throw new Error(error.message);
        state.delete.index = index + 1;
        if (state.delete.index >= tables.length) {
          state.delete.status = "done";
          state.phase = "importing";
        } else {
          state.delete.status = "running";
        }
      } catch (err) {
        state.delete.status = "error";
        state.delete.lastError = err instanceof Error ? err.message : String(err);
        state.phase = "error";
      }

      await uploadJson(supabase, bucket, statePath, state);
      return json({ ok: true, state }, { status: 200 });
    }

    if (state.phase === "importing") {
      const steps = Array.isArray(state?.steps) ? (state.steps as any[]) : [];
      let stepIndex = steps.findIndex((s) => String(s?.status ?? "") === "pending");
      if (stepIndex < 0) stepIndex = steps.findIndex((s) => String(s?.status ?? "") === "running");
      if (stepIndex < 0) {
        state.phase = "done";
        await uploadJson(supabase, bucket, statePath, state);
        return json({ ok: true, state }, { status: 200 });
      }

      const step = steps[stepIndex] ?? {};
      const kinds = Array.isArray(step?.kinds) ? (step.kinds as any[]).map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean) : [];
      steps[stepIndex] = {
        ...step,
        status: "running",
        lastError: "",
        startedAt: step.startedAt || now,
      };
      state.steps = steps;
      await uploadJson(supabase, bucket, statePath, state);

      const importUrl = new URL("/api/bubble-import/import", req.url);
      const cookie = buildCookieHeader(req);
      const importRes = await fetch(importUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ prefix: state.prefix, includeUnknown: Boolean(state.includeUnknown), kinds, only: null }),
        cache: "no-store",
      });
      const text = await importRes.text().catch(() => "");
      let payload: any = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      if (!importRes.ok || !payload?.ok) {
        steps[stepIndex] = {
          ...steps[stepIndex],
          status: "error",
          lastError: payload?.error ? String(payload.error) : `failed_${importRes.status}`,
          finishedAt: new Date().toISOString(),
          lastResult: payload ?? (text ? { text: text.slice(0, 2000) } : null),
        };
        state.phase = "error";
      } else {
        steps[stepIndex] = {
          ...steps[stepIndex],
          status: "done",
          finishedAt: new Date().toISOString(),
          lastResult: payload,
        };
        state.steps = steps;
        const nextPending = steps.some((s) => String(s?.status ?? "") === "pending");
        state.phase = nextPending ? "importing" : "done";
      }

      state.steps = steps;
      await uploadJson(supabase, bucket, statePath, state);
      return json({ ok: true, state }, { status: 200 });
    }

    return json({ ok: false, error: "invalid_phase" }, { status: 400 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

