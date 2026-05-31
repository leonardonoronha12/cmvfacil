"use client";

import { useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import AppSidebar from "../../components/AppSidebar";
import styles from "../importar-bubble/importar-bubble.module.css";

type UploadRow = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "uploaded" | "error";
  error?: string;
  path?: string;
};

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const digits = u === 0 ? 0 : u === 1 ? 1 : 2;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[u]}`;
}

function safeJsonMessage(err: unknown) {
  if (!err) return "Erro desconhecido";
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function ImportarBubbleDumpClient() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  const hasAny = uploads.length > 0;
  const hasPending = uploads.some((u) => u.status === "pending" || u.status === "error");

  const uploadedPathsText = useMemo(() => {
    const paths = uploads.map((u) => u.path).filter(Boolean) as string[];
    return paths.join("\n");
  }, [uploads]);

  async function addFilesAsync(files: File[]) {
    const next: UploadRow[] = [];
    for (const file of files) {
      if (!file) continue;
      if (file.size <= 0) continue;
      if (file.size > MAX_UPLOAD_BYTES) {
        next.push({
          id: crypto.randomUUID(),
          file,
          status: "error",
          error: `Arquivo muito grande (${formatBytes(file.size)}). Limite por arquivo: ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        });
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, status: "pending" });
    }
    if (!next.length) return;
    setUploads((prev) => [...next, ...prev]);
  }

  async function signUpload(file: File) {
    const res = await fetch("/api/bubble-import/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "text/plain",
        size: file.size,
      }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; signedUrl?: string; token?: string; error?: string } | null;
    if (!res.ok || !json?.ok || !json.path || !json.signedUrl || !json.token) throw new Error(json?.error || "Falha ao preparar upload.");
    return { path: json.path, signedUrl: json.signedUrl };
  }

  async function uploadToSignedUrl(signedUrl: string, file: File) {
    const contentType = file.type || "text/plain";
    const res = await fetch(signedUrl, { method: "PUT", headers: { "content-type": contentType }, body: file });
    if (res.ok) return;
    const details = await res.text().catch(() => "");
    throw new Error(details.trim() || `Falha no upload (${res.status}).`);
  }

  async function startUpload() {
    if (isUploading) return;
    const pending = uploads.filter((u) => u.status === "pending" || u.status === "error");
    if (!pending.length) return;
    setIsUploading(true);
    try {
      for (const row of pending) {
        setUploads((prev) => prev.map((u) => (u.id === row.id ? { ...u, status: "uploading", error: undefined } : u)));
        try {
          const signed = await signUpload(row.file);
          await uploadToSignedUrl(signed.signedUrl, row.file);
          setUploads((prev) => prev.map((u) => (u.id === row.id ? { ...u, status: "uploaded", path: signed.path } : u)));
        } catch (err) {
          setUploads((prev) => prev.map((u) => (u.id === row.id ? { ...u, status: "error", error: safeJsonMessage(err) } : u)));
        }
      }
    } finally {
      setIsUploading(false);
    }
  }

  function clearAll() {
    setUploads([]);
    setAnalyzeResult(null);
  }

  async function copyPaths() {
    if (!uploadedPathsText) return;
    try {
      await navigator.clipboard.writeText(uploadedPathsText);
    } catch {
      window.prompt("Copie os caminhos abaixo:", uploadedPathsText);
    }
  }

  async function analyzeLatest() {
    const latest = uploads.find((u) => u.status === "uploaded" && u.path)?.path ?? "";
    if (!latest) return;
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const res = await fetch("/api/bubble-import/dump-analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: latest }) });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (!res.ok || !json || (json as any).ok !== true) throw new Error((json as any)?.error || text || `failed_${res.status}`);
      setAnalyzeResult(JSON.stringify(json, null, 2));
    } catch (err) {
      setAnalyzeResult(safeJsonMessage(err));
    } finally {
      setIsAnalyzing(false);
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
                <h1 className={styles.title}>Upload dump JSON do Bubble</h1>
                <p className={styles.sub}>Suba um arquivo .txt/.json com todas as tabelas e dados (JSON). Ele será armazenado no Supabase para análise/importação.</p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  Selecionar arquivo
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={startUpload} disabled={!hasPending || isUploading}>
                  {isUploading ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.notice}>
                <span className={styles.noticeStrong}>Formato:</span> JSON único (objeto/array) ou um .txt. Arquivos muito grandes podem não ser analisáveis no navegador, mas ficam armazenados.
              </div>

              <div
                className={isDragging ? `${styles.dropZone} ${styles.dropZoneActive}` : styles.dropZone}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const list = Array.from(e.dataTransfer.files ?? []);
                  void addFilesAsync(list.slice(0, 1));
                }}
              >
                <div className={styles.dropTitle}>Arraste e solte aqui</div>
                <div className={styles.dropHint}>ou use “Selecionar arquivo”.</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple={false}
                  accept=".txt,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const list = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = "";
                    void addFilesAsync(list.slice(0, 1));
                  }}
                />
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={clearAll} disabled={isUploading}>
                  Limpar
                </button>
                <button type="button" className={styles.btn} onClick={copyPaths} disabled={!uploadedPathsText}>
                  Copiar caminho
                </button>
                <button type="button" className={styles.btn} onClick={analyzeLatest} disabled={isAnalyzing || !uploads.some((u) => u.status === "uploaded" && u.path)}>
                  {isAnalyzing ? "Analisando..." : "Analisar arquivo"}
                </button>
              </div>

              {uploadedPathsText ? <div className={styles.pathsBox}>{uploadedPathsText}</div> : null}
              {analyzeResult ? <div className={styles.pathsBox}>{analyzeResult}</div> : null}

              {hasAny ? (
                <div className={styles.fileList}>
                  {uploads.map((u) => (
                    <div key={u.id} className={styles.fileRow}>
                      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div className={styles.fileName}>{u.file.name}</div>
                        <div className={styles.fileMeta}>{formatBytes(u.file.size)}</div>
                        {u.path ? <div className={styles.fileMeta}>{u.path}</div> : null}
                        {u.error ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{u.error}</div> : null}
                      </div>
                      <div
                        className={
                          u.status === "uploaded"
                            ? `${styles.fileStatus} ${styles.statusOk}`
                            : u.status === "error"
                              ? `${styles.fileStatus} ${styles.statusErr}`
                              : u.status === "uploading"
                                ? `${styles.fileStatus} ${styles.statusProg}`
                                : styles.fileStatus
                        }
                      >
                        {u.status === "pending" ? "Pronto" : u.status === "uploading" ? "Enviando..." : u.status === "uploaded" ? "Enviado" : "Erro"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

