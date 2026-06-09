import { ChildProcessWithoutNullStreams, spawn } from "child_process";

export type VercelCliJobStatus = "queued" | "running" | "done" | "error";

export type VercelCliJob = {
  id: string;
  status: VercelCliJobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  output: string;
  proc: ChildProcessWithoutNullStreams | null;
};

const KEY = "__cmvfacil_vercel_cli_jobs__";

function getStore(): Map<string, VercelCliJob> {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = new Map<string, VercelCliJob>();
  return g[KEY] as Map<string, VercelCliJob>;
}

export function createJob(id: string): VercelCliJob {
  const job: VercelCliJob = {
    id,
    status: "queued",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    output: "",
    proc: null,
  };
  getStore().set(id, job);
  return job;
}

export function getJob(id: string) {
  return getStore().get(id) ?? null;
}

export function appendOutput(job: VercelCliJob, chunk: string) {
  const text = String(chunk ?? "");
  if (!text) return;
  job.output = (job.output + text).slice(-200_000);
}

export function runPowershellJob(job: VercelCliJob, command: string, env: Record<string, string | undefined>) {
  job.status = "running";
  job.startedAt = Date.now();

  const proc = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
  job.proc = proc;

  proc.stdout.on("data", (d) => appendOutput(job, d.toString("utf8")));
  proc.stderr.on("data", (d) => appendOutput(job, d.toString("utf8")));
  proc.on("close", (code) => {
    job.exitCode = typeof code === "number" ? code : null;
    job.finishedAt = Date.now();
    job.status = code === 0 ? "done" : "error";
    job.proc = null;
  });

  proc.on("error", (err) => {
    appendOutput(job, `\n${String((err as any)?.message ?? err)}`);
    job.exitCode = 1;
    job.finishedAt = Date.now();
    job.status = "error";
    job.proc = null;
  });

  return proc;
}

export function stopJob(job: VercelCliJob) {
  try {
    job.proc?.kill();
  } catch {}
}

