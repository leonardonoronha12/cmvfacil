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
  import?: { domains: string[]; index: number; status: string; lastError: string; work?: any };
  lastError?: string;
};

export default function ImportarBubbleApiClient() {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyOptions, setCompanyOptions] = useState<Array<{ id: string; name: string; type?: string }> | null>(null);
  const [companyOptionsError, setCompanyOptionsError] = useState("");
  const [importAsUserId, setImportAsUserId] = useState("");
  const [typesText, setTypesText] = useState(
    "User\nempresas\ncategorias\ncusto_medio_item\ndesperdicio\netiquetas\nfaturamentos\nfornecedores\nIngredientes\ninventarios\nitens_fornecedores\nitens_inventarios\nItens_lista_compras\nitens_notas\nitem\nmotivos_desperdicios\nnotas_fiscais\nqtd_compra_real",
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
  const [dangerAction, setDangerAction] = useState<null | "delete" | "rebuild">(null);
  const [dangerInFlight, setDangerInFlight] = useState<null | "delete" | "rebuild">(null);
  const [dangerConfirm, setDangerConfirm] = useState("");
  const [globalTotals, setGlobalTotals] = useState<any>(null);
  const [globalTotalsError, setGlobalTotalsError] = useState("");
  const [userProgress, setUserProgress] = useState<any>(null);
  const [userProgressError, setUserProgressError] = useState("");
  const [rebuildState, setRebuildState] = useState<any>(null);
  const rebuildStopRef = useRef(false);
  const [versionInfo, setVersionInfo] = useState<any>(null);
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

  async function refreshGlobalTotals() {
    setGlobalTotalsError("");
    try {
      const res = await fetch(`/api/bubble-import/stats?scope=all&ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setGlobalTotals(json.totals ?? null);
    } catch (err) {
      setGlobalTotals(null);
      setGlobalTotalsError(safeJsonMessage(err));
    }
  }

  async function refreshUserProgress() {
    setUserProgressError("");
    try {
      const res = await fetch(`/api/bubble-import/progress-users?limit=200&ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setUserProgress(json);
    } catch (err) {
      setUserProgress(null);
      setUserProgressError(safeJsonMessage(err));
    }
  }

  async function refreshVersionInfo() {
    try {
      const res = await fetch(`/api/version?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json) return;
      setVersionInfo(json);
    } catch {
      // ignore
    }
  }

  async function loadCompanies() {
    setCompanyOptionsError("");
    try {
      const res = await fetch("/api/bubble-import/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, token }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      const list = Array.isArray(json?.companies) ? json.companies : [];
      setCompanyOptions(list);
      if (list.length && !companyId) setCompanyId(String(list[0]?.id ?? "").trim());
    } catch (err) {
      setCompanyOptions(null);
      setCompanyOptionsError(safeJsonMessage(err));
    }
  }

  useEffect(() => {
    void refreshCounts();
    void refreshGlobalTotals();
    void refreshUserProgress();
    void refreshVersionInfo();
  }, []);

  useEffect(() => {
    try {
      const savedBaseUrl = (window.localStorage.getItem("cmvfacil:bubbleBaseUrl") ?? "").trim();
      const savedToken = (window.localStorage.getItem("cmvfacil:bubbleToken") ?? "").trim();
      const savedCompanyId = (window.localStorage.getItem("cmvfacil:bubbleCompanyId") ?? "").trim();
      if (savedBaseUrl && !baseUrl) setBaseUrl(savedBaseUrl);
      if (savedToken && !token) setToken(savedToken);
      if (savedCompanyId && !companyId) setCompanyId(savedCompanyId);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (baseUrl) window.localStorage.setItem("cmvfacil:bubbleBaseUrl", baseUrl);
    } catch {}
  }, [baseUrl]);

  useEffect(() => {
    try {
      if (token) window.localStorage.setItem("cmvfacil:bubbleToken", token);
    } catch {}
  }, [token]);

  useEffect(() => {
    try {
      if (companyId) window.localStorage.setItem("cmvfacil:bubbleCompanyId", companyId);
    } catch {}
  }, [companyId]);

  useEffect(() => {
    if (!isRunning) return;
    const t = window.setInterval(() => {
      void refreshCounts();
      void refreshGlobalTotals();
      void refreshUserProgress();
      void refreshVersionInfo();
    }, 2000);
    return () => window.clearInterval(t);
  }, [isRunning]);

  useEffect(() => {
    if (!dangerInFlight) return;
    const t = window.setInterval(() => {
      void refreshCounts();
      void refreshGlobalTotals();
      void refreshUserProgress();
      void refreshVersionInfo();
    }, 2000);
    return () => window.clearInterval(t);
  }, [dangerInFlight]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cmvfacil:bubbleSyncStatePath") || "";
      if (saved) setSyncStatePath(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cmvfacil:bubbleImportAsUserId") || "";
      if (saved) setImportAsUserId(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (importAsUserId) window.localStorage.setItem("cmvfacil:bubbleImportAsUserId", importAsUserId);
    } catch {}
  }, [importAsUserId]);

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
      body: JSON.stringify({ statePath, baseUrl, token, companyId, maxOps: 12, resume: true, importAsUserId }),
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
    setDangerConfirm("");
    setDangerAction("delete");
  }

  async function rebuildFromFiles() {
    if (isRunning || isResetting) return;
    setResetError("");
    setDangerConfirm("");
    setDangerAction("rebuild");
  }

  async function confirmDanger() {
    if (!dangerAction || isRunning || isResetting) return;
    setResetError("");
    const required = dangerAction === "delete" ? "DELETE_ALL" : "RESET_AND_REIMPORT";
    if (dangerConfirm.trim() !== required) {
      setResetError("Confirmação incorreta.");
      return;
    }
    setIsResetting(true);
    setDangerInFlight(dangerAction);
    try {
      await refreshCounts();
      await refreshGlobalTotals();
      await refreshUserProgress();
      if (dangerAction === "delete") {
        setRebuildState(null);
        const res = await fetch("/api/bubble-import/reset-all", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: "DELETE_ALL" }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.ok) {
          const errPayload = json && typeof json === "object" ? json : { error: `failed_${res.status}` };
          const errValue = (errPayload as any)?.error ?? `failed_${res.status}`;
          const msg = typeof errValue === "string" ? errValue : JSON.stringify(errValue);
          setResult(JSON.stringify(errPayload, null, 2));
          throw new Error(msg);
        }
        await refreshCounts();
        resetServerSync();
      } else {
        setRebuildState(null);
        rebuildStopRef.current = false;
        const res = await fetch("/api/bubble-import/rebuild", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: "RESET_AND_REIMPORT", storageOwnerUserId: "", only: null, includeUnknown: true }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.ok) {
          const errPayload = json && typeof json === "object" ? json : { error: `failed_${res.status}` };
          const errValue = (errPayload as any)?.error ?? `failed_${res.status}`;
          const msgBase = typeof errValue === "string" ? errValue : JSON.stringify(errValue);
          setResult(JSON.stringify(errPayload, null, 2));
          throw new Error(msgBase);
        }
        const st = json.state;
        setRebuildState(st);
        setResult(JSON.stringify(st, null, 2));

        const statePath = String(st?.statePath ?? "").trim();
        if (!statePath) throw new Error("missing_statePath");

        for (let i = 0; i < 10_000; i++) {
          if (rebuildStopRef.current) break;
          await sleep(1200);
          const tickRes = await fetch("/api/bubble-import/rebuild/tick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ statePath }),
            cache: "no-store",
          });
          const tickJson = (await tickRes.json().catch(() => null)) as any;
          if (!tickRes.ok || !tickJson?.ok) {
            const errPayload = tickJson && typeof tickJson === "object" ? tickJson : { error: `failed_${tickRes.status}` };
            setResult(JSON.stringify(errPayload, null, 2));
            throw new Error(String((errPayload as any)?.error ?? `failed_${tickRes.status}`));
          }

          const next = tickJson.state;
          setRebuildState(next);
          setResult(JSON.stringify(next, null, 2));

          await refreshCounts();
          await refreshGlobalTotals();
          await refreshUserProgress();

          const phase = String(next?.phase ?? "").trim();
          if (phase === "done") break;
          if (phase === "error") throw new Error(String(next?.delete?.lastError || next?.steps?.find((s: any) => s?.status === "error")?.lastError || "failed"));
        }

        resetServerSync();
      }
      setDangerAction(null);
      setDangerConfirm("");
    } catch (err) {
      const msg = safeJsonMessage(err);
      setResetError(msg === "failed_504" ? "O servidor demorou e a requisição expirou (504). Tente novamente agora." : msg);
    } finally {
      setIsResetting(false);
      setDangerInFlight(null);
    }
  }

  function cancelDanger() {
    setDangerAction(null);
    setDangerConfirm("");
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

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileName}>Usuário destino (Supabase)</div>
                    <div className={styles.fileMeta}>Se preencher, a importação grava no userId informado (UUID), não no seu.</div>
                    <input
                      value={importAsUserId}
                      onChange={(e) => setImportAsUserId(e.currentTarget.value)}
                      placeholder="UUID do usuário (ex.: 00000000-0000-0000-0000-000000000000)"
                      className={styles.input}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              </div>

              {syncStatePath ? (
                <div className={styles.fileList}>
                  <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileName}>Sync no servidor</div>
                      <div className={styles.fileMeta}>statePath: {syncStatePath}</div>
                      {syncState?.phase ? <div className={styles.fileMeta}>fase: {syncState.phase}</div> : null}
                      {syncState?.import?.domains?.length ? (
                        <div className={styles.fileMeta}>
                          import: {syncState.import.status} ({Math.min(syncState.import.index + 1, syncState.import.domains.length)}/{syncState.import.domains.length}){" "}
                          {syncState.import.domains[syncState.import.index] ? `- ${syncState.import.domains[syncState.import.index]}` : ""}
                        </div>
                      ) : null}
                      {syncState?.import?.domains?.length && syncState?.import?.work && syncState.import.domains[syncState.import.index] ? (
                        <div className={styles.fileMeta}>
                          {(() => {
                            const d = syncState.import?.domains?.[syncState.import.index];
                            const w = d ? (syncState.import?.work as any)?.[d] : null;
                            const cur = typeof w?.cursor === "number" ? w.cursor : null;
                            const tot = typeof w?.total === "number" ? w.total : null;
                            const last = typeof w?.lastFile === "string" ? w.lastFile : "";
                            if (cur == null && tot == null && !last) return null;
                            const parts = [
                              cur != null && tot != null ? `arquivos: ${cur}/${tot}` : cur != null ? `arquivos: ${cur}` : tot != null ? `total: ${tot}` : "",
                              last ? `último: ${last.split("/").slice(-1)[0]}` : "",
                            ].filter(Boolean);
                            return parts.join(" • ");
                          })()}
                        </div>
                      ) : null}
                      {syncState?.lastError || syncState?.import?.lastError ? (
                        <div className={`${styles.fileMeta} ${styles.statusErr}`}>erro: {syncState.lastError || syncState.import?.lastError}</div>
                      ) : null}
                      {syncWarning ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>Conexão instável: {syncWarning}</div> : null}
                      {syncState?.phase === "error" ? (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() => void runSync()}
                            disabled={isRunning}
                            style={{ borderColor: "#ff2f54", color: "#ff2f54" }}
                          >
                            Retomar importação
                          </button>
                        </div>
                      ) : null}
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
                        disabled={isRunning || isResetting || dangerAction === "rebuild"}
                        style={{ borderColor: "#ff2f54", color: "#ff2f54" }}
                      >
                        {dangerInFlight === "delete" ? "Apagando..." : "Apagar dados do Supabase"}
                      </button>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={rebuildFromFiles}
                        disabled={isRunning || isResetting || dangerAction === "delete"}
                      >
                        {dangerInFlight === "rebuild" ? "Reimportando..." : "Reset + Reimportar (Arquivos)"}
                      </button>
                      {resetError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{resetError}</div> : null}
                    </div>
                    {rebuildState ? (
                      <div className={styles.fileMeta}>
                        Rebuild: {String(rebuildState?.phase ?? "—")} • Delete {Number(rebuildState?.delete?.index ?? 0)}/{Array.isArray(rebuildState?.delete?.tables) ? rebuildState.delete.tables.length : "—"}
                        {" • "}
                        Etapas{" "}
                        {Array.isArray(rebuildState?.steps)
                          ? `${(rebuildState.steps as any[]).filter((s) => s?.status === "done").length}/${(rebuildState.steps as any[]).length}`
                          : "—"}
                        {" • "}
                        Atualizado {String(rebuildState?.updatedAt ?? "—")}
                      </div>
                    ) : null}
                    {versionInfo ? (
                      <div className={styles.fileMeta}>
                        Versão: {(String(versionInfo?.vercel?.gitCommitSha ?? "") || "—").slice(0, 12)} • Deploy {String(versionInfo?.vercel?.deploymentUrl ?? "—")} • Agora{" "}
                        {String(versionInfo?.now ?? "—")}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div className={styles.fileMeta}>
                        Global: Auth {globalTotals?.authUsers ?? "—"} • Usuários com insumos {globalTotals?.usersWith?.insumos_state ?? "—"} • fornecedores{" "}
                        {globalTotals?.usersWith?.fornecedores_state ?? "—"} • pré-preparo {globalTotals?.usersWith?.pre_preparo_state ?? "—"} • fichas{" "}
                        {globalTotals?.usersWith?.fichas_tecnicas_state ?? "—"} • entradas {globalTotals?.rows?.entradas ?? "—"} • inventário{" "}
                        {globalTotals?.rows?.inventario ?? "—"} • desperdícios {globalTotals?.rows?.desperdicios ?? "—"}
                      </div>
                      {globalTotalsError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{globalTotalsError}</div> : null}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>
                        Por usuário: Total {userProgress?.totals?.users ?? "—"} • Completos (insumos+fornecedores+pré-preparo+fichas) {userProgress?.totals?.done?.all ?? "—"} •
                        Insumos {userProgress?.totals?.done?.insumos ?? "—"} • Fornecedores {userProgress?.totals?.done?.fornecedores ?? "—"} • Pré-preparo{" "}
                        {userProgress?.totals?.done?.prePreparo ?? "—"} • Fichas {userProgress?.totals?.done?.fichas ?? "—"}
                      </div>
                      {userProgressError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{userProgressError}</div> : null}
                      {Array.isArray(userProgress?.users) && userProgress.users.length ? (
                        <div className={styles.pathsBox} style={{ maxHeight: 240, overflow: "auto" }}>
                          {(userProgress.users as any[]).map((u) => {
                            const email = String(u?.email ?? "").trim() || String(u?.id ?? "").slice(0, 8);
                            const has = u?.has ?? {};
                            const line =
                              `${email} • ` +
                              `Insumos:${has.insumos ? "OK" : "Falta"} • ` +
                              `Fornecedores:${has.fornecedores ? "OK" : "Falta"} • ` +
                              `Pré-preparo:${has.prePreparo ? "OK" : "Falta"} • ` +
                              `Fichas:${has.fichas ? "OK" : "Falta"}`;
                            return <div key={String(u?.id ?? email)} className={styles.fileMeta}>{line}</div>;
                          })}
                          {userProgress?.truncated ? <div className={styles.fileMeta}>Lista truncada (mostrando 200)</div> : null}
                        </div>
                      ) : null}
                    </div>
                    {dangerAction ? (
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          className={styles.input}
                          value={dangerConfirm}
                          onChange={(e) => setDangerConfirm(e.target.value)}
                          placeholder={dangerAction === "delete" ? "Digite DELETE_ALL" : "Digite RESET_AND_REIMPORT"}
                          style={{ maxWidth: 260 }}
                        />
                        <button type="button" className={styles.btn} onClick={confirmDanger} disabled={isRunning || isResetting}>
                          Confirmar
                        </button>
                        <button type="button" className={styles.btn} onClick={cancelDanger} disabled={isRunning || isResetting}>
                          Cancelar
                        </button>
                      </div>
                    ) : null}
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>URL do Bubble</div>
                      <input className={styles.input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://seuapp.bubbleapps.io" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Token da Data API</div>
                      <input className={styles.input} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Empresa/Unidade ID (Bubble)</div>
                      <input
                        className={styles.input}
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        placeholder="ex: 1746219577632x984305616160817200"
                      />
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" className={styles.btn} onClick={loadCompanies} disabled={!baseUrl || !token || isRunning || isResetting}>
                        Carregar empresas do Bubble
                      </button>
                      {companyOptionsError ? <div className={styles.warnText}>{companyOptionsError}</div> : null}
                    </div>
                    {companyOptions?.length ? (
                      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className={styles.fileMeta}>Selecionar empresa</div>
                        <select className={styles.input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                          {companyOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
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
