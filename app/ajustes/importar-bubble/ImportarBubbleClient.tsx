"use client";

import { useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import AppSidebar from "../../components/AppSidebar";
import styles from "./importar-bubble.module.css";

type UploadRow = {
  id: string;
  file: File;
  status: "pending" | "uploading" | "uploaded" | "error";
  error?: string;
  path?: string;
};

type ServerFile = {
  path: string;
  name: string;
  size: number | null;
  kind: string;
  header: string[];
  note: string | null;
};

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;

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

function splitFilename(name: string) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base || "arquivo", ext: "" };
  return { stem: base.slice(0, dot) || "arquivo", ext: base.slice(dot) };
}

async function splitCsvFile(file: File, targetBytes = CHUNK_TARGET_BYTES) {
  const text = await file.text();
  const firstNl = text.indexOf("\n");
  if (firstNl === -1) return [file];
  const header = text.slice(0, firstNl).replace(/\r$/, "");
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(`${header}\n`).length;
  const parts: File[] = [];

  const { stem, ext } = splitFilename(file.name);
  const safeExt = ext.toLowerCase() === ".csv" ? ".csv" : ".csv";

  let lines: string[] = [];
  let bytes = headerBytes;
  let idx = firstNl + 1;
  while (idx < text.length) {
    const nextNl = text.indexOf("\n", idx);
    const end = nextNl === -1 ? text.length : nextNl;
    const rawLine = text.slice(idx, end);
    idx = nextNl === -1 ? text.length : nextNl + 1;
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    const lineBytes = encoder.encode(`${line}\n`).length;
    if (bytes + lineBytes > targetBytes && lines.length) {
      const partIndex = parts.length + 1;
      const name = `${stem}_part${String(partIndex).padStart(3, "0")}${safeExt}`;
      parts.push(new File([`${header}\n${lines.join("\n")}\n`], name, { type: file.type || "text/csv" }));
      lines = [];
      bytes = headerBytes;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length) {
    const partIndex = parts.length + 1;
    const name = `${stem}_part${String(partIndex).padStart(3, "0")}${safeExt}`;
    parts.push(new File([`${header}\n${lines.join("\n")}\n`], name, { type: file.type || "text/csv" }));
  }
  return parts.length ? parts : [file];
}

export default function ImportarBubbleClient() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [serverFiles, setServerFiles] = useState<ServerFile[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const uploadedPathsText = useMemo(() => {
    const paths = uploads.map((u) => u.path).filter(Boolean) as string[];
    return paths.join("\n");
  }, [uploads]);

  async function addFilesAsync(files: File[]) {
    setIsPreparing(true);
    const next: UploadRow[] = [];
    try {
      for (const file of files) {
        if (!file) continue;
        if (file.size <= 0) continue;
        const lower = file.name.toLowerCase();
        const isCsv = lower.endsWith(".csv");

        if (file.size > MAX_UPLOAD_BYTES && isCsv) {
          const parts = await splitCsvFile(file, CHUNK_TARGET_BYTES);
          for (const part of parts) next.push({ id: crypto.randomUUID(), file: part, status: "pending" });
          continue;
        }

        if (file.size > MAX_UPLOAD_BYTES) {
          next.push({
            id: crypto.randomUUID(),
            file,
            status: "error",
            error: `Arquivo muito grande (${formatBytes(file.size)}). Limite por arquivo: ${formatBytes(MAX_UPLOAD_BYTES)}. Exporte em partes menores.`,
          });
          continue;
        }

        next.push({ id: crypto.randomUUID(), file, status: "pending" });
      }
    } finally {
      setIsPreparing(false);
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
        contentType: file.type || "application/octet-stream",
        size: file.size,
      }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; signedUrl?: string; token?: string; error?: string } | null;
    if (!res.ok || !json?.ok || !json.path || !json.signedUrl || !json.token) {
      throw new Error(json?.error || "Falha ao preparar upload.");
    }
    return { path: json.path, signedUrl: json.signedUrl, token: json.token };
  }

  async function uploadToSignedUrl(signedUrl: string, file: File) {
    const contentType = file.type || "application/octet-stream";
    const res = await fetch(signedUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: file,
    });
    if (res.ok) return;
    const details = await res.text().catch(() => "");
    throw new Error(details.trim() || `Falha no upload (${res.status}).`);
  }

  async function startUpload() {
    if (isUploading || isPreparing) return;
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

  async function copyPaths() {
    if (!uploadedPathsText) return;
    try {
      await navigator.clipboard.writeText(uploadedPathsText);
    } catch {
      window.prompt("Copie os caminhos abaixo:", uploadedPathsText);
    }
  }

  function clearAll() {
    setUploads([]);
  }

  async function analyzeServerFiles() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setServerError(null);
    try {
      const res = await fetch("/api/bubble-import/analyze", { method: "GET" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; files?: ServerFile[]; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setServerFiles(json.files ?? []);
    } catch (err) {
      setServerError(safeJsonMessage(err));
      setServerFiles(null);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function copyServerPaths() {
    const paths = (serverFiles ?? []).map((f) => f.path).filter(Boolean);
    if (!paths.length) return;
    const text = paths.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copie os caminhos abaixo:", text);
    }
  }

  async function runImport() {
    if (isImporting) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/bubble-import/import", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; summary?: Record<string, unknown> } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setImportResult(JSON.stringify(json.summary ?? {}, null, 2));
    } catch (err) {
      setImportResult(safeJsonMessage(err));
    } finally {
      setIsImporting(false);
    }
  }

  const hasAny = uploads.length > 0;
  const hasPending = uploads.some((u) => u.status === "pending" || u.status === "error");

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div>
                <h1 className={styles.title}>Importar dados do Bubble</h1>
                <p className={styles.sub}>Envie aqui os arquivos exportados do Bubble (CSV/XLSX/JSON). Eles serão armazenados no Supabase para a migração.</p>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={() => fileInputRef.current?.click()} disabled={isUploading || isPreparing}>
                  Selecionar arquivos
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={startUpload} disabled={!hasPending || isUploading || isPreparing}>
                  {isPreparing ? "Preparando..." : "Enviar"}
                </button>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.notice}>
                <span className={styles.noticeStrong}>Importante:</span> existe um limite de tamanho por arquivo. CSVs grandes serão divididos automaticamente em partes menores.
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
                  void addFilesAsync(list);
                }}
              >
                <div className={styles.dropTitle}>Arraste e solte aqui</div>
                <div className={styles.dropHint}>ou use “Selecionar arquivos”.</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls,.json,.zip"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const list = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = "";
                    void addFilesAsync(list);
                  }}
                />
              </div>

              {hasAny ? (
                <>
                  <div className={styles.actions}>
                    <button type="button" className={styles.btn} onClick={clearAll} disabled={isUploading || isPreparing}>
                      Limpar lista
                    </button>
                    <button type="button" className={styles.btn} onClick={copyPaths} disabled={!uploadedPathsText}>
                      Copiar caminhos enviados
                    </button>
                    <button type="button" className={styles.btn} onClick={analyzeServerFiles} disabled={isAnalyzing}>
                      {isAnalyzing ? "Analisando..." : "Ver arquivos no servidor"}
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runImport} disabled={isImporting}>
                      {isImporting ? "Importando..." : "Importar para o sistema"}
                    </button>
                  </div>

                  {uploadedPathsText ? <div className={styles.pathsBox}>{uploadedPathsText}</div> : null}

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
                </>
              ) : null}

              {serverError ? <div className={styles.pathsBox}>{serverError}</div> : null}
              {importResult ? <div className={styles.pathsBox}>{importResult}</div> : null}

              {serverFiles?.length ? (
                <>
                  <div className={styles.actions}>
                    <button type="button" className={styles.btn} onClick={copyServerPaths}>
                      Copiar caminhos do servidor
                    </button>
                  </div>
                  <div className={styles.fileList}>
                    {serverFiles.map((f) => (
                      <div key={f.path} className={styles.fileRow}>
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <div className={styles.fileName}>{f.name}</div>
                          <div className={styles.fileMeta}>
                            {f.kind}
                            {typeof f.size === "number" ? ` • ${formatBytes(f.size)}` : ""}
                          </div>
                          {f.header?.length ? <div className={styles.fileMeta}>{f.header.join(" | ")}</div> : null}
                          {f.note ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{f.note}</div> : null}
                          <div className={styles.fileMeta}>{f.path}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
