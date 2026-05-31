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
    "categorias\ncusto_medio_item\ndesperdicio\nempresas\netiquetas\nfaturamentos\nfornecedores\ningredientes\ninventarios\nitens_fornecedores\nitens_inventarios\nitens_lista_compras\nitens_notas\nitem\nmotivos_desperdicios\nnotas_fiscais\nqtd_compra_real\nuser",
  );
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string>("");
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

  async function runPullPaged() {
    if (isRunning) return;
    setIsRunning(true);
    setResult("");
    stopRef.current = false;
    try {
      const runId = crypto.randomUUID();
      const progress: Record<string, any> = {};
      for (const typeName of types) {
        if (stopRef.current) break;
        progress[typeName] = { status: "pulling", fetched: 0, parts: 0, remaining: null as number | null, lastPath: "" };
        setResult(JSON.stringify({ runId, progress }, null, 2));
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
          progress[typeName] = {
            status: json.done ? "done" : "pulling",
            fetched: (progress[typeName]?.fetched ?? 0) + rows,
            parts: part,
            remaining: typeof up.remaining === "number" ? up.remaining : null,
            lastPath: String(up.path ?? ""),
          };
          setResult(JSON.stringify({ runId, progress }, null, 2));
          part += 1;
          if (json.done) break;
        }
        if (progress[typeName]?.status !== "done") {
          progress[typeName] = { ...(progress[typeName] ?? {}), status: "stopped" };
          setResult(JSON.stringify({ runId, progress }, null, 2));
          break;
        }
      }
      await refreshCounts();
    } catch (err) {
      setResult(safeJsonMessage(err));
    } finally {
      setIsRunning(false);
    }
  }

  function stop() {
    stopRef.current = true;
  }

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
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runPullPaged} disabled={isRunning || !types.length}>
                  {isRunning ? "Puxando..." : "Puxar do Bubble"}
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
