"use client";

import { useEffect, useMemo, useState } from "react";
import AppSidebar from "../../components/AppSidebar";
import dash from "../../dashboard/dashboard.module.css";
import styles from "../importar-bubble/importar-bubble.module.css";

type ApiState = {
  ok: boolean;
  error?: string;
  source?: "db" | "env" | "none";
  db?: { baseUrl: string; tokenPresent: boolean; updatedAt: string | null; tableMissing?: boolean };
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

export type BubbleGlobalPanelApi = {
  setBaseUrl: (value: string) => void;
  setToken: (value: string) => void;
  save: () => Promise<boolean>;
  ping: () => Promise<void>;
  saveAndPing: () => Promise<void>;
};

export function BubbleGlobalPanel(props?: { compact?: boolean; onApi?: (api: BubbleGlobalPanelApi) => void }) {
  const compact = Boolean(props?.compact);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<ApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [pingMsg, setPingMsg] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [schemaSql, setSchemaSql] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

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
      setSchemaSql(null);
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

  async function ping() {
    if (pinging) return;
    setPinging(true);
    setPingMsg(null);
    setPingError(null);
    try {
      const res = await fetch(`/api/health/bubble-ping?ts=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${res.status}`));
      const tested = String(json?.typeTested ?? "").trim();
      const count = json?.count;
      setPingMsg(`OK (${tested || "type"}${typeof count === "number" ? ` • ${count} item(s)` : ""})`);
    } catch (e) {
      setPingError(safeMsg(e));
    } finally {
      setPinging(false);
    }
  }

  async function save() {
    if (!canSave) return false;
    setSaving(true);
    setMsg(null);
    setError(null);
    setSchemaSql(null);
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
      if (!res.ok || !json?.ok) {
        if (String(json?.error ?? "") === "missing_bubble_global_config_table" && typeof json?.sql === "string") {
          setSchemaSql(String(json.sql));
          throw new Error("Tabela bubble_global_config não existe no Supabase.");
        }
        throw new Error(String(json?.error ?? `failed_${res.status}`));
      }
      setClearToken(false);
      setClearBaseUrl(false);
      setMsg("Configuração salva.");
      await refresh();
      return true;
    } catch (e) {
      setError(safeMsg(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    props?.onApi?.({
      setBaseUrl,
      setToken,
      save,
      ping,
      saveAndPing: async () => {
        const ok = await save();
        if (ok) await ping();
      },
    });
  }, [props, save]);

  function parsePaste() {
    const text = String(paste ?? "");
    const url = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? "";
    const tokenBearer = text.match(/\bbearer\s+([^\s]+)/i)?.[1] ?? "";
    const lines = text
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter(Boolean);
    const tokenLine = lines.find((l) => l.length >= 20 && !/\s/.test(l));
    const nextBaseUrl = url ? normalizeBaseUrl(url) : "";
    const nextToken = tokenBearer || tokenLine || "";
    if (nextBaseUrl) setBaseUrl(nextBaseUrl);
    if (nextToken) setToken(nextToken);
  }

  return (
    <section className={styles.wrap} style={{ maxWidth: 920 }}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Conexão Bubble</div>
          <div className={styles.subtitle}>Salva credenciais globais para o backend usar em todos os usuários.</div>
        </div>
      </div>

      {loading ? <div className={styles.pathsBox}>Carregando…</div> : null}
      {error ? <div className={`${styles.pathsBox} ${styles.statusErr}`}>{error}</div> : null}
      {msg ? <div className={styles.pathsBox}>{msg}</div> : null}
      {schemaSql ? (
        <div className={styles.pathsBox}>
          <div className={styles.fileMeta}>Crie a tabela no Supabase SQL Editor e tente salvar novamente:</div>
          <textarea className={styles.textarea} value={schemaSql} readOnly rows={10} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              type="button"
              className={styles.btn}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(schemaSql);
                } catch {
                  window.prompt("Copie o SQL:", schemaSql);
                }
              }}
            >
              Copiar SQL
            </button>
          </div>
        </div>
      ) : null}

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
              {!compact ? (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className={styles.fileMeta}>Status</div>
                  <div className={styles.pathsBox} style={{ marginTop: 8 }}>
                    <div className={styles.fileMeta}>DB Base URL: {state.db?.baseUrl ? "OK" : "—"}</div>
                    <div className={styles.fileMeta}>DB Token: {state.db?.tokenPresent ? "OK" : "—"}</div>
                    <div className={styles.fileMeta}>DB Atualizado em: {state.db?.updatedAt ? new Date(state.db.updatedAt).toLocaleString() : "—"}</div>
                    <div className={styles.fileMeta}>Tabela bubble_global_config: {state.db?.tableMissing ? "FALTANDO" : "OK"}</div>
                    <div className={styles.fileMeta}>ENV Base URL: {state.env?.baseUrl ? "OK" : "—"}</div>
                    <div className={styles.fileMeta}>ENV Token: {state.env?.tokenPresent ? "OK" : "—"}</div>
                  </div>
                </div>
              ) : null}
            </div>

            {!compact ? (
              <div style={{ marginTop: 12 }}>
                <div className={styles.fileMeta}>Cole aqui URL e token (opcional)</div>
                <textarea className={styles.textarea} value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder="Cole a URL e o token aqui" />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button type="button" className={styles.btn} onClick={parsePaste} disabled={!paste.trim() || saving}>
                    Preencher campos
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.row} style={{ marginTop: 14, alignItems: "flex-start" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 260 }}>
                <div className={styles.fileMeta}>BUBBLE_BASE_URL</div>
                <input
                  className={styles.input}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="ex: https://api.seudominio.com"
                  disabled={saving || clearBaseUrl}
                />
                {!compact ? (
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#111827" }}>
                    <input type="checkbox" checked={clearBaseUrl} onChange={(e) => setClearBaseUrl(e.target.checked)} />
                    Limpar Base URL do DB
                  </label>
                ) : null}
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
                {!compact ? (
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#111827" }}>
                    <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} />
                    Limpar Token do DB
                  </label>
                ) : null}
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
              <button type="button" className={styles.btn} onClick={save} disabled={!canSave}>
                {saving ? "Salvando…" : "Salvar"}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={async () => {
                  const ok = await save();
                  if (ok) await ping();
                }}
                disabled={!canSave || saving || pinging}
              >
                Salvar e testar
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={ping} disabled={pinging}>
                {pinging ? "Testando..." : "Testar conexão"}
              </button>
              {!compact ? (
                <a className={styles.btn} href="/api/health/bubble-config" target="_blank" rel="noreferrer">
                  Verificar status
                </a>
              ) : null}
              {pingMsg ? <div className={styles.fileMeta}>{pingMsg}</div> : null}
            </div>

            {pingError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{pingError}</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function BubbleGlobalClient() {
  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <BubbleGlobalPanel />
        </div>
      </main>
    </div>
  );
}
