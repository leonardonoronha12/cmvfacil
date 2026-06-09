import { NextRequest, NextResponse } from "next/server";
import { getJob, stopJob } from "../_store";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isEnabled(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  let body: { jobId?: string } = {};
  try {
    body = (await req.json()) as { jobId?: string };
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const jobId = String(body?.jobId ?? "").trim();
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, { status: 400 });
  const job = getJob(jobId);
  if (!job) return json({ ok: false, error: "not_found" }, { status: 404 });

  stopJob(job);
  return json({ ok: true }, { status: 200 });
}
