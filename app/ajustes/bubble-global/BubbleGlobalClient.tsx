"use client";

import { useEffect, useMemo, useState } from "react";
import AppSidebar from "../../components/AppSidebar";
import dash from "../../dashboard/dashboard.module.css";
import styles from "../importar-bubble/importar-bubble.module.css";

type ApiState = {
  ok: boolean;
  error?: string;
  source?: "db" | "env" | "none";
  db?: { baseUrl: string; tokenPresent: boolean; updatedAt: string | null };
  env?: { baseUrl: string; tokenPresent: boolean };
  active?: { baseUrl: string; tokenPresent: boolean };
};

function safeMsg(err: unknown) {
  if (!err) return "Erro desconhecido";
  if (err instanceof Error) return err.message;
  return String(err);
}

function normalizeBaseUrl(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  return noTrail.replace(/\/api\/1\.1\/obj$/i, "").replace(/\/api\/1\.1$/i, "");
}

export default function BubbleGlobalClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<ApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [clearBaseUrl, setClearBaseUrl] = useState(false);

  const canSave = useMemo(() => {
    if (saving) return false;
    if (clearToken || clearBaseUrl) return true;
    return Boolean(normalizeBaseUrl(baseUrl) || token.trim());
  }, [baseUrl, clearBaseUrl, clearToken, saving, token]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bubble-global-config?ts=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiState | null;
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${res.status}`));
      setState(json);
      setBaseUrl(json.active?.baseUrl ?? "");
    } catch (e) {
      setError(safeMsg(e));
      setState(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/bubble-global-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: clearBaseUrl ? "" : normalizeBaseUrl(baseUrl),
          token: clearToken ? "" : token.trim(),
          clearToken,
          clearBaseUrl,
        }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${res.status}`));
      setToken("");
      setClearToken(false);
      setClearBaseUrl(false);
      setMsg("Configuração salva.");
      await refresh();
    } catch (e) {
      setError(safeMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <section className={styles.wrap} style={{ maxWidth: 920 }}>
            <div className={styles.header}>
              <div>
                <div className={styles.title}>Bubble API Global</div>
                <div className={styles.subtitle}>Salva credenciais globais para o backend usar em todos os usuários (sem depender do navegador).</div>
              </div>
            </div>

            {loading ? <div className={styles.pathsBox}>Carregando…</div> : null}
            {error ? <div className={`${styles.pathsBox} ${styles.statusErr}`}>{error}</div> : null}
            {msg ? <div className={styles.pathsBox}>{msg}</div> : null}

            {state?.ok ? (
              <div className={styles.card}>
                <div className={styles.cardInner}>
                  <div className={styles.row} style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div className={styles.fileMeta}>Ativo agora</div>
                      <div className={styles.pathsBox} style={{ marginTop: 8 }}>
                        <div className={styles.fileMeta}>Fonte: {state.source}</div>
                        <div className={styles.fileMeta}>Base URL: {state.active?.baseUrl || "—"}</div>
                        <div className={styles.fileMeta}>Token: {state.active?.tokenPresent ? "OK" : "FALTANDO"}</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div className={styles.fileMeta}>Status</div>
                      <div className={styles.pathsBox} style={{ marginTop: 8 }}>
                        <div className={styles.fileMeta}>DB Base URL: {state.db?.baseUrl ? "OK" : "—"}</div>
                        <div className={styles.fileMeta}>DB Token: {state.db?.tokenPresent ? "OK" : "—"}</div>
                        <div className={styles.fileMeta}>ENV Base URL: {state.env?.baseUrl ? "OK" : "—"}</div>
                        <div className={styles.fileMeta}>ENV Token: {state.env?.tokenPresent ? "OK" : "—"}</div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.row} style={{ marginTop: 14, alignItems: "flex-start" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 260 }}>
                      <div className={styles.fileMeta}>BUBBLE_BASE_URL</div>
                      <input
                        className={styles.input}
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="ex: https://api.app.cmvfacil.com"
                        disabled={saving || clearBaseUrl}
                      />
                      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#111827" }}>
                        <input type="checkbox" checked={clearBaseUrl} onChange={(e) => setClearBaseUrl(e.target.checked)} />
                        Limpar Base URL do DB
                      </label>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 260 }}>
                      <div className={styles.fileMeta}>BUBBLE_API_TOKEN</div>
                      <input
                        className={styles.input}
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="cole o token aqui"
                        autoComplete="off"
                        disabled={saving || clearToken}
                      />
                      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#111827" }}>
                        <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} />
                        Limpar Token do DB
                      </label>
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    <button type="button" className={styles.btn} onClick={save} disabled={!canSave}>
                      {saving ? "Salvando…" : "Salvar"}
                    </button>
                    <a className={styles.btn} href="/api/health/bubble-config" target="_blank" rel="noreferrer">
                      Verificar status
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}

