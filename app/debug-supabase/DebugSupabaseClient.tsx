"use client";

import { useEffect, useState } from "react";

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
    </main>
  );
}
