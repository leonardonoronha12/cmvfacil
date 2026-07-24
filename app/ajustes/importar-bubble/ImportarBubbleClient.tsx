"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fmtCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length}`;
  return "";
}

function DataTable({
  columns,
  rows,
  maxRows = 20,
}: {
  columns: Array<{ key: string; label: string; render?: (row: any) => string }>;
  rows: any[];
  maxRows?: number;
}) {
  const list = Array.isArray(rows) ? rows : [];
  const view = list.slice(0, Math.max(0, maxRows));
  return (
    <div style={{ width: "100%", overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.map((r, idx) => (
            <tr key={String(r?.id ?? idx)} style={{ borderBottom: "1px solid #f3f4f6" }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: "10px 12px", verticalAlign: "top" }}>
                  {(c.render ? c.render(r) : fmtCell((r as any)?.[c.key])) || "—"}
                </td>
              ))}
            </tr>
          ))}
          {!view.length ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: "10px 12px", color: "#6b7280" }}>
                (vazio)
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
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

type MonitorState = {
  lastUpdatedAt: string | null;
  insumos: { rows: any[]; categories: any[] } | null;
  fichas: { rows: any[] } | null;
  prePreparo: { rows: any[] } | null;
  fornecedores: { row: any | null } | null;
  entradas: { rows: any[] } | null;
  inventario: { rows: any[] } | null;
  desperdicios: { rows: any[] } | null;
  error: string | null;
};

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

  const [pastedInfo, setPastedInfo] = useState("");
  const [pasteResult, setPasteResult] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [importAsUserId, setImportAsUserId] = useState("");
  const [filterEmail, setFilterEmail] = useState("");
  const [filterBubbleUserId, setFilterBubbleUserId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterUserType, setFilterUserType] = useState("");
  const [syncStatePath, setSyncStatePath] = useState<string>("");
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncStage, setSyncStage] = useState<"idle" | "pulling" | "importing" | "done" | "error">("idle");
  const [syncWarning, setSyncWarning] = useState<string>("");
  const [syncProgress, setSyncProgress] = useState<Record<string, { status: string; fetched: number; parts: number; remaining: number | null; lastPath: string }> | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const syncStopRef = useRef(false);
  const [purgeStatus, setPurgeStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [purgeResult, setPurgeResult] = useState<string>("");

  const [monitor, setMonitor] = useState<MonitorState>({
    lastUpdatedAt: null,
    insumos: null,
    fichas: null,
    prePreparo: null,
    fornecedores: null,
    entradas: null,
    inventario: null,
    desperdicios: null,
    error: null,
  });
  const [monitorAutoRefresh, setMonitorAutoRefresh] = useState(true);
  const [monitorExpanded, setMonitorExpanded] = useState(false);

  const monitorUserParam = useMemo(() => {
    const params = new URLSearchParams();
    const u = importAsUserId.trim();
    if (u && isUuid(u)) params.set("userId", u);
    params.set("embed", "1");
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [importAsUserId]);

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
      const res = await fetch("/api/bubble-import/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const text = await res.text();
      const json = ((): Record<string, unknown> | null => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })();
      if (!res.ok || !json || (json as any).ok !== true) throw new Error((json as any)?.error || text || `failed_${res.status}`);
      setImportResult(JSON.stringify(json ?? {}, null, 2));
    } catch (err) {
      setImportResult(safeJsonMessage(err));
    } finally {
      setIsImporting(false);
    }
  }

  async function runImportComplementos() {
    if (isImporting) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/bubble-import/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ only: ["fichas_tecnicas", "pre_preparo", "inventario"], includeUnknown: true }),
      });
      const text = await res.text();
      const json = ((): Record<string, unknown> | null => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })();
      if (!res.ok || !json || (json as any).ok !== true) throw new Error((json as any)?.error || text || `failed_${res.status}`);
      setImportResult(JSON.stringify(json ?? {}, null, 2));
    } catch (err) {
      setImportResult(safeJsonMessage(err));
    } finally {
      setIsImporting(false);
    }
  }

  const hasAny = uploads.length > 0;
  const hasPending = uploads.some((u) => u.status === "pending" || u.status === "error");
  const canImport = !isUploading && !isPreparing && !hasPending;

  const syncTypes = useMemo(() => {
    return [
      "User",
      "empresas",
      "categorias",
      "custo_medio_item",
      "desperdicio",
      "motivos_desperdicios",
      "fornecedores",
      "Ingredientes",
      "inventarios",
      "itens_fornecedores",
      "itens_inventarios",
      "itens_notas",
      "item",
      "notas_fiscais",
      "pre_preparo",
      "pre_preparo_ingredientes",
      "pre_preparo_etiquetas",
      "etiquetas",
      "Itens_lista_compras",
      "itens_lista_compras",
      "qtd_compra_real",
      "fichas_tecnicas",
    ];
  }, []);

  const progressDerived = useMemo(() => {
    const types = syncTypes;
    const per = syncProgress ?? {};
    const total = types.length || 1;
    const done = types.filter((t) => String((per as any)?.[t]?.status ?? "").toLowerCase() === "done").length;
    const fetched = types.reduce((sum, t) => sum + (Number.isFinite((per as any)?.[t]?.fetched) ? Number((per as any)[t].fetched) : 0), 0);
    const remainingKnown = types.every((t) => {
      const st = String((per as any)?.[t]?.status ?? "").toLowerCase();
      if (st === "done") return true;
      return typeof (per as any)?.[t]?.remaining === "number";
    });
    const remaining = remainingKnown
      ? types.reduce((sum, t) => sum + (typeof (per as any)?.[t]?.remaining === "number" ? Number((per as any)[t].remaining) : 0), 0)
      : null;
    const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    const currentType = syncState?.types?.[syncState.currentTypeIndex] ?? null;
    return { total, done, pct, fetched, remaining, currentType };
  }, [syncProgress, syncState?.currentTypeIndex, syncState?.types, syncTypes]);

  async function purgeUserData() {
    const target = importAsUserId.trim();
    if (!target) {
      setPurgeStatus("error");
      setPurgeResult("Preencha o Usuário destino (UUID) para limpar os dados.");
      return;
    }
    const typed = window.prompt(`AÇÃO IRREVERSÍVEL.\n\nIsso vai deletar TODOS os dados desse usuário no sistema.\n\nPara confirmar, digite exatamente:\nPURGE:${target}`);
    if (typed !== `PURGE:${target}`) return;
    setPurgeStatus("running");
    setPurgeResult("");
    try {
      const res = await fetch("/api/admin/purge-user-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: target, confirm: `PURGE:${target}` }),
      });
      const text = await res.text().catch(() => "");
      const json = ((): any => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })();
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? text ?? `failed_${res.status}`));
      setPurgeStatus("done");
      setPurgeResult(JSON.stringify(json?.results ?? json, null, 2));
      void refreshMonitor();
    } catch (err) {
      setPurgeStatus("error");
      setPurgeResult(safeJsonMessage(err));
    }
  }

  async function startServerSync() {
    const res = await fetch("/api/bubble-import/sync/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ types: syncTypes }),
    });
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
      body: JSON.stringify({
        statePath,
        baseUrl,
        token,
        maxOps: 12,
        resume: true,
        importAsUserId,
        filterEmail: filterEmail.trim() || undefined,
        filterBubbleUserId: filterBubbleUserId.trim() || undefined,
        filterCompanyId: filterCompanyId.trim() || undefined,
        filterUserType: filterUserType.trim() || undefined,
      }),
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

  async function runSync() {
    if (syncRunning) return;
    setSyncRunning(true);
    setSyncStage("pulling");
    setSyncWarning("");
    setSyncProgress(null);
    syncStopRef.current = false;
    try {
      let statePath = syncStatePath;
      if (!statePath) {
        const started = await startServerSync();
        statePath = started.statePath;
      }
      let consecutiveErrors = 0;
      for (let i = 0; i < 2000000; i++) {
        if (syncStopRef.current) break;
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
        setSyncProgress(
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
        if (st.phase === "importing") setSyncStage("importing");
        if (st.phase === "done") {
          setSyncStage("done");
          break;
        }
        if (st.phase === "error") {
          setSyncStage("error");
          break;
        }
        await sleep(400);
      }
    } catch (err) {
      setSyncWarning(safeJsonMessage(err));
      setSyncStage("error");
    } finally {
      setSyncRunning(false);
    }
  }

  function stopSync() {
    syncStopRef.current = true;
  }

  function parsePasted() {
    const text = String(pastedInfo ?? "");
    const lower = text.toLowerCase();
    const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? "";
    const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() ?? "";
    const bubbleIds = Array.from(text.matchAll(/\b\d{8,}x\d{6,}\b/gi)).map((m) => ({ id: m[0] ?? "", index: typeof m.index === "number" ? m.index : -1 }));
    let bubbleUserId = "";
    let companyId = "";
    for (const m of bubbleIds) {
      if (!m.id) continue;
      const idx = Math.max(0, m.index);
      const ctx = lower.slice(Math.max(0, idx - 40), Math.min(lower.length, idx + m.id.length + 40));
      if (!bubbleUserId && (ctx.includes("created by") || ctx.includes("usuário") || ctx.includes("usuario") || ctx.includes("user"))) bubbleUserId = m.id;
      if (!companyId && (ctx.includes("empresa") || ctx.includes("restaurante") || ctx.includes("company") || ctx.includes("unidade"))) companyId = m.id;
    }
    const baseUrlCandidate = (() => {
      const u = text.match(/https?:\/\/[^\s]+/i)?.[0] ?? "";
      if (!u) return "";
      return u.replace(/\/+$/g, "").replace(/\/api\/1\.1\/obj.*$/i, "").replace(/\/api\/1\.1.*$/i, "");
    })();
    const parts: string[] = [];
    if (uuid) parts.push(`userId: ${uuid}`);
    if (email) parts.push(`email: ${email}`);
    if (bubbleUserId) parts.push(`bubbleUserId: ${bubbleUserId}`);
    if (companyId) parts.push(`empresaId: ${companyId}`);
    if (!bubbleUserId && bubbleIds.length) parts.push(`bubbleIds: ${bubbleIds.slice(0, 3).map((x) => x.id).join(", ")}${bubbleIds.length > 3 ? "…" : ""}`);
    if (baseUrlCandidate) parts.push(`baseUrl: ${baseUrlCandidate}`);
    setPasteResult(parts.length ? parts.join(" • ") : "Não consegui detectar IDs/email nesse texto.");
    if (uuid) setImportAsUserId(uuid);
    if (email) setFilterEmail(email);
    if (bubbleUserId) setFilterBubbleUserId(bubbleUserId);
    if (companyId) setFilterCompanyId(companyId);
    if (baseUrlCandidate && !baseUrl.trim()) setBaseUrl(baseUrlCandidate);
  }

  async function runAllFromPaste() {
    if (!pastedInfo.trim()) return;
    if (syncRunning) return;
    parsePasted();
    await sleep(50);
    await runSync();
  }

  async function refreshMonitor() {
    const fetchJson = async (url: string) => {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String((json as any)?.error ?? `failed_${res.status}`));
      return json;
    };

    try {
      const ts = Date.now();
      const targetUserId = importAsUserId.trim();
      const userParam = targetUserId && isUuid(targetUserId) ? `&userId=${encodeURIComponent(targetUserId)}` : "";
      const [insumos, fichas, prePreparo, fornecedores, entradas, inventario, desperdicios] = await Promise.all([
        fetchJson(`/api/insumos?ts=${ts}${userParam}`),
        fetchJson(`/api/fichas-tecnicas?ts=${ts}${userParam}`),
        fetchJson(`/api/pre-preparo?ts=${ts}${userParam}`),
        fetchJson(`/api/fornecedores?ts=${ts}${userParam}`),
        fetchJson(`/api/entradas?ts=${ts}${userParam}`),
        fetchJson(`/api/inventario?ts=${ts}${userParam}`),
        fetchJson(`/api/desperdicios?ts=${ts}${userParam}`),
      ]);
      setMonitor({
        lastUpdatedAt: new Date().toLocaleString(),
        insumos: insumos && typeof insumos === "object" ? (insumos as any) : null,
        fichas: fichas && typeof fichas === "object" ? (fichas as any) : null,
        prePreparo: prePreparo && typeof prePreparo === "object" ? (prePreparo as any) : null,
        fornecedores: fornecedores && typeof fornecedores === "object" ? (fornecedores as any) : null,
        entradas: entradas && typeof entradas === "object" ? (entradas as any) : null,
        inventario: inventario && typeof inventario === "object" ? (inventario as any) : null,
        desperdicios: desperdicios && typeof desperdicios === "object" ? (desperdicios as any) : null,
        error: null,
      });
    } catch (err) {
      setMonitor((prev) => ({ ...prev, error: safeJsonMessage(err), lastUpdatedAt: new Date().toLocaleString() }));
    }
  }

  useEffect(() => {
    if (!monitorAutoRefresh) return;
    if (!monitorExpanded && !syncRunning) return;
    void refreshMonitor();
    const t = window.setInterval(() => void refreshMonitor(), 2500);
    return () => window.clearInterval(t);
  }, [monitorAutoRefresh, monitorExpanded, syncRunning]);

  return (
    <>
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
                <span className={styles.noticeStrong}>Via API:</span> cole email/IDs do usuário e rode a sincronização + importação automática.
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileName}>Colar dados (Bubble + sistema)</div>
                    <div className={styles.fileMeta}>Cole tudo que tiver: email, userId do sistema, bubbleId, links…</div>
                    <textarea
                      value={pastedInfo}
                      onChange={(e) => setPastedInfo(e.currentTarget.value)}
                      placeholder="Cole aqui o texto (IDs, email, URLs, etc)."
                      className={styles.input}
                      rows={7}
                      disabled={syncRunning}
                    />
                    <div className={styles.actions}>
                      <button type="button" className={styles.btn} onClick={parsePasted} disabled={syncRunning || !pastedInfo.trim()}>
                        Extrair campos
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runAllFromPaste} disabled={syncRunning || !pastedInfo.trim()}>
                        {syncRunning ? (syncStage === "importing" ? "Organizando..." : "Puxando...") : "Executar tudo"}
                      </button>
                      <button type="button" className={styles.btn} onClick={stopSync} disabled={!syncRunning}>
                        Parar
                      </button>
                    </div>
                    {pasteResult ? <div className={styles.fileMeta}>{pasteResult}</div> : null}
                    {syncWarning ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>Conexão instável: {syncWarning}</div> : null}
                    {syncRunning || syncProgress ? (
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className={styles.fileMeta}>
                          Progresso: {progressDerived.pct}% • {progressDerived.done}/{progressDerived.total} tipos • {syncStage}
                          {progressDerived.currentType ? ` • atual: ${progressDerived.currentType}` : ""}
                          {Number.isFinite(progressDerived.fetched) && progressDerived.fetched > 0 ? ` • baixados: ${progressDerived.fetched}` : ""}
                          {typeof progressDerived.remaining === "number" ? ` • faltando: ${progressDerived.remaining}` : ""}
                        </div>
                        <div style={{ width: "100%", height: 10, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${progressDerived.pct}%`,
                              height: "100%",
                              background: syncStage === "error" ? "#ef4444" : syncStage === "done" ? "#22c55e" : "#16a34a",
                              transition: "width 200ms ease",
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Email (para filtrar no Bubble)</div>
                      <input value={filterEmail} onChange={(e) => setFilterEmail(e.currentTarget.value)} placeholder="ex: usuario@dominio.com" className={styles.input} disabled={syncRunning} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Bubble userId (Created By)</div>
                      <input
                        value={filterBubbleUserId}
                        onChange={(e) => setFilterBubbleUserId(e.currentTarget.value)}
                        placeholder="ex: 1690000000000x000000000000000000"
                        className={styles.input}
                        disabled={syncRunning}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Empresa/Restaurante (Bubble)</div>
                      <input
                        value={filterCompanyId}
                        onChange={(e) => setFilterCompanyId(e.currentTarget.value)}
                        placeholder="opcional (empresa_id/restaurante_id)"
                        className={styles.input}
                        disabled={syncRunning}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Tipo do usuário no Bubble</div>
                      <input value={filterUserType} onChange={(e) => setFilterUserType(e.currentTarget.value)} placeholder="ex: User" className={styles.input} disabled={syncRunning} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>BUBBLE_BASE_URL (opcional)</div>
                      <input value={baseUrl} onChange={(e) => setBaseUrl(e.currentTarget.value)} placeholder="ex: https://api.app.cmvfacil.com" className={styles.input} disabled={syncRunning} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>BUBBLE_API_TOKEN (opcional)</div>
                      <input type="password" value={token} onChange={(e) => setToken(e.currentTarget.value)} placeholder="cole o token" className={styles.input} disabled={syncRunning} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
                      <div className={styles.fileMeta}>Usuário destino (Supabase UUID)</div>
                      <input
                        value={importAsUserId}
                        onChange={(e) => setImportAsUserId(e.currentTarget.value)}
                        placeholder="UUID do usuário (ex.: 00000000-0000-0000-0000-000000000000)"
                        className={styles.input}
                        disabled={syncRunning}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className={styles.fileName}>Limpar dados do usuário</div>
                    <div className={styles.fileMeta}>Isso deleta do sistema os dados desse usuário (antes de importar). Ação irreversível.</div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => void purgeUserData()}
                        disabled={syncRunning || purgeStatus === "running" || !importAsUserId.trim()}
                      >
                        {purgeStatus === "running" ? "Deletando..." : "Deletar tudo do usuário"}
                      </button>
                    </div>
                    {purgeResult ? <div className={styles.pathsBox}>{purgeResult}</div> : null}
                  </div>
                </div>
              </div>

              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div className={styles.fileName}>Painel (ver cadastrando)</div>
                      <div className={styles.fileMeta}>{monitor.lastUpdatedAt ? `atualizado: ${monitor.lastUpdatedAt}` : "—"}</div>
                      {monitor.error ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>erro: {monitor.error}</div> : null}
                      <div style={{ flex: 1 }} />
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, color: "#111827" }}>
                        <input type="checkbox" checked={monitorAutoRefresh} onChange={(e) => setMonitorAutoRefresh(e.target.checked)} />
                        Auto-atualizar
                      </label>
                      <button type="button" className={styles.btn} onClick={() => void refreshMonitor()}>
                        Atualizar agora
                      </button>
                      <button type="button" className={styles.btn} onClick={() => setMonitorExpanded((v) => !v)}>
                        {monitorExpanded ? "Recolher" : "Expandir"}
                      </button>
                    </div>

                    {monitorExpanded ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>CMV REAL</summary>
                          <div style={{ marginTop: 8 }}>
                            <iframe src={`/dashboard${monitorUserParam}`} style={{ width: "100%", height: 420, border: "1px solid #e5e7eb", borderRadius: 10 }} />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>LISTA DE COMPRAS</summary>
                          <div style={{ marginTop: 8 }}>
                            <iframe src={`/lista-de-compras${monitorUserParam}`} style={{ width: "100%", height: 420, border: "1px solid #e5e7eb", borderRadius: 10 }} />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>INSUMOS ({(monitor.insumos?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.insumos?.rows ?? []}
                              maxRows={25}
                              columns={[
                                { key: "item", label: "Item" },
                                { key: "categoria", label: "Categoria" },
                                { key: "medida", label: "Medida" },
                                { key: "custoMedio", label: "Custo médio" },
                                { key: "especificacao", label: "Especificação" },
                                { key: "ocultar", label: "Ocultar" },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>FICHAS TÉCNICAS ({(monitor.fichas?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.fichas?.rows ?? []}
                              maxRows={20}
                              columns={[
                                { key: "nome", label: "Nome" },
                                { key: "categoria", label: "Categoria" },
                                { key: "unidade", label: "Unidade" },
                                { key: "rendimento", label: "Rendimento" },
                                { key: "custo", label: "Custo" },
                                {
                                  key: "ingredientes",
                                  label: "Ingredientes",
                                  render: (r) => (Array.isArray(r?.ingredientes) ? String(r.ingredientes.length) : ""),
                                },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>PRÉ-PREPARO ({(monitor.prePreparo?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.prePreparo?.rows ?? []}
                              maxRows={20}
                              columns={[
                                { key: "nome", label: "Nome" },
                                { key: "categoria", label: "Categoria" },
                                { key: "unidade", label: "Unidade" },
                                { key: "rendimento", label: "Rendimento" },
                                {
                                  key: "ingredientes",
                                  label: "Ingredientes",
                                  render: (r) => (Array.isArray(r?.ingredientes) ? String(r.ingredientes.length) : ""),
                                },
                                {
                                  key: "preparo",
                                  label: "Preparo",
                                  render: (r) => (String(r?.preparo ?? "").trim() ? "ok" : ""),
                                },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>FORNECEDORES</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={
                                (() => {
                                  const row = monitor.fornecedores?.row ?? null;
                                  const info = row && typeof row === "object" ? (row as any).info : null;
                                  const list = info && typeof info === "object" ? Object.values(info as any) : [];
                                  return list;
                                })()
                              }
                              maxRows={25}
                              columns={[
                                { key: "fornecedor", label: "Fornecedor" },
                                { key: "vendedor", label: "Vendedor" },
                                { key: "whatsapp", label: "WhatsApp" },
                                { key: "endereco", label: "Endereço" },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>ENTRADAS ({(monitor.entradas?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.entradas?.rows ?? []}
                              maxRows={20}
                              columns={[
                                { key: "numero", label: "Número" },
                                { key: "data_lancamento", label: "Data" },
                                { key: "fornecedor", label: "Fornecedor" },
                                { key: "valor_nota", label: "Valor" },
                                {
                                  key: "itens_nota",
                                  label: "Itens",
                                  render: (r) => (Array.isArray(r?.itens_nota) ? String(r.itens_nota.length) : ""),
                                },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>INVENTÁRIO ({(monitor.inventario?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.inventario?.rows ?? []}
                              maxRows={20}
                              columns={[
                                { key: "data", label: "Data" },
                                {
                                  key: "categorias",
                                  label: "Categorias",
                                  render: (r) => (Array.isArray(r?.categorias) ? String(r.categorias.length) : ""),
                                },
                                { key: "created_at", label: "Criado em" },
                              ]}
                            />
                          </div>
                        </details>
                        <details open>
                          <summary style={{ fontWeight: 900, cursor: "pointer" }}>DESPERDÍCIO ({(monitor.desperdicios?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                          <div style={{ marginTop: 8 }}>
                            <DataTable
                              rows={monitor.desperdicios?.rows ?? []}
                              maxRows={20}
                              columns={[
                                { key: "data", label: "Data" },
                                { key: "item", label: "Item" },
                                { key: "quantidade", label: "Qtd" },
                                { key: "custo", label: "Custo" },
                                { key: "motivo", label: "Motivo" },
                              ]}
                            />
                          </div>
                        </details>
                      </div>
                    ) : (
                      <div className={styles.pathsBox}>
                        {JSON.stringify(
                          {
                            cmvReal: "dashboard",
                            listaDeCompras: "iframe",
                            insumos: (monitor.insumos?.rows ?? []).length,
                            fichasTecnicas: (monitor.fichas?.rows ?? []).length,
                            prePreparo: (monitor.prePreparo?.rows ?? []).length,
                            fornecedores: monitor.fornecedores?.row ? "ok" : "—",
                            entradas: (monitor.entradas?.rows ?? []).length,
                            inventario: (monitor.inventario?.rows ?? []).length,
                            desperdicio: (monitor.desperdicios?.rows ?? []).length,
                          },
                          null,
                          2,
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

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

              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={analyzeServerFiles} disabled={isAnalyzing}>
                  {isAnalyzing ? "Analisando..." : "Ver arquivos no servidor"}
                </button>
                <button type="button" className={styles.btn} onClick={runImportComplementos} disabled={!canImport || isImporting}>
                  {isImporting ? "Importando..." : "Importar complementos"}
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runImport} disabled={!canImport || isImporting}>
                  {isImporting ? "Importando..." : "Importar tudo"}
                </button>
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
    </>
  );
}
