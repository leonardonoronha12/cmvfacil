"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type QaFetchEntry = {
  ts: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  requestBody?: unknown;
  responseJson?: unknown;
};

export type QaReport = {
  ts: string;
  screen: string;
  href: string;
  fetchLog: QaFetchEntry[];
  dom?: {
    tables: Array<{
      name: string;
      headers: string[];
      rows: Array<{ id: string; cells: string[] }>;
    }>;
    grids: Array<{
      name: string;
      rows: Array<{ id: string; cells: string[]; text: string }>;
    }>;
  };
  ui?: unknown;
};

function nowIso() {
  return new Date().toISOString();
}

function isLikelySecretKey(k: string) {
  const key = k.toLowerCase();
  return (
    key.includes("password") ||
    key.includes("access_token") ||
    key.includes("refresh_token") ||
    (key.includes("token") && !key.includes("token_hash")) ||
    key.includes("authorization") ||
    key.includes("cookie") ||
    key.includes("api_key") ||
    key.includes("apikey")
  );
}

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 4000) return value.slice(0, 4000) + "…";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactSecrets(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (isLikelySecretKey(k)) out[k] = "[redacted]";
      else out[k] = redactSecrets(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function safeString(x: unknown) {
  const s = String(x ?? "").trim();
  if (s.length > 2000) return s.slice(0, 2000) + "…";
  return s;
}

export function isQaMode() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const v = String(params.get("qa") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on" || params.has("qa");
}

function getGlobalLog(): QaFetchEntry[] {
  if (typeof window === "undefined") return [];
  const w = window as any;
  if (!Array.isArray(w.__CMV_QA_FETCH_LOG__)) w.__CMV_QA_FETCH_LOG__ = [];
  return w.__CMV_QA_FETCH_LOG__;
}

export function installQaFetchLogger() {
  if (typeof window === "undefined") return;
  if (!isQaMode()) return;
  const w = window as any;
  if (w.__CMV_QA_FETCH_PATCHED__) return;
  w.__CMV_QA_FETCH_PATCHED__ = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = safeString(init?.method || "GET").toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : safeString((input as any)?.url ?? "");

    let requestBody: unknown = undefined;
    const bodyRaw = (init as any)?.body;
    if (typeof bodyRaw === "string") {
      try {
        requestBody = JSON.parse(bodyRaw);
      } catch {
        requestBody = bodyRaw.length > 4000 ? bodyRaw.slice(0, 4000) + "…" : bodyRaw;
      }
    }

    const res = await origFetch(input, init);
    const shouldLog = url.startsWith("/api/") || url.includes(`${window.location.origin}/api/`);
    if (!shouldLog) return res;

    const clone = res.clone();
    let responseJson: unknown = undefined;
    const ct = safeString(clone.headers.get("content-type") ?? "");
    if (ct.includes("application/json")) {
      try {
        responseJson = await clone.json();
      } catch {
        responseJson = undefined;
      }
    }

    const entry: QaFetchEntry = {
      ts: nowIso(),
      method,
      url,
      status: clone.status,
      ok: clone.ok,
      requestBody: requestBody != null ? redactSecrets(requestBody) : undefined,
      responseJson: responseJson != null ? redactSecrets(responseJson) : undefined,
    };
    getGlobalLog().push(entry);
    if (getGlobalLog().length > 300) getGlobalLog().splice(0, getGlobalLog().length - 300);
    return res;
  };
}

function collectTablesFromDom(): QaReport["dom"] {
  if (typeof document === "undefined") return { tables: [], grids: [] };
  const tables = Array.from(document.querySelectorAll("table[data-qa-table]"));
  const grids = Array.from(document.querySelectorAll("[data-qa-grid]"));
  const out: QaReport["dom"] = { tables: [], grids: [] };
  for (const t of tables) {
    const name = safeString((t as any)?.dataset?.qaTable ?? "table");
    const headerCells = Array.from(t.querySelectorAll("thead th"));
    const headers = headerCells.map((th) => safeString(th.textContent ?? ""));
    const bodyRows = Array.from(t.querySelectorAll("tbody tr"));
    const rows = bodyRows.slice(0, 500).map((tr) => {
      const id = safeString((tr as any)?.dataset?.qaRowId ?? "");
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => safeString(td.textContent ?? ""));
      return { id, cells };
    });
    out.tables.push({ name, headers, rows });
  }
  for (const g of grids) {
    const name = safeString((g as any)?.dataset?.qaGrid ?? "grid");
    const bodyRows = Array.from(g.querySelectorAll("[data-qa-grid-row]"));
    const rows = bodyRows.slice(0, 800).map((row) => {
      const id = safeString((row as any)?.dataset?.qaRowId ?? "");
      const cellEls = Array.from(row.querySelectorAll("[data-qa-grid-cell]"));
      const cells = cellEls.length ? cellEls.map((c) => safeString(c.textContent ?? "")) : [];
      const text = safeString(row.textContent ?? "");
      return { id, cells, text };
    });
    out.grids.push({ name, rows });
  }
  return out;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function QaModePanel(props: { screen: string; ui?: unknown }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    installQaFetchLogger();
  }, []);

  const enabled = isQaMode();
  const report = useMemo<QaReport | null>(() => {
    if (!enabled) return null;
    const href = typeof window !== "undefined" ? window.location.href : "";
    const fetchLog = getGlobalLog().slice(-200);
    return {
      ts: nowIso(),
      screen: props.screen,
      href,
      fetchLog,
      dom: collectTablesFromDom(),
      ui: props.ui != null ? redactSecrets(props.ui) : undefined,
    };
  }, [enabled, props.screen, props.ui]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enabled) return;
    (window as any).__CMV_QA_LAST_REPORT__ = report;
  }, [enabled, report]);

  const doDownload = useCallback(() => {
    if (!report) return;
    const stamp = report.ts.replace(/[:.]/g, "-");
    const safeScreen = report.screen.replace(/[^a-z0-9_-]+/gi, "_");
    downloadJson(`qa_${safeScreen}_${stamp}.json`, report);
  }, [report]);

  const doCopy = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [report]);

  if (!enabled) return null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
      <button type="button" onClick={doDownload} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}>
        Baixar QA JSON
      </button>
      <button type="button" onClick={doCopy} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd" }}>
        {copied ? "Copiado" : "Copiar QA JSON"}
      </button>
    </div>
  );
}
