"use client";

import { useMemo, useState } from "react";
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
  const [typesText, setTypesText] = useState("items\nfornecedores\nnotas-fiscais\nitens-notas\ndesperdicios\netiquetas\ncategorias");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string>("");

  const types = useMemo(() => {
    return typesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [typesText]);

  async function runPull() {
    if (isRunning) return;
    setIsRunning(true);
    setResult("");
    try {
      const res = await fetch("/api/bubble-import/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, token, types }),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (!res.ok || !json || (json as any).ok !== true) throw new Error((json as any)?.error || text || `failed_${res.status}`);
      setResult(JSON.stringify(json, null, 2));
    } catch (err) {
      setResult(safeJsonMessage(err));
    } finally {
      setIsRunning(false);
    }
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
                <p className={styles.sub}>Puxa os dados direto da Data API do Bubble e salva como JSON no Storage para você importar no sistema.</p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runPull} disabled={isRunning || !types.length}>
                  {isRunning ? "Puxando..." : "Puxar do Bubble"}
                </button>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.notice}>
                <span className={styles.noticeStrong}>Dica:</span> depois de puxar, vá em /ajustes/importar-bubble e clique em “Importar tudo”.
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
