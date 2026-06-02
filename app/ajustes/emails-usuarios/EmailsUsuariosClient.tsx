"use client";

import { useEffect, useMemo, useState } from "react";
import AppSidebar from "../../components/AppSidebar";
import dash from "../../dashboard/dashboard.module.css";
import styles from "../ajustes.module.css";

type ApiUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
};

type Mode = "bubble" | "supabase";

function safeMsg(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err ?? "");
}

function toShortId(id: string) {
  const v = String(id ?? "").trim();
  if (v.length <= 12) return v;
  return `${v.slice(0, 8)}…${v.slice(-4)}`;
}

export default function EmailsUsuariosClient() {
  const [mode, setMode] = useState<Mode>("bubble");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ApiUser[]>([]);
  const [bubbleEmails, setBubbleEmails] = useState<string[]>([]);
  const [bubbleSourcePath, setBubbleSourcePath] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadSupabase() {
    setIsLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/users-emails?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${res.status}`));
      setRows(Array.isArray(json?.users) ? (json.users as ApiUser[]) : []);
    } catch (err) {
      setRows([]);
      setError(safeMsg(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadBubble() {
    setIsLoading(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch(`/api/bubble-import/bubble-users-emails?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${res.status}`));
      setBubbleEmails(Array.isArray(json?.emails) ? (json.emails as string[]) : []);
      setBubbleSourcePath(String(json?.sourcePath ?? ""));
    } catch (err) {
      setBubbleEmails([]);
      setBubbleSourcePath("");
      setError(safeMsg(err));
    } finally {
      setIsLoading(false);
    }
  }

  const filteredSupabase = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.email ?? "").toLowerCase().includes(q) || String(r.id ?? "").toLowerCase().includes(q));
  }, [rows, filter]);

  const filteredBubble = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return bubbleEmails;
    return bubbleEmails.filter((e) => String(e ?? "").toLowerCase().includes(q));
  }, [bubbleEmails, filter]);

  const emailsText = useMemo(() => {
    if (mode === "bubble") return filteredBubble.join("\n");
    const emails = filteredSupabase
      .map((r) => (r.email ? String(r.email).trim().toLowerCase() : ""))
      .filter((e) => Boolean(e && e.includes("@")));
    return Array.from(new Set(emails)).sort().join("\n");
  }, [filteredBubble, filteredSupabase, mode]);

  useEffect(() => {
    void loadBubble();
  }, []);

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(emailsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      setCopied(false);
      setError(safeMsg(err) || "copy_failed");
    }
  }

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div className={styles.headerIcon} aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M8 7h13M8 12h13M8 17h13M3 7h.01M3 12h.01M3 17h.01"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <h1 className={styles.title} style={{ marginBottom: 2 }}>
                  Emails dos Usuários
                </h1>
                <div className={styles.helpText}>
                  {mode === "bubble" ? "Emails extraídos do arquivo de Users do Bubble (do seu upload)." : "Lista de emails cadastrados no Supabase Auth (somente admin)."}
                </div>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.panelInner}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className={mode === "bubble" ? styles.btnPrimary : styles.btnGhost}
                        onClick={() => {
                          setMode("bubble");
                          setFilter("");
                          void loadBubble();
                        }}
                        disabled={isLoading}
                      >
                        Bubble
                      </button>
                      <button
                        type="button"
                        className={mode === "supabase" ? styles.btnPrimary : styles.btnGhost}
                        onClick={() => {
                          setMode("supabase");
                          setFilter("");
                          void loadSupabase();
                        }}
                        disabled={isLoading}
                      >
                        Supabase Auth
                      </button>
                    </div>
                    <label className={styles.field} style={{ margin: 0 }}>
                      <span className={styles.label}>Filtrar</span>
                      <input className={styles.input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="email ou id" />
                    </label>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={() => {
                        if (mode === "bubble") void loadBubble();
                        else void loadSupabase();
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? "Carregando..." : "Atualizar"}
                    </button>
                    <button type="button" className={styles.btnGhost} onClick={copyEmails} disabled={!emailsText || isLoading}>
                      {copied ? "Copiado" : "Copiar emails"}
                    </button>
                  </div>
                  <div className={styles.helpText}>{mode === "bubble" ? `${filteredBubble.length}/${bubbleEmails.length}` : `${filteredSupabase.length}/${rows.length}`}</div>
                </div>

                {error ? <div className={styles.dangerHelp}>{error}</div> : null}

                {mode === "bubble" ? (
                  <div style={{ marginTop: 14 }}>
                    <div className={styles.helpText} style={{ marginBottom: 8 }}>
                      {bubbleSourcePath ? `Arquivo detectado: ${bubbleSourcePath}` : "Nenhum arquivo de Users do Bubble encontrado ainda."}
                    </div>
                    <textarea className={styles.input} value={emailsText} readOnly style={{ height: "auto", minHeight: 260, padding: "10px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace" }} />
                  </div>
                ) : null}

                <div style={{ overflowX: "auto", marginTop: 14 }}>
                  {mode === "supabase" ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e8e7" }}>
                        <th style={{ padding: "10px 8px" }}>Email</th>
                        <th style={{ padding: "10px 8px" }}>ID</th>
                        <th style={{ padding: "10px 8px" }}>Criado</th>
                        <th style={{ padding: "10px 8px" }}>Último login</th>
                        <th style={{ padding: "10px 8px" }}>Ban</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSupabase.map((u) => (
                        <tr key={u.id} style={{ borderBottom: "1px solid #f0f2f1" }}>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{u.email ?? "—"}</td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }} title={u.id}>
                            {toShortId(u.id)}
                          </td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{u.created_at ?? "—"}</td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{u.last_sign_in_at ?? "—"}</td>
                          <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{u.banned_until ?? "—"}</td>
                        </tr>
                      ))}
                      {!filteredSupabase.length ? (
                        <tr>
                          <td colSpan={5} style={{ padding: "12px 8px", color: "#4d4f56" }}>
                            Nenhum usuário encontrado.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
