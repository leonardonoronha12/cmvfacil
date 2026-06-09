"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function maskToken(raw: string) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  if (t.length <= 10) return `${t.slice(0, 3)}…`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function VercelCliClient() {
  const [token, setToken] = useState("");
  const [projectHint, setProjectHint] = useState("cmvfacilrepo");
  const [scopeHint, setScopeHint] = useState("leonardonoronha12-2214s-projects");
  const [copiedKey, setCopiedKey] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  const [mode, setMode] = useState<"deployLinked" | "linkAndDeploy">("linkAndDeploy");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"idle" | "queued" | "running" | "done" | "error">("idle");
  const [jobExitCode, setJobExitCode] = useState<number | null>(null);
  const [jobOutput, setJobOutput] = useState("");
  const [jobError, setJobError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const tokenMasked = useMemo(() => maskToken(token), [token]);

  const cmdSetToken = useMemo(() => `$env:VERCEL_TOKEN="${token.trim()}"`, [token]);

  const cmdDeployLinked = useMemo(() => {
    const s = scopeHint.trim();
    const scopeFlag = s ? ` --scope ${s}` : "";
    return [
      cmdSetToken,
      "npx vercel --version",
      `npx vercel pull --yes --environment=production${scopeFlag} --token $env:VERCEL_TOKEN`,
      `npx vercel --prod --yes${scopeFlag} --token $env:VERCEL_TOKEN`,
    ].join("\r\n");
  }, [cmdSetToken, scopeHint]);

  const cmdLinkAndDeploy = useMemo(() => {
    const p = projectHint.trim();
    const s = scopeHint.trim();
    const scopeFlag = s ? ` --scope ${s}` : "";
    const link = ["npx vercel link --yes", p ? `--project ${p}` : "", s ? `--scope ${s}` : "", "--token $env:VERCEL_TOKEN"]
      .filter(Boolean)
      .join(" ");
    return [cmdSetToken, "npx vercel --version", link, `npx vercel --prod --yes${scopeFlag} --token $env:VERCEL_TOKEN`].join("\r\n");
  }, [cmdSetToken, projectHint, scopeHint]);

  async function copyWithToast(key: string, text: string) {
    await copy(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((v) => (v === key ? "" : v)), 1200);
  }

  async function startJob(explicitToken?: string) {
    const t = String(explicitToken ?? token ?? "").trim();
    if (!t) return;
    setJobError(null);
    setJobOutput("");
    setJobExitCode(null);
    setJobStatus("queued");
    startedRef.current = true;
    try {
      const res = await fetch("/api/vercel-cli/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t, mode, project: projectHint, scope: scopeHint }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `failed_${res.status}`));
      setJobId(String(data.jobId));
      setJobStatus("running");
      setToken("");
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

  useEffect(() => {
    const t = token.trim();
    if (!autoRun) return;
    if (!t) return;
    if (startedRef.current) return;
    void startJob(t);
  }, [autoRun, token]);

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Deploy via Vercel CLI</h1>
          <div className="cmv-subtitle">
            Cole seu token da Vercel aqui para gerar comandos prontos para colar no terminal do Trae. O token fica só no seu navegador.
          </div>
        </div>
        <div className="cmv-pill">
          <span>Token:</span>
          <span className="cmv-code">{tokenMasked ? tokenMasked : "—"}</span>
        </div>
      </header>

      <div className="cmv-grid">
        <section className="cmv-card">
          <label className="cmv-label" style={{ marginTop: 0 }}>
            Vercel Token
          </label>
          <div className="cmv-help">Cole o token. Depois copie e cole os comandos no terminal do Trae (PowerShell).</div>
          <input
            className="cmv-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ex: v1_..."
            autoComplete="off"
          />

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
              <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
              Executar automaticamente ao colar
            </label>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Modo</span>
              <select className="cmv-input" style={{ width: 240, paddingTop: 8, paddingBottom: 8 }} value={mode} onChange={(e) => setMode(e.target.value as any)}>
                <option value="linkAndDeploy">Link + Deploy (recomendado)</option>
                <option value="deployLinked">Deploy (repo já linkado)</option>
              </select>
            </div>
          </div>

          <label className="cmv-label">Projeto (opcional)</label>
          <div className="cmv-help">
            Se o domínio <span className="cmv-code">cmvfacil.vercel.app</span> estiver apontando para outro projeto, preencha o nome do projeto para
            forçar o link antes do deploy.
          </div>
          <input className="cmv-input" value={projectHint} onChange={(e) => setProjectHint(e.target.value)} placeholder="ex: cmvfacilrepo" />

          <label className="cmv-label">Scope (opcional)</label>
          <div className="cmv-help">
            Em modo não-interativo (com <span className="cmv-code">--yes</span>), a Vercel exige <span className="cmv-code">--scope</span> quando não há
            default. Para este projeto, use <span className="cmv-code">leonardonoronha12-2214s-projects</span>.
          </div>
          <input
            className="cmv-input"
            value={scopeHint}
            onChange={(e) => setScopeHint(e.target.value)}
            placeholder="ex: leonardonoronha12-2214s-projects"
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button
              type="button"
              className="cmv-button cmv-button-primary"
              disabled={!token.trim()}
              onClick={() => void copyWithToast("deployLinked", cmdDeployLinked)}
            >
              {copiedKey === "deployLinked" ? "Copiado" : "Copiar deploy (projeto atual)"}
            </button>
            <button
              type="button"
              className="cmv-button"
              disabled={!token.trim()}
              onClick={() => void copyWithToast("linkAndDeploy", cmdLinkAndDeploy)}
            >
              {copiedKey === "linkAndDeploy" ? "Copiado" : "Copiar link + deploy"}
            </button>
            <button type="button" className="cmv-button cmv-button-primary" disabled={!token.trim() || jobStatus === "running" || jobStatus === "queued"} onClick={() => void startJob()}>
              Executar agora
            </button>
            <button type="button" className="cmv-button" disabled={!jobId || jobStatus !== "running"} onClick={() => void stop()}>
              Parar
            </button>
          </div>

          {jobError ? <div className="cmv-alert cmv-alert-error">Erro: {jobError}</div> : null}
        </section>

        <section className="cmv-card">
          <div style={{ fontWeight: 900, fontSize: 13 }}>Terminal (na tela)</div>
          <div className="cmv-help" style={{ marginTop: 6 }}>
            Essa execução funciona só no preview local (localhost). Em produção, fica desativado por segurança.
          </div>

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

          <div className="cmv-preview" style={{ marginTop: 12 }}>
            <div className="cmv-preview-title">Deploy no projeto já linkado neste repo</div>
            <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--cmv-font-mono)", fontSize: 12 }}>
              {cmdDeployLinked}
            </pre>
          </div>

          <div className="cmv-preview" style={{ marginTop: 12 }}>
            <div className="cmv-preview-title">Forçar link + deploy (quando o domínio está em outro projeto)</div>
            <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--cmv-font-mono)", fontSize: 12 }}>
              {cmdLinkAndDeploy}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}
