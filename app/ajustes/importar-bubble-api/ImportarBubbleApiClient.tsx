"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import AppSidebar from "../../components/AppSidebar";
import styles from "../importar-bubble/importar-bubble.module.css";

function safeJsonMessage(err: unknown) {
  if (!err) return "Erro desconhecido";
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

type SyncState = {
  v: 1;
  runId: string;
  runPrefix: string;
  statePath: string;
  phase: "pulling" | "importing" | "done" | "error";
  types: string[];
  currentTypeIndex: number;
  perType: Record<
    string,
    { status: string; fetched: number; parts: number; remaining: number | null; lastPath: string; lastError?: string; errorCount?: number }
  >;
  import?: { domains: string[]; index: number; status: string; lastError: string };
  lastError?: string;
};

export default function ImportarBubbleApiClient() {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [typesText, setTypesText] = useState(
    "categorias\ncusto_medio_item\ndesperdicio\nempresas\netiquetas\nfaturamentos\nfornecedores\nIngredientes\ninventarios\nitens_fornecedores\nitens_inventarios\nItens_lista_compras\nitens_notas\nitem\nmotivos_desperdicios\nnotas_fiscais\nqtd_compra_real\nUser",
  );
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<"idle" | "pulling" | "importing" | "done" | "error">("idle");
  const [result, setResult] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, { status: string; fetched: number; parts: number; remaining: number | null; lastPath: string }> | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [countsError, setCountsError] = useState<string>("");
  const [countsInfo, setCountsInfo] = useState<string>("");
  const [isRefreshingCounts, setIsRefreshingCounts] = useState(false);
  const [resetError, setResetError] = useState<string>("");
  const [isResetting, setIsResetting] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string>("");
  const stopRef = useRef(false);
  const [syncStatePath, setSyncStatePath] = useState<string>("");
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  const types = useMemo(() => {
    return typesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [typesText]);

  async function refreshCounts() {
    setCountsError("");
    setCountsInfo("");
    setIsRefreshingCounts(true);
    try {
      const res = await fetch(`/api/bubble-import/stats?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; counts?: Record<string, number>; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setCounts(json.counts ?? {});
      setCountsInfo(`Atualizado em ${new Date().toLocaleString()}`);
    } catch (err) {
      setCounts(null);
      setCountsError(safeJsonMessage(err));
    } finally {
      setIsRefreshingCounts(false);
    }
  }

  useEffect(() => {
    void refreshCounts();
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const t = window.setInterval(() => {
      void refreshCounts();
    }, 2000);
    return () => window.clearInterval(t);
  }, [isRunning]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cmvfacil:bubbleSyncStatePath") || "";
      if (saved) setSyncStatePath(saved);
    } catch {}
  }, []);

  useEffect(() => {
    if (!syncStatePath) return;
    void (async () => {
      try {
        const st = await loadServerSyncStatus(syncStatePath);
        setProgress(
          Object.fromEntries(
            Object.entries(st.perType ?? {}).map(([k, v]) => [
              k,
              {
                status: v.status,
                fetched: v.fetched ?? 0,
                parts: v.parts ?? 0,
                remaining: v.remaining ?? null,
                lastPath: v.lastPath ?? "",
              },
            ]),
          ),
        );
        if (st.phase === "importing") setStage("importing");
        if (st.phase === "done") setStage("done");
        if (st.phase === "error") {
          setStage("error");
          setResult(st.lastError || st.import?.lastError || "erro");
        }
      } catch {}
    })();
  }, [syncStatePath]);

  useEffect(() => {
    try {
      if (syncStatePath) window.localStorage.setItem("cmvfacil:bubbleSyncStatePath", syncStatePath);
    } catch {}
  }, [syncStatePath]);

  async function startServerSync() {
    setResult("");
    const res = await fetch("/api/bubble-import/sync/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ types }) });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
    const st = json.state as SyncState;
    setSyncState(st);
    setSyncStatePath(st.statePath);
    return st;
  }

  async function tickServerSync(statePath: string) {
    const res = await fetch("/api/bubble-import/sync/tick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statePath, baseUrl, token, maxOps: 12 }),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
    const st = json.state as SyncState;
    setSyncState(st);
    return st;
  }

  async function loadServerSyncStatus(statePath: string) {
    const res = await fetch(`/api/bubble-import/sync/status?statePath=${encodeURIComponent(statePath)}`, { method: "GET" });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
    const st = json.state as SyncState;
    setSyncState(st);
    return st;
  }

  async function resetSupabaseData() {
    if (isResetting) return;
    setResetError("");
    const confirm = window.prompt('Digite DELETE_ALL para apagar os dados do Supabase (insumos, fornecedores, entradas, desperdícios, inventário e estados):', "");
    if (!confirm) return;
    if (confirm.trim() !== "DELETE_ALL") {
      setResetError("Confirmação incorreta.");
      return;
    }
    setIsResetting(true);
    try {
      const res = await fetch("/api/bubble-import/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE_ALL" }) });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      await refreshCounts();
      resetServerSync();
    } catch (err) {
      setResetError(safeJsonMessage(err));
    } finally {
      setIsResetting(false);
    }
  }

  async function runSync() {
    if (isRunning) return;
    setIsRunning(true);
    setStage("pulling");
    setResult("");
    setSyncWarning("");
    setProgress(null);
    stopRef.current = false;
    try {
      let statePath = syncStatePath;
      if (!statePath) {
        const started = await startServerSync();
        statePath = started.statePath;
      }

      let consecutiveErrors = 0;
      for (let i = 0; i < 2000000; i++) {
        if (stopRef.current) break;
        let st: SyncState;
        try {
          st = await tickServerSync(statePath);
          consecutiveErrors = 0;
          setSyncWarning("");
        } catch (err) {
          consecutiveErrors += 1;
          const msg = safeJsonMessage(err);
          setSyncWarning(msg);
          try {
            st = await loadServerSyncStatus(statePath);
          } catch {
            await sleep(Math.min(10_000, 500 * Math.pow(2, Math.min(consecutiveErrors, 4))));
            continue;
          }
          await sleep(Math.min(10_000, 500 * Math.pow(2, Math.min(consecutiveErrors, 4))));
        }
        setProgress(
          Object.fromEntries(
            Object.entries(st.perType ?? {}).map(([k, v]) => [
              k,
              {
                status: v.status,
                fetched: v.fetched ?? 0,
                parts: v.parts ?? 0,
                remaining: v.remaining ?? null,
                lastPath: v.lastPath ?? "",
              },
            ]),
          ),
        );
        if (st.phase === "importing") setStage("importing");
        if (st.phase === "done") {
          setStage("done");
          break;
        }
        if (st.phase === "error") {
          setStage("error");
          setResult(st.lastError || st.import?.lastError || "erro");
          break;
        }
        await sleep(400);
      }
    } catch (err) {
      setResult(safeJsonMessage(err));
      setStage("error");
    } finally {
      setIsRunning(false);
    }
  }

  function stop() {
    stopRef.current = true;
  }

  function resetServerSync() {
    try {
      window.localStorage.removeItem("cmvfacil:bubbleSyncStatePath");
    } catch {}
    setSyncStatePath("");
    setSyncState(null);
    setProgress(null);
    setResult("");
    setSyncWarning("");
    setStage("idle");
  }

  const progressList = useMemo(() => {
    const p = progress ?? {};
    return types.map((t) => ({ type: t, ...(p[t] ?? { status: "pending", fetched: 0, parts: 0, remaining: null, lastPath: "" }) }));
  }, [progress, types]);

  const totals = useMemo(() => {
    const list = progressList;
    const done = list.filter((r) => r.status === "done").length;
    const fetched = list.reduce((sum, r) => sum + (Number.isFinite(r.fetched) ? r.fetched : 0), 0);
    const remainingKnown = list.every((r) => r.status === "done" || typeof r.remaining === "number");
    const remaining = remainingKnown ? list.reduce((sum, r) => sum + (typeof r.remaining === "number" ? r.remaining : 0), 0) : null;
    return { done, total: list.length, fetched, remaining };
  }, [progressList]);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div>
                <h1 className={styles.title}>Importar do Bubble via API</h1>
                <p className={styles.sub}>Puxa os dados do /obj do Bubble em partes (com progresso) e salva como .json no Storage para você importar no sistema.</p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={refreshCounts} disabled={isRunning}>
                  {isRefreshingCounts ? "Atualizando..." : "Atualizar contagens"}
                </button>
                <button type="button" className={styles.btn} onClick={stop} disabled={!isRunning}>
                  Parar
                </button>
                <button type="button" className={styles.btn} onClick={resetServerSync} disabled={isRunning}>
                  Resetar sync
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runSync} disabled={isRunning || !types.length}>
                  {isRunning ? (stage === "importing" ? "Organizando..." : "Puxando...") : "Sincronizar tudo"}
                </button>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.notice}>
                <span className={styles.noticeStrong}>Passo 2:</span> depois de puxar, vá em /ajustes/importar-bubble e clique em “Importar tudo”.
              </div>

              {syncStatePath ? (
                <div className={styles.fileList}>
                  <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileName}>Sync no servidor</div>
                      <div className={styles.fileMeta}>statePath: {syncStatePath}</div>
                      {syncState?.phase ? <div className={styles.fileMeta}>fase: {syncState.phase}</div> : null}
                      {syncWarning ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>Conexão instável: {syncWarning}</div> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileName}>Para onde vai no Supabase</div>
                    <div className={styles.pathsBox}>
                      {JSON.stringify(
                        {
                          "categorias + custo_medio_item + item + Ingredientes": "insumos_state (payload.rows + payload.categories)",
                          "fornecedores + itens_fornecedores + equivalencias": "fornecedores_state (info/produtos/equivalencias)",
                          "notas_fiscais + itens_notas": "entradas (linhas, id prefixado por user:<id>:entrada:...)",
                          "desperdicio + motivos_desperdicios": "desperdicios (linhas, id prefixado por user:<id>:desperdicio:...)",
                          "inventarios + itens_inventarios": "inventario (linhas, id prefixado por user:<id>:inventario:...)",
                          "pre_preparo + pre_preparo_etiquetas (se existirem)": "pre_preparo_state + pre_preparo_etiquetas_state",
                          "fichas_tecnicas (se existir)": "fichas_tecnicas_state",
                        },
                        null,
                        2,
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileName}>Supabase (o que já tem no sistema)</div>
                    {countsInfo ? <div className={styles.fileMeta}>{countsInfo}</div> : null}
                    {countsError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{countsError}</div> : null}
                    {counts ? (
                      <div className={styles.pathsBox}>
                        {JSON.stringify(
                          {
                            insumos: counts.insumos ?? 0,
                            fornecedores: counts.fornecedores ?? 0,
                            fornecedoresProdutos: counts.fornecedoresProdutos ?? 0,
                            fornecedoresEquivalencias: counts.fornecedoresEquivalencias ?? 0,
                            fichasTecnicas: counts.fichasTecnicas ?? 0,
                            prePreparo: counts.prePreparo ?? 0,
                            etiquetasPrePreparo: counts.etiquetasPrePreparo ?? 0,
                            entradas: counts.entradas ?? 0,
                            desperdicios: counts.desperdicios ?? 0,
                            inventario: counts.inventario ?? 0,
                          },
                          null,
                          2,
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileName}>Bubble (puxando via API)</div>
                    <div className={styles.fileMeta}>
                      {totals.done}/{totals.total} tabelas concluídas • {totals.fetched.toLocaleString("pt-BR")} itens
                      {typeof totals.remaining === "number" ? ` • faltam ${totals.remaining.toLocaleString("pt-BR")}` : ""}
                    </div>
                    <div className={styles.progressWrap}>
                      <div
                        className={styles.progressFill}
                        style={{
                          width:
                            totals.total > 0
                              ? `${Math.round((totals.done / totals.total) * 100)}%`
                              : "0%",
                        }}
                      />
                    </div>
                    <div className={styles.fileList}>
                      {progressList.map((r) => {
                        const denom = typeof r.remaining === "number" ? r.fetched + r.remaining : 0;
                        const pct = denom > 0 ? Math.round((r.fetched / denom) * 100) : null;
                        return (
                          <div key={r.type} className={styles.fileRow}>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <div className={styles.fileName}>{r.type}</div>
                              <div className={styles.fileMeta}>
                                {r.status} • {r.fetched.toLocaleString("pt-BR")} itens • {r.parts} partes
                                {typeof r.remaining === "number" ? ` • ${pct ?? 0}%` : ""}
                              </div>
                              {r.lastPath ? <div className={styles.fileMeta}>{r.lastPath}</div> : null}
                            </div>
                            <div style={{ width: 160, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                              <div className={styles.progressWrap}>
                                <div className={styles.progressFill} style={{ width: typeof pct === "number" ? `${pct}%` : r.status === "done" ? "100%" : "20%" }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.fileList} style={{ marginTop: 12 }}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={resetSupabaseData}
                        disabled={isRunning || isResetting}
                        style={{ borderColor: "#ff2f54", color: "#ff2f54" }}
                      >
                        {isResetting ? "Apagando..." : "Apagar dados do Supabase"}
                      </button>
                      {resetError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{resetError}</div> : null}
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>URL do Bubble</div>
                      <input className={styles.input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://seuapp.bubbleapps.io" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Token da Data API</div>
                      <input className={styles.input} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Data Types (1 por linha)</div>
                      <textarea
                        className={styles.textarea}
                        value={typesText}
                        onChange={(e) => setTypesText(e.target.value)}
                        rows={8}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {result ? <div className={styles.pathsBox}>{result}</div> : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
