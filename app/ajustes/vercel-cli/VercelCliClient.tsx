"use client";

import { useMemo, useState } from "react";

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
  const [scopeHint, setScopeHint] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const tokenMasked = useMemo(() => maskToken(token), [token]);

  const cmdSetToken = useMemo(() => `$env:VERCEL_TOKEN="${token.trim()}"`, [token]);

  const cmdDeployLinked = useMemo(() => {
    return [
      cmdSetToken,
      "npx vercel --version",
      "npx vercel pull --yes --environment=production --token $env:VERCEL_TOKEN",
      "npx vercel --prod --yes --token $env:VERCEL_TOKEN",
    ].join("\r\n");
  }, [cmdSetToken]);

  const cmdLinkAndDeploy = useMemo(() => {
    const p = projectHint.trim();
    const s = scopeHint.trim();
    const link = ["npx vercel link --yes", p ? `--project ${p}` : "", s ? `--scope ${s}` : "", "--token $env:VERCEL_TOKEN"]
      .filter(Boolean)
      .join(" ");
    return [cmdSetToken, "npx vercel --version", link, "npx vercel --prod --yes --token $env:VERCEL_TOKEN"].join("\r\n");
  }, [cmdSetToken, projectHint, scopeHint]);

  async function copyWithToast(key: string, text: string) {
    await copy(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((v) => (v === key ? "" : v)), 1200);
  }

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

          <label className="cmv-label">Projeto (opcional)</label>
          <div className="cmv-help">
            Se o domínio <span className="cmv-code">cmvfacil.vercel.app</span> estiver apontando para outro projeto, preencha o nome do projeto para
            forçar o link antes do deploy.
          </div>
          <input className="cmv-input" value={projectHint} onChange={(e) => setProjectHint(e.target.value)} placeholder="ex: cmvfacilrepo" />

          <label className="cmv-label">Scope (opcional)</label>
          <div className="cmv-help">Use quando o projeto estiver em um time. Pode ser o slug do time/conta na Vercel.</div>
          <input className="cmv-input" value={scopeHint} onChange={(e) => setScopeHint(e.target.value)} placeholder="ex: leonardonoronha12" />

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
          </div>
        </section>

        <section className="cmv-card">
          <div style={{ fontWeight: 900, fontSize: 13 }}>Terminal (PowerShell)</div>
          <div className="cmv-help" style={{ marginTop: 6 }}>
            Cole um dos blocos abaixo no terminal do Trae. O segundo bloco tenta “linkar” o repo no projeto correto antes de publicar.
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

