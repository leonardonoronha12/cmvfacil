"use client";

import { useEffect, useMemo, useState } from "react";

type Payload = {
  ok: true;
  url: { resolved: boolean; from: string | null; candidates: Record<string, boolean> };
  anonKey: { resolved: boolean; candidates: Record<string, boolean> };
};

type ResetPayload = {
  ok: true;
  redirectTo: string | null;
  siteUrl: { resolved: boolean; value_source: string | null };
};

export default function DebugSupabaseClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [reset, setReset] = useState<ResetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const storageKey = useMemo(() => "cmvfacil:localSupabaseEnv", []);

  useEffect(() => {
    let alive = true;
    fetch("/api/debug/supabase-config", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as Payload | { error?: string } | null;
        if (!alive) return;
        if (!r.ok || !j || !("ok" in j)) {
          setError((j && "error" in j && j.error) || "Falha ao carregar diagnóstico.");
          return;
        }
        setData(j as Payload);
      })
      .catch(() => {
        if (!alive) return;
        setError("Falha ao carregar diagnóstico.");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const j = JSON.parse(raw) as { supabaseUrl?: string; supabaseAnonKey?: string; supabaseServiceRoleKey?: string };
      if (typeof j?.supabaseUrl === "string") setSupabaseUrl(j.supabaseUrl);
      if (typeof j?.supabaseAnonKey === "string") setSupabaseAnonKey(j.supabaseAnonKey);
      if (typeof j?.supabaseServiceRoleKey === "string") setSupabaseServiceRoleKey(j.supabaseServiceRoleKey);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    let alive = true;
    fetch("/api/debug/reset-redirect", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as ResetPayload | null;
        if (!alive) return;
        if (!r.ok || !j || !j.ok) return;
        setReset(j);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    const u = supabaseUrl.trim();
    const a = supabaseAnonKey.trim();
    const sr = supabaseServiceRoleKey.trim();
    if (!u || !a) {
      setSaveMsg("Preencha SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/debug/set-local-supabase-env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ supabaseUrl: u, supabaseAnonKey: a, supabaseServiceRoleKey: sr || undefined }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `failed_${res.status}`));
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ supabaseUrl: u, supabaseAnonKey: a, supabaseServiceRoleKey: sr || "" }));
      } catch {}
      setSaveMsg("Salvo. Reinicie o dev server (npm run dev) para aplicar.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Diagnóstico Supabase</h1>
          <div className="cmv-subtitle">Mostra se as env vars necessárias existem, sem exibir valores.</div>
        </div>
      </header>

      {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}

      <section className="cmv-grid" style={{ marginTop: 16 }}>
        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>URL do Supabase</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Status: {data ? (data.url.resolved ? "OK" : "FALTANDO") : "Carregando…"}
          </div>
          <div className="cmv-help">Origem: {data?.url.from ?? "-"}</div>
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {Object.entries(data?.url.candidates ?? {}).map(([k, v]) => (
              <div key={k} className="cmv-help">
                {k}: {v ? "presente" : "ausente"}
              </div>
            ))}
          </div>
        </div>

        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>Anon key</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Status: {data ? (data.anonKey.resolved ? "OK" : "FALTANDO") : "Carregando…"}
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {Object.entries(data?.anonKey.candidates ?? {}).map(([k, v]) => (
              <div key={k} className="cmv-help">
                {k}: {v ? "presente" : "ausente"}
              </div>
            ))}
          </div>
          <div className="cmv-help" style={{ marginTop: 12 }}>
            Se estiver faltando, adicione na Vercel: NEXT_PUBLIC_SUPABASE_ANON_KEY (ou SUPABASE_ANON_KEY).
          </div>
        </div>

        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>Reset redirect</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Status: {reset ? (reset.redirectTo ? "OK" : "FALTANDO") : "Carregando…"}
          </div>
          <div className="cmv-help">redirectTo: {reset?.redirectTo ?? "-"}</div>
          <div className="cmv-help">siteUrl source: {reset?.siteUrl.value_source ?? "-"}</div>
          <div className="cmv-help" style={{ marginTop: 12 }}>
            O Supabase precisa permitir esse redirect em Authentication → URL Configuration → Additional Redirect URLs.
          </div>
        </div>
      </section>

      <section className="cmv-card" style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 900 }}>Configurar Supabase local</div>
        <div className="cmv-help" style={{ marginTop: 8 }}>
          Salva no <span className="cmv-code">.env.local</span> do projeto (apenas localhost) e também no seu navegador para não precisar colar de novo.
        </div>

        {saveMsg ? <div className="cmv-alert">{saveMsg}</div> : null}

        <label className="cmv-label" style={{ marginTop: 14 }}>
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

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" className="cmv-button cmv-button-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando…" : "Salvar chaves"}
          </button>
        </div>
      </section>
    </main>
  );
}
