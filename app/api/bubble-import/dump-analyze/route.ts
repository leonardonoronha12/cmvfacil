import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

const MAX_SAMPLE_BYTES = 1_200_000;

async function signedFetchRange(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, maxBytes: number) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "failed_to_sign");
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${maxBytes - 1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`failed_to_read_${res.status}`);
  return await res.text();
}

function summarizeParsed(value: unknown) {
  if (Array.isArray(value)) {
    const first = value[0];
    const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as any).slice(0, 30) : [];
    return { format: "array", rows: value.length, sampleKeys: keys };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const maybeTables: Record<string, number> = {};
    for (const k of keys.slice(0, 200)) {
      const v = obj[k];
      if (Array.isArray(v)) maybeTables[k] = v.length;
    }
    const tableKeys = Object.keys(maybeTables);
    if (tableKeys.length) return { format: "object_tables", tables: tableKeys.length, tableSample: Object.fromEntries(tableKeys.slice(0, 40).map((k) => [k, maybeTables[k]])) };
    return { format: "object", keys: keys.length, sampleKeys: keys.slice(0, 60) };
  }
  return { format: typeof value };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const path = typeof (body as any)?.path === "string" ? String((body as any).path).trim() : "";
    if (!path) return json({ ok: false, error: "missing_path" }, { status: 400 });

    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!path.startsWith(`user:${userId}/`)) return json({ ok: false, error: "path_not_owned" }, { status: 403 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const bucket = "bubble-imports";
    const sample = await signedFetchRange(supabase, bucket, path, MAX_SAMPLE_BYTES);
    const trimmed = sample.trimStart();
    if (!trimmed) return json({ ok: true, summary: { format: "empty" } }, { status: 200 });

    let parsed: unknown = null;
    let parseError = "";
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
      const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim()) ?? "";
      try {
        parsed = JSON.parse(firstLine);
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      return json(
        {
          ok: true,
          summary: { format: "text", parsed: false },
          note: "nao_foi_possivel_parsear_json_no_sample",
          parseError,
        },
        { status: 200 },
      );
    }

    return json({ ok: true, summary: summarizeParsed(parsed) }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

