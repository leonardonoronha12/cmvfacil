"use client";

import { useMemo, useState } from "react";

function maskToken(raw: string) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  if (t.length <= 10) return `${t.slice(0, 3)}…`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export default function VercelAliasClient() {
  const [token, setToken] = useState("");
  const [teamSlug, setTeamSlug] = useState("leonardonoronha12-2214s-projects");
  const [project, setProject] = useState("cmvfacil_repo");
  const [aliasDomain, setAliasDomain] = useState("cmvfacil.vercel.app");
  const [sha, setSha] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenMasked = useMemo(() => maskToken(token), [token]);

  async function promote() {
    const t = token.trim();
    setStatus("running");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/vercel/alias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(t ? { token: t } : {}),
          teamSlug: teamSlug.trim(),
          project: project.trim(),
          aliasDomain: aliasDomain.trim(),
          sha: sha.trim() || undefined,
          deploymentUrl: deploymentUrl.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `failed_${res.status}`));
      setResult(j);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Promover Deploy (Vercel)</h1>
          <div className="cmv-subtitle">Aponta o domínio para um deployment READY (sem usar Vercel CLI).</div>
        </div>
        <div className="cmv-pill">
          <span>Token:</span>
          <span className="cmv-code">{tokenMasked || "—"}</span>
        </div>
      </header>

      <section className="cmv-card">
        <div className="cmv-alert cmv-alert-error" style={{ marginTop: 0 }}>
          Use um token novo e revogue o anterior (você já colou um token em chat).
        </div>

        <label className="cmv-label" style={{ marginTop: 0 }}>
          Vercel Token
        </label>
        <div className="cmv-help">Se deixar vazio, o servidor tenta ler de .vercel-token.local (localhost) ou VERCEL_TOKEN (.env.local).</div>
        <input className="cmv-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />

        <div className="cmv-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 12 }}>
          <div>
            <label className="cmv-label" style={{ marginTop: 0 }}>
              Team slug
            </label>
            <input className="cmv-input" value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)} />
          </div>
          <div>
            <label className="cmv-label" style={{ marginTop: 0 }}>
              Project
            </label>
            <input className="cmv-input" value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
          <div>
            <label className="cmv-label" style={{ marginTop: 0 }}>
              Alias domain
            </label>
            <input className="cmv-input" value={aliasDomain} onChange={(e) => setAliasDomain(e.target.value)} />
          </div>
          <div>
            <label className="cmv-label" style={{ marginTop: 0 }}>
              Git SHA (opcional)
            </label>
            <input className="cmv-input" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="ex: ec47aaa" />
          </div>
        </div>

        <label className="cmv-label">Deployment URL (opcional)</label>
        <div className="cmv-help">Se preencher, ele usa este deployment. Se deixar vazio, pega o mais recente READY em produção.</div>
        <input
          className="cmv-input"
          value={deploymentUrl}
          onChange={(e) => setDeploymentUrl(e.target.value)}
          placeholder="ex: cmvfacilrepo-apyujhmc4-leonardonoronha12-2214s-projects.vercel.app"
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" className="cmv-button cmv-button-primary" disabled={status === "running"} onClick={() => void promote()}>
            Promover
          </button>
          <a className="cmv-button" href={`/api/version?t=${Date.now()}`} target="_blank" rel="noreferrer">
            Ver /api/version
          </a>
        </div>

        {error ? <div className="cmv-alert cmv-alert-error">Erro: {error}</div> : null}
        {result ? (
          <details style={{ marginTop: 12 }}>
            <summary>Resposta</summary>
            <pre className="cmv-pre">{JSON.stringify(result, null, 2)}</pre>
          </details>
        ) : null}
      </section>
    </main>
  );
}
