"use client";

import { useMemo, useState } from "react";

function Field({
  label,
  placeholder,
  value,
  onChange,
  mask,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  mask?: (v: string) => string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label className="cmv-label" style={{ marginTop: 0 }}>
        {label}
      </label>
      <input
        className="cmv-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      {mask ? (
        <div className="cmv-help">
          Pré-visualização: <span style={{ fontFamily: "var(--cmv-font-mono)" }}>{mask(value)}</span>
        </div>
      ) : null}
    </div>
  );
}

function maskKey(v: string) {
  const t = v.trim();
  if (t.length <= 12) return t ? `${t.slice(0, 3)}…` : "";
  return `${t.slice(0, 6)}…${t.slice(-6)}`;
}

export default function SetupSupabaseClient() {
  const [url, setUrl] = useState("");
  const [anon, setAnon] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const envText = useMemo(() => {
    const u = url.trim();
    const a = anon.trim();
    return [
      u ? `NEXT_PUBLIC_SUPABASE_URL=${u}` : `NEXT_PUBLIC_SUPABASE_URL=`,
      a ? `NEXT_PUBLIC_SUPABASE_ANON_KEY=${a}` : `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
      `NEXT_PUBLIC_SITE_URL=https://cmvfacil.vercel.app`,
    ].join("\n");
  }, [url, anon]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 1200);
    } catch {
      setCopied(null);
    }
  }

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Conectar Login/Cadastro ao Supabase</h1>
          <div className="cmv-subtitle">Cole a URL e a anon key do Supabase e aplique no projeto.</div>
        </div>
      </header>

      <section className="cmv-grid" style={{ marginTop: 16 }}>
        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>1) Pegue no Supabase</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Supabase Dashboard → Project Settings → API
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <Field
              label="Project URL"
              placeholder="https://xxxxx.supabase.co"
              value={url}
              onChange={setUrl}
            />
            <Field
              label="anon public key"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anon}
              onChange={setAnon}
              mask={maskKey}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" className="cmv-button cmv-button-primary" onClick={() => void copy(envText, "env")}>
              {copied === "env" ? "Copiado" : "Copiar .env"}
            </button>
            <a
              className="cmv-button"
              href="https://supabase.com/dashboard/project/_/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              Abrir Supabase (API)
            </a>
          </div>

          <div className="cmv-help" style={{ marginTop: 12 }}>
            Cole o texto acima em uma env da Vercel e/ou no seu <span style={{ fontFamily: "var(--cmv-font-mono)" }}>.env.local</span>.
          </div>
        </div>

        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>2) Configure na Vercel</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Vercel → Project → Settings → Environment Variables
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div className="cmv-help">
              Adicione as variáveis em <b>Production</b>, <b>Preview</b> e <b>Development</b>.
            </div>
            <div className="cmv-help">
              Depois faça um redeploy para o build enxergar as envs.
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Env para colar</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--cmv-border)",
                background: "var(--cmv-surface-2)",
                fontFamily: "var(--cmv-font-mono)",
                fontSize: 12,
                lineHeight: "18px",
              }}
            >
              {envText}
            </pre>
            <button type="button" className="cmv-button" onClick={() => void copy(envText, "env2")}>
              {copied === "env2" ? "Copiado" : "Copiar novamente"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

