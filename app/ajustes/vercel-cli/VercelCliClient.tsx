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
  const [autoAlias, setAutoAlias] = useState(true);
  const [aliasDomain, setAliasDomain] = useState("cmvfacil.vercel.app");
  const [forceAlias, setForceAlias] = useState(true);
  const [mode, setMode] = useState<"deployLinked" | "linkAndDeploy">("linkAndDeploy");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"idle" | "queued" | "running" | "done" | "error">("idle");
  const [jobExitCode, setJobExitCode] = useState<number | null>(null);
  const [jobOutput, setJobOutput] = useState("");
  const [jobError, setJobError] = useState<string | null>(null);
  const [aliasJobId, setAliasJobId] = useState<string | null>(null);
  const [aliasStatus, setAliasStatus] = useState<"idle" | "queued" | "running" | "done" | "error">("idle");
  const [aliasExitCode, setAliasExitCode] = useState<number | null>(null);
  const [aliasOutput, setAliasOutput] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState("");
  const [cfgJobId, setCfgJobId] = useState<string | null>(null);
  const [cfgStatus, setCfgStatus] = useState<"idle" | "queued" | "running" | "done" | "error">("idle");
  const [cfgExitCode, setCfgExitCode] = useState<number | null>(null);
  const [cfgOutput, setCfgOutput] = useState("");
  const startedRef = useRef(false);
  const autoAliasedRef = useRef(false);
  const cfgAliasedRef = useRef(false);

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

  const cmdAlias = useMemo(() => {
    const s = scopeHint.trim();
    const scopeFlag = s ? ` --scope ${s}` : "";
    const rm = forceAlias ? `npx vercel alias rm ${aliasDomain.trim()} --yes${scopeFlag} --token $env:VERCEL_TOKEN` : "";
    const set = `npx vercel alias set <deployment-url> ${aliasDomain.trim()}${scopeFlag} --token $env:VERCEL_TOKEN`;
    return [cmdSetToken, "npx vercel --version", rm, set].filter(Boolean).join("\r\n");
  }, [cmdSetToken, scopeHint, aliasDomain, forceAlias]);

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
    } catch (e) {
      setJobError(e instanceof Error ? e.message : String(e));
      setJobStatus("error");
    }
  }

  const extractDeploymentUrl = (output: string) => {
    const text = String(output ?? "");
    const m = text.match(/▲\s*Production\s+`https:\/\/([^`]+)`/i);
    if (m?.[1]) return m[1].trim();
    const m2 = text.match(/"url"\s*:\s*"\s*`https:\/\/([^`]+)`\s*"/i);
    if (m2?.[1]) return m2[1].trim();
    const m3 = text.match(/https:\/\/([a-z0-9-]+\.vercel\.app)/i);
    if (m3?.[1]) return m3[1].trim();
    return "";
  };

  async function startAliasJob(deploymentUrl: string) {
    const t = token.trim();
    const s = scopeHint.trim();
    const a = aliasDomain.trim();
    if (!t || !s || !a || !deploymentUrl) return;
    setAliasOutput("");
    setAliasExitCode(null);
    setAliasStatus("queued");
    try {
      const res = await fetch("/api/vercel-cli/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t, mode: "alias", scope: s, deploymentUrl, aliasDomain: a, forceAlias }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `failed_${res.status}`));
      setAliasJobId(String(data.jobId));
      setAliasStatus("running");
    } catch (e) {
      setAliasOutput(String(e instanceof Error ? e.message : e));
      setAliasStatus("error");
    }
  }

  async function startSupabaseConfigJob() {
    const t = token.trim();
    const s = scopeHint.trim();
    const p = projectHint.trim();
    const u = supabaseUrl.trim();
    const a = supabaseAnonKey.trim();
    const sr = supabaseServiceRoleKey.trim();
    if (!t || !s || !p || !u || !a) return;
    setCfgOutput("");
    setCfgExitCode(null);
    setCfgStatus("queued");
    try {
      const res = await fetch("/api/vercel-cli/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: t,
          mode: "setEnvAndDeploy",
          project: p,
          scope: s,
          supabaseUrl: u,
          supabaseAnonKey: a,
          supabaseServiceRoleKey: sr || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `failed_${res.status}`));
      setCfgJobId(String(data.jobId));
      setCfgStatus("running");
    } catch (e) {
      setCfgOutput(String(e instanceof Error ? e.message : e));
      setCfgStatus("error");
    }
  }

  useEffect(() => {
    if (!aliasJobId) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const res = await fetch(`/api/vercel-cli/status?jobId=${encodeURIComponent(aliasJobId)}`, { method: "GET", cache: "no-store" });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) return;
      const j = data.job as any;
      const st = String(j?.status ?? "").trim();
      if (st === "queued" || st === "running" || st === "done" || st === "error") {
        setAliasStatus(st);
      } else {
        setAliasStatus("running");
      }
      setAliasExitCode(typeof j?.exitCode === "number" ? j.exitCode : null);
      setAliasOutput(String(j?.output ?? ""));
    };
    void tick();
    const t = window.setInterval(() => void tick(), 900);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [aliasJobId]);

  useEffect(() => {
    if (!cfgJobId) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const res = await fetch(`/api/vercel-cli/status?jobId=${encodeURIComponent(cfgJobId)}`, { method: "GET", cache: "no-store" });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) return;
      const j = data.job as any;
      const st = String(j?.status ?? "").trim();
      if (st === "queued" || st === "running" || st === "done" || st === "error") {
        setCfgStatus(st);
      } else {
        setCfgStatus("running");
      }
      setCfgExitCode(typeof j?.exitCode === "number" ? j.exitCode : null);
      setCfgOutput(String(j?.output ?? ""));
    };
    void tick();
    const t = window.setInterval(() => void tick(), 900);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [cfgJobId]);

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

  useEffect(() => {
    if (!autoAlias) return;
    if (autoAliasedRef.current) return;
    if (jobStatus !== "done") return;
    if (jobExitCode !== 0) return;
    const deploymentUrl = extractDeploymentUrl(jobOutput);
    if (!deploymentUrl) return;
    void startAliasJob(deploymentUrl);
    autoAliasedRef.current = true;
  }, [autoAlias, jobStatus, jobExitCode, jobOutput, token, scopeHint, aliasDomain, forceAlias]);

  useEffect(() => {
    if (!autoAlias) return;
    if (cfgAliasedRef.current) return;
    if (cfgStatus !== "done") return;
    if (cfgExitCode !== 0) return;
    const deploymentUrl = extractDeploymentUrl(cfgOutput);
    if (!deploymentUrl) return;
    void startAliasJob(deploymentUrl);
    cfgAliasedRef.current = true;
  }, [autoAlias, cfgStatus, cfgExitCode, cfgOutput, token, scopeHint, aliasDomain, forceAlias]);

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
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
              <input type="checkbox" checked={autoAlias} onChange={(e) => setAutoAlias(e.target.checked)} />
              Após deploy, apontar cmvfacil.vercel.app
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

          <label className="cmv-label">Domínio para apontar (alias)</label>
          <div className="cmv-help">Se esse domínio já estiver preso em outro projeto, marque “Forçar”.</div>
          <input className="cmv-input" value={aliasDomain} onChange={(e) => setAliasDomain(e.target.value)} placeholder="ex: cmvfacil.vercel.app" />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, marginTop: 10 }}>
            <input type="checkbox" checked={forceAlias} onChange={(e) => setForceAlias(e.target.checked)} />
            Forçar (remove alias atual antes)
          </label>

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

          <div className="cmv-preview" style={{ marginTop: 16 }}>
            <div className="cmv-preview-title">Configurar Supabase na Vercel (production) + redeploy</div>
            <div className="cmv-help" style={{ marginTop: 6 }}>
              Resolve o erro <span className="cmv-code">server_not_configured</span> no login adicionando as env vars do Supabase no projeto da Vercel.
            </div>
            <label className="cmv-label" style={{ marginTop: 12 }}>
              SUPABASE_URL
            </label>
            <input className="cmv-input" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />

            <label className="cmv-label">NEXT_PUBLIC_SUPABASE_ANON_KEY</label>
            <input
              className="cmv-input"
              type="password"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="eyJhbGciOi..."
              autoComplete="off"
            />

            <label className="cmv-label">SUPABASE_SERVICE_ROLE_KEY (opcional)</label>
            <input
              className="cmv-input"
              type="password"
              value={supabaseServiceRoleKey}
              onChange={(e) => setSupabaseServiceRoleKey(e.target.value)}
              placeholder="eyJhbGciOi..."
              autoComplete="off"
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button
                type="button"
                className="cmv-button cmv-button-primary"
                disabled={!token.trim() || !projectHint.trim() || !scopeHint.trim() || !supabaseUrl.trim() || !supabaseAnonKey.trim() || cfgStatus === "running"}
                onClick={() => void startSupabaseConfigJob()}
              >
                {cfgStatus === "running" || cfgStatus === "queued" ? "Executando…" : "Configurar + redeploy"}
              </button>
            </div>

            <div className="cmv-preview" style={{ marginTop: 12 }}>
              <div className="cmv-preview-title">
                Status: <span className="cmv-code">{cfgStatus}</span> {cfgExitCode != null ? <span className="cmv-code">exit={cfgExitCode}</span> : null}
              </div>
              <pre
                style={{
                  margin: "10px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "var(--cmv-font-mono)",
                  fontSize: 12,
                  minHeight: 120,
                  maxHeight: 260,
                  overflow: "auto",
                }}
              >
                {cfgOutput || "Aguardando..."}
              </pre>
            </div>
          </div>
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
            <div className="cmv-preview-title">
              Alias: <span className="cmv-code">{aliasStatus}</span>{" "}
              {aliasExitCode != null ? <span className="cmv-code">exit={aliasExitCode}</span> : null}
            </div>
            <pre
              style={{
                margin: "10px 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--cmv-font-mono)",
                fontSize: 12,
                minHeight: 120,
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {aliasOutput || "Aguardando..."}
            </pre>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <button
                type="button"
                className="cmv-button cmv-button-primary"
                disabled={!token.trim() || aliasStatus === "running" || jobStatus !== "done" || jobExitCode !== 0}
                onClick={() => void startAliasJob(extractDeploymentUrl(jobOutput))}
              >
                Executar alias agora
              </button>
            </div>
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

          <div className="cmv-preview" style={{ marginTop: 12 }}>
            <div className="cmv-preview-title">Alias (apontar domínio para um deployment)</div>
            <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--cmv-font-mono)", fontSize: 12 }}>
              {cmdAlias}
            </pre>
          </div>
        </section>
      </div>
    </main>
  );
}
