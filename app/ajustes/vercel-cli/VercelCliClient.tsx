"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function maskToken(raw: string) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  if (t.length <= 10) return `${t.slice(0, 3)}…`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export default function VercelCliClient() {
  const [token, setToken] = useState("");
  const [projectHint, setProjectHint] = useState("cmvfacilrepo");
  const [scopeHint, setScopeHint] = useState("leonardonoronha12-2214s-projects");
  const [rememberToken, setRememberToken] = useState(true);
  const [tokenSavedMsg, setTokenSavedMsg] = useState<string | null>(null);
  const [serverHasToken, setServerHasToken] = useState(false);
  const [serverTokenTtlSec, setServerTokenTtlSec] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"idle" | "queued" | "running" | "done" | "error">("idle");
  const [jobExitCode, setJobExitCode] = useState<number | null>(null);
  const [jobOutput, setJobOutput] = useState("");
  const [jobError, setJobError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const tokenSavedRef = useRef(false);

  const tokenMasked = useMemo(() => maskToken(token), [token]);
  const canDeploy = Boolean(token.trim()) || serverHasToken;

  async function refreshTokenStatus() {
    try {
      const res = await fetch("/api/vercel-cli/secrets-status", { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) return;
      setServerHasToken(Boolean(j?.hasToken));
      setServerTokenTtlSec(typeof j?.ttlRemainingSec === "number" ? j.ttlRemainingSec : null);
    } catch {}
  }

  async function startDeploy() {
    const t = token.trim();
    if (!t && !serverHasToken) return;
    setJobError(null);
    setJobOutput("");
    setJobExitCode(null);
    setJobStatus("queued");
    startedRef.current = true;
    try {
      const res = await fetch("/api/vercel-cli/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(t ? { token: t } : {}), mode: "linkAndDeploy", project: projectHint, scope: scopeHint }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `failed_${res.status}`));
      setJobId(String(data.jobId));
      setJobStatus("running");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : String(e));
      setJobStatus("error");
    }
  }

  async function stop() {
    if (!jobId) return;
    try {
      await fetch("/api/vercel-cli/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId }) });
    } catch {}
  }

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const res = await fetch(`/api/vercel-cli/status?jobId=${encodeURIComponent(jobId)}`, { method: "GET", cache: "no-store" });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) return;
      const j = data.job as any;
      const st = String(j?.status ?? "").trim();
      if (st === "queued" || st === "running" || st === "done" || st === "error") {
        setJobStatus(st);
      } else {
        setJobStatus("running");
      }
      setJobExitCode(typeof j?.exitCode === "number" ? j.exitCode : null);
      setJobOutput(String(j?.output ?? ""));
    };
    void tick();
    const t = window.setInterval(() => void tick(), 900);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [jobId]);

  async function saveTokenToServer(t: string) {
    const tokenToSave = t.trim();
    if (!tokenToSave) return;
    try {
      const res = await fetch("/api/vercel-cli/save-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenToSave, scope: scopeHint, project: projectHint }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `failed_${res.status}`));
      setTokenSavedMsg("Token salvo (temporário, só localhost).");
      window.setTimeout(() => setTokenSavedMsg(null), 1400);
      void refreshTokenStatus();
    } catch {
      setTokenSavedMsg("Falha ao salvar token.");
      window.setTimeout(() => setTokenSavedMsg(null), 1800);
    }
  }

  useEffect(() => {
    const t = token.trim();
    if (!rememberToken) return;
    if (!t) return;
    if (tokenSavedRef.current) return;
    tokenSavedRef.current = true;
    void saveTokenToServer(t);
  }, [rememberToken, token, scopeHint, projectHint]);

  useEffect(() => {
    if (!token.trim()) tokenSavedRef.current = false;
  }, [token]);

  useEffect(() => {
    void refreshTokenStatus();
  }, []);

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Deploy via Vercel CLI</h1>
          <div className="cmv-subtitle">Deploy de produção via Vercel CLI (somente localhost).</div>
        </div>
        <div className="cmv-pill">
          <span>Token:</span>
          <span className="cmv-code">{tokenMasked ? tokenMasked : serverHasToken ? "salvo" : "—"}</span>
        </div>
      </header>

      <div className="cmv-grid">
        <section className="cmv-card">
          <label className="cmv-label" style={{ marginTop: 0 }}>
            Vercel Token
          </label>
          <div className="cmv-help">Cole o token uma vez. Se marcar “Salvar token”, você consegue deployar sem colar novamente por alguns minutos.</div>
          <input
            className="cmv-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ex: v1_..."
            autoComplete="off"
          />

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, marginTop: 12 }}>
            <input type="checkbox" checked={rememberToken} onChange={(e) => setRememberToken(e.target.checked)} />
            Salvar token (temporário)
          </label>
          {tokenSavedMsg ? <div className="cmv-alert">{tokenSavedMsg}</div> : null}
          {serverHasToken && serverTokenTtlSec != null ? <div className="cmv-help">Token salvo por ~{serverTokenTtlSec}s.</div> : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" className="cmv-button cmv-button-primary" disabled={!canDeploy || jobStatus === "running" || jobStatus === "queued"} onClick={() => void startDeploy()}>
              Deploy (produção)
            </button>
            <button type="button" className="cmv-button" disabled={!jobId || jobStatus !== "running"} onClick={() => void stop()}>
              Parar
            </button>
          </div>

          {jobError ? <div className="cmv-alert cmv-alert-error">Erro: {jobError}</div> : null}
          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 13, fontWeight: 900, cursor: "pointer" }}>Configurações</summary>
            <div style={{ marginTop: 12 }}>
              <label className="cmv-label" style={{ marginTop: 0 }}>
                Projeto
              </label>
              <input className="cmv-input" value={projectHint} onChange={(e) => setProjectHint(e.target.value)} placeholder="ex: cmvfacilrepo" />

              <label className="cmv-label">Scope</label>
              <input className="cmv-input" value={scopeHint} onChange={(e) => setScopeHint(e.target.value)} placeholder="ex: leonardonoronha12-2214s-projects" />

              <div className="cmv-help" style={{ marginTop: 10 }}>
                Para configurar Supabase do app, use <a href="/debug-supabase">/debug-supabase</a>.
              </div>
            </div>
          </details>
        </section>

        <section className="cmv-card">
          <div style={{ fontWeight: 900, fontSize: 13 }}>Log</div>

          <div className="cmv-preview" style={{ marginTop: 12 }}>
            <div className="cmv-preview-title">
              Status: <span className="cmv-code">{jobStatus}</span> {jobExitCode != null ? <span className="cmv-code">exit={jobExitCode}</span> : null}
            </div>
            <pre
              style={{
                margin: "10px 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--cmv-font-mono)",
                fontSize: 12,
                minHeight: 220,
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              {jobOutput || "Aguardando..."}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}
