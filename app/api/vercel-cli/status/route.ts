import { NextRequest, NextResponse } from "next/server";
import { getJob } from "../_store";

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

export async function GET(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  const url = new URL(req.url);
  const jobId = String(url.searchParams.get("jobId") ?? "").trim();
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, { status: 400 });
  const job = getJob(jobId);
  if (!job) return json({ ok: false, error: "not_found" }, { status: 404 });

  return json(
    {
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        exitCode: job.exitCode,
        output: job.output,
      },
    },
    { status: 200 },
  );
}
