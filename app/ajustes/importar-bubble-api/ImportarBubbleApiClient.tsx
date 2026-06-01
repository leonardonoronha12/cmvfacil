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
  const stopRef = useRef(false);

  const types = useMemo(() => {
    return typesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [typesText]);

  async function refreshCounts() {
    setCountsError("");
    try {
      const res = await fetch("/api/bubble-import/stats", { method: "GET" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; counts?: Record<string, number>; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setCounts(json.counts ?? {});
    } catch (err) {
      setCounts(null);
      setCountsError(safeJsonMessage(err));
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

  async function runSync() {
    if (isRunning) return;
    setIsRunning(true);
    setStage("pulling");
    setResult("");
    setProgress(null);
    stopRef.current = false;
    try {
      const runId = crypto.randomUUID();
      const prog: Record<string, { status: string; fetched: number; parts: number; remaining: number | null; lastPath: string }> = {};

      const importOnly = async (only: string[]) => {
        if (stopRef.current) return;
        setStage("importing");
        const importRes = await fetch("/api/bubble-import/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ only, includeUnknown: true }),
        });
        const importText = await importRes.text();
        let importJson: unknown = null;
        try {
          importJson = JSON.parse(importText);
        } catch {}
        if (!importRes.ok || !importJson || (importJson as any).ok !== true) throw new Error((importJson as any)?.error || importText || `failed_${importRes.status}`);
        await refreshCounts();
        setStage("pulling");
      };

      const decideImportDomain = (typeName: string) => {
        const t = typeName.trim();
        const lower = t.toLowerCase();
        if (lower === "item" || lower === "ingredientes" || lower === "custo_medio_item" || lower === "categorias") return ["insumos"];
        if (lower === "fornecedores" || lower === "itens_fornecedores") return ["fornecedores"];
        if (lower === "notas_fiscais" || lower === "itens_notas") return ["entradas"];
        if (lower === "desperdicio" || lower === "motivos_desperdicios") return ["desperdicios"];
        if (lower === "inventarios" || lower === "itens_inventarios") return ["inventario"];
        if (lower === "etiquetas") return ["pre_preparo"];
        return null;
      };

      for (const typeName of types) {
        if (stopRef.current) break;
        prog[typeName] = { status: "pulling", fetched: 0, parts: 0, remaining: null as number | null, lastPath: "" };
        setProgress({ ...prog });
        let cursor = 0;
        let part = 1;
        for (let guard = 0; guard < 100000; guard++) {
          if (stopRef.current) break;
          const res = await fetch("/api/bubble-import/pull-page", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ baseUrl, token, type: typeName, cursor, limit: 100, runId, part }),
          });
          const json = (await res.json().catch(() => null)) as any;
          if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
          const up = json.uploaded ?? {};
          const rows = typeof up.rows === "number" ? up.rows : 0;
          cursor = typeof up.nextCursor === "number" ? up.nextCursor : cursor + rows;
          prog[typeName] = {
            status: json.done ? "done" : "pulling",
            fetched: (prog[typeName]?.fetched ?? 0) + rows,
            parts: part,
            remaining: typeof up.remaining === "number" ? up.remaining : null,
            lastPath: String(up.path ?? ""),
          };
          setProgress({ ...prog });
          part += 1;
          if (json.done) break;
        }
        if (prog[typeName]?.status !== "done") {
          prog[typeName] = { ...(prog[typeName] ?? {}), status: "stopped" };
          setProgress({ ...prog });
          break;
        }

        const domain = decideImportDomain(typeName);
        if (domain?.length) await importOnly(domain);
      }
      setResult(JSON.stringify({ runId, progress: prog }, null, 2));

      if (stopRef.current) {
        setStage("idle");
        return;
      }

      setStage("importing");
      const importRes = await fetch("/api/bubble-import/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ includeUnknown: true }) });
      const importText = await importRes.text();
      let importJson: unknown = null;
      try {
        importJson = JSON.parse(importText);
      } catch {}
      if (!importRes.ok || !importJson || (importJson as any).ok !== true) throw new Error((importJson as any)?.error || importText || `failed_${importRes.status}`);
      setResult(JSON.stringify({ runId, progress: prog, import: importJson }, null, 2));
      await refreshCounts();
      setStage("done");
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
                  Atualizar contagens
                </button>
                <button type="button" className={styles.btn} onClick={stop} disabled={!isRunning}>
                  Parar
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
                    <div className={styles.fileName}>Supabase (o que já tem no sistema)</div>
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
