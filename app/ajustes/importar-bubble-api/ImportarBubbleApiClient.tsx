"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import styles from "../importar-bubble/importar-bubble.module.css";

function safeJsonMessage(err: unknown) {
  if (!err) return "Erro desconhecido";
  if (err instanceof Error) return err.message;
  return String(err);
}

function parseBubbleAuthError(msg: string) {
  const raw = String(msg ?? "").trim();
  const lower = raw.toLowerCase();
  const looksUnauthorized = lower.includes("unauthorized");
  const looksToken = lower.includes("token") && (lower.includes("invalid") || lower.includes("expired") || lower.includes("expir"));
  if (looksUnauthorized && looksToken) return { kind: "token" as const, raw };
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const obj = JSON.parse(raw) as any;
      const errorClass = String(obj?.error_class ?? "").trim().toLowerCase();
      const translation = String(obj?.translation ?? "").trim().toLowerCase();
      const message = String(obj?.message ?? "").trim().toLowerCase();
      const args = obj?.args ? JSON.stringify(obj.args) : "";
      const m = [errorClass, translation, message, args].join(" ");
      if (m.includes("unauthorized") && m.includes("token") && (m.includes("invalid") || m.includes("expired") || m.includes("expir"))) {
        return { kind: "token" as const, raw };
      }
    } catch {}
  }
  return null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

type DeletedPreview = {
  at: string;
  before: {
    insumos: any[];
    fornecedores: any[];
    entradas: any[];
    inventario: any[];
    desperdicios: any[];
    fichas: any[];
    prePreparo: any[];
  };
  after: {
    insumos: any[];
    fornecedores: any[];
    entradas: any[];
    inventario: any[];
    desperdicios: any[];
    fichas: any[];
    prePreparo: any[];
  };
  deleted: {
    insumos: any[];
    fornecedores: any[];
    entradas: any[];
    inventario: any[];
    desperdicios: any[];
    fichas: any[];
    prePreparo: any[];
  };
};

export type ImportarBubbleApiPanelApi = {
  setPastedInfo: (value: string) => void;
  runAllFromPaste: () => Promise<void>;
  resetServerSync: () => void;
};

export function ImportarBubbleApiPanel(props?: { compact?: boolean; onApi?: (api: ImportarBubbleApiPanelApi) => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [useOverrideCreds, setUseOverrideCreds] = useState(false);
  const [importAsUserId, setImportAsUserId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetResolved, setTargetResolved] = useState<null | { userId: string; email: string; companyId: string; companyName: string | null }>(null);
  const [targetResolveError, setTargetResolveError] = useState("");
  const [isResolvingTarget, setIsResolvingTarget] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wipeError, setWipeError] = useState("");
  const [wipeResult, setWipeResult] = useState<any>(null);
  const [isWiping, setIsWiping] = useState(false);
  const [deletedPreview, setDeletedPreview] = useState<DeletedPreview | null>(null);
  const [pastedInfo, setPastedInfo] = useState("");
  const [filterEmail, setFilterEmail] = useState("");
  const [filterBubbleUserId, setFilterBubbleUserId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterUserType, setFilterUserType] = useState("");
  const [pasteResult, setPasteResult] = useState("");
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
  const [reimportingEntradas, setReimportingEntradas] = useState(false);
  const [reimportEntradasResult, setReimportEntradasResult] = useState("");
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

  useEffect(() => {
    void refreshCounts();
    void refreshGlobalTotals();
    void refreshUserProgress();
    void refreshVersionInfo();
  }, []);

  useEffect(() => {
    try {
      const savedOverride = (window.localStorage.getItem("cmvfacil:bubbleUseOverrideCreds") ?? "").trim().toLowerCase();
      if (savedOverride === "1" || savedOverride === "true" || savedOverride === "yes" || savedOverride === "on") {
        setUseOverrideCreds(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("cmvfacil:bubbleUseOverrideCreds", useOverrideCreds ? "1" : "0");
    } catch {}
  }, [useOverrideCreds]);

  useEffect(() => {
    if (!useOverrideCreds) return;
    try {
      const savedBaseUrl = (window.localStorage.getItem("cmvfacil:bubbleBaseUrl") ?? "").trim();
      const savedToken = (window.localStorage.getItem("cmvfacil:bubbleToken") ?? "").trim();
      if (savedBaseUrl && !baseUrl) setBaseUrl(savedBaseUrl);
      if (savedToken && !token) setToken(savedToken);
    } catch {}
  }, [useOverrideCreds]);

  useEffect(() => {
    if (!useOverrideCreds) return;
    try {
      if (baseUrl) window.localStorage.setItem("cmvfacil:bubbleBaseUrl", baseUrl);
    } catch {}
  }, [baseUrl, useOverrideCreds]);

  useEffect(() => {
    if (!useOverrideCreds) return;
    try {
      if (token) window.localStorage.setItem("cmvfacil:bubbleToken", token);
    } catch {}
  }, [token, useOverrideCreds]);

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
      const sourceParam = `&source=legacy`;
      const [insumos, fichas, prePreparo, fornecedores, entradas, inventario, desperdicios] = await Promise.all([
        fetchJson(`/api/insumos?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/fichas-tecnicas?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/pre-preparo?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/fornecedores?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/entradas?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/inventario?ts=${ts}${userParam}${sourceParam}`),
        fetchJson(`/api/desperdicios?ts=${ts}${userParam}${sourceParam}`),
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
    if (!isRunning) return;
    void refreshMonitor();
    const t = window.setInterval(() => {
      void refreshMonitor();
    }, 2500);
    return () => window.clearInterval(t);
  }, [isRunning, monitorAutoRefresh]);

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

  async function resolveTargetByEmail(emailArg?: string, opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setTargetResolveError("");
      setTargetResolved(null);
    } else {
      setTargetResolveError("");
    }
    const em = String(emailArg ?? targetEmail)
      .trim()
      .toLowerCase();
    if (!em || !em.includes("@")) {
      if (!silent) setTargetResolveError("Email inválido.");
      return;
    }
    setIsResolvingTarget(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        setTargetResolveError(String(json?.error ?? "Falha ao resolver usuário por email."));
        return;
      }
      const u = (json as any).user ?? null;
      const userId = String(u?.userId ?? "").trim();
      const email = String(u?.email ?? "").trim().toLowerCase();
      const companyId = String(u?.companyId ?? "").trim();
      const companyName = u?.companyName != null ? String(u.companyName) : null;
      if (!userId || !isUuid(userId)) {
        setTargetResolveError("userId inválido no retorno.");
        return;
      }
      setTargetResolved({ userId, email, companyId, companyName });
      setImportAsUserId(userId);
      if (email) setFilterEmail(email);
    } finally {
      setIsResolvingTarget(false);
    }
  }

  const autoResolveRef = useRef<{ t: any; lastEmail: string; seq: number }>({ t: null, lastEmail: "", seq: 0 });
  useEffect(() => {
    const em = targetEmail.trim().toLowerCase();
    if (!em) {
      setTargetResolveError("");
      setTargetResolved(null);
      setImportAsUserId("");
      setFilterEmail("");
      autoResolveRef.current.lastEmail = "";
      return;
    }
    if (!em.includes("@")) return;
    if (isResolvingTarget) return;
    if (targetResolved?.email && targetResolved.email === em && isUuid(importAsUserId.trim())) return;

    if (autoResolveRef.current.t) window.clearTimeout(autoResolveRef.current.t);
    autoResolveRef.current.seq += 1;
    const seq = autoResolveRef.current.seq;
    autoResolveRef.current.t = window.setTimeout(() => {
      if (autoResolveRef.current.lastEmail === em) return;
      autoResolveRef.current.lastEmail = em;
      void (async () => {
        if (seq !== autoResolveRef.current.seq) return;
        await resolveTargetByEmail(em, { silent: true });
      })();
    }, 450);
    return () => {
      if (autoResolveRef.current.t) window.clearTimeout(autoResolveRef.current.t);
    };
  }, [targetEmail, isResolvingTarget, targetResolved?.email, importAsUserId]);

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
    const shouldSendOverride = useOverrideCreds && Boolean(baseUrl.trim() || token.trim());
    const res = await fetch("/api/bubble-import/sync/tick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        statePath,
        baseUrl: shouldSendOverride ? baseUrl : undefined,
        token: shouldSendOverride ? token : undefined,
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

  async function reimportEntradasFromBubble() {
    if (reimportingEntradas || isRunning || isResetting) return;
    setReimportingEntradas(true);
    setReimportEntradasResult("");
    try {
      const res = await fetch("/api/bubble-import/reimport-entradas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bubbleUserId: filterBubbleUserId.trim() || undefined }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_${res.status}`);
      setReimportEntradasResult(
        `Entradas corrigidas: ${Number(json?.entradas ?? json?.notes ?? 0)} notas e ${Number(json?.itens ?? json?.items ?? 0)} itens.`,
      );
      await refreshCounts();
    } catch (error) {
      setReimportEntradasResult(error instanceof Error ? error.message : "Falha ao reimportar entradas.");
    } finally {
      setReimportingEntradas(false);
    }
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
        const res = await fetch("/api/bubble-import/reset", {
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
          const authErr = parseBubbleAuthError(msg);
          if (authErr?.kind === "token") {
            setStage("error");
            setResult("Token do Bubble inválido ou expirado. Atualize em /ajustes/bubble-global e tente novamente.");
            setSyncWarning(msg);
            break;
          }
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

  function parsePasted() {
    const raw = pastedInfo;
    const text = String(raw ?? "");
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
    if (isRunning) return;
    parsePasted();
    await sleep(50);
    await runSync();
  }

  useEffect(() => {
    props?.onApi?.({
      setPastedInfo,
      runAllFromPaste,
      resetServerSync,
    });
  }, [props, runAllFromPaste]);

  const monitorDerived = useMemo(() => {
    const looksLikeBubbleId = (value: string) => {
      const s = String(value ?? "").trim();
      if (!s) return false;
      if (s.length < 12) return false;
      if (!/^\d/.test(s)) return false;
      return /^[0-9]+x[0-9x]+$/i.test(s);
    };
    const looksLikeUniqueSupplierKey = (key: string) => {
      const k = String(key ?? "").trim();
      if (!k) return false;
      if (k.toLowerCase().startsWith("db:")) return true;
      return looksLikeBubbleId(k);
    };
    const fornecedoresRow = monitor.fornecedores?.row ?? null;
    const info = fornecedoresRow && typeof fornecedoresRow === "object" ? (fornecedoresRow as any).info : null;
    const produtos = fornecedoresRow && typeof fornecedoresRow === "object" ? (fornecedoresRow as any).produtos : null;
    const equivalencias = fornecedoresRow && typeof fornecedoresRow === "object" ? (fornecedoresRow as any).equivalencias : null;
    const infoEntries = info && typeof info === "object" ? (Object.entries(info as any) as Array<[string, any]>) : [];
    const all = infoEntries
      .map(([k, v]) => {
        const fornecedorRaw = String(v?.fornecedor ?? v?.nome ?? v?.name ?? "").trim();
        const fornecedor = looksLikeBubbleId(fornecedorRaw) ? "" : fornecedorRaw;
        if (!fornecedorRaw) return null;
        const vendedor = String(v?.vendedor ?? "").trim();
        const whatsapp = String(v?.whatsapp ?? "").trim();
        const endereco = String(v?.endereco ?? "").trim();
        const prods = produtos && typeof produtos === "object" ? ((produtos as any)[k] ?? []) : [];
        const produtosCount = Array.isArray(prods) ? prods.length : 0;
        return { key: k, fornecedor, fornecedorRaw, vendedor, whatsapp, endereco, produtosCount, hasUniqueId: looksLikeUniqueSupplierKey(k) };
      })
      .filter(Boolean) as Array<{
      key: string;
      fornecedor: string;
      fornecedorRaw: string;
      vendedor: string;
      whatsapp: string;
      endereco: string;
      produtosCount: number;
      hasUniqueId: boolean;
    }>;
    const withUniqueId = all.filter((x) => x.hasUniqueId);
    const withoutUniqueId = all.filter((x) => !x.hasUniqueId);
    const fornecedoresCount = all.length;
    const produtosCount = all.reduce((acc, f) => acc + (typeof f.produtosCount === "number" ? f.produtosCount : 0), 0);
    const equivalenciasCount =
      equivalencias && typeof equivalencias === "object" ? Object.values(equivalencias as any).reduce((acc: number, v: any) => acc + (Array.isArray(v) ? v.length : 0), 0) : 0;
    return { all, withUniqueId, withoutUniqueId, fornecedoresCount, produtosCount, equivalenciasCount };
  }, [monitor.fornecedores]);

  const wipeRequiredConfirm = useMemo(() => {
    const em = targetEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) return "";
    return `APAGAR DADOS DE ${em.toUpperCase()}`;
  }, [targetEmail]);

  const deletedCounts = useMemo(() => {
    if (!deletedPreview) return null;
    return {
      insumos: deletedPreview.deleted.insumos.length,
      fornecedores: deletedPreview.deleted.fornecedores.length,
      entradas: deletedPreview.deleted.entradas.length,
      inventario: deletedPreview.deleted.inventario.length,
      desperdicios: deletedPreview.deleted.desperdicios.length,
      fichas: deletedPreview.deleted.fichas.length,
      prePreparo: deletedPreview.deleted.prePreparo.length,
    };
  }, [deletedPreview]);

  function normalizeKey(v: unknown) {
    return String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function keyFromRow(row: any, fallbacks: string[]) {
    const id = String(row?.id ?? row?.key ?? "").trim();
    if (id) return `id:${id}`;
    const parts = fallbacks.map((k) => normalizeKey((row as any)?.[k]));
    return parts.filter(Boolean).join("|") || JSON.stringify(row ?? {});
  }

  async function wipeUserCompanyData() {
    if (isWiping) return;
    setWipeError("");
    setWipeResult(null);
    const em = targetEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setWipeError("Email inválido.");
      return;
    }
    const companyId = String(targetResolved?.companyId ?? "").trim();
    if (!companyId) {
      setWipeError("Empresa não resolvida. Digite o email e aguarde resolver.");
      return;
    }
    if (!wipeRequiredConfirm) {
      setWipeError("Confirmação indisponível.");
      return;
    }
    if (wipeConfirm.trim().toUpperCase().replace(/\s+/g, " ") !== wipeRequiredConfirm) {
      setWipeError("Confirmação incorreta.");
      return;
    }

    setIsWiping(true);
    try {
      await refreshMonitor();
      const before = {
        insumos: [...(monitor.insumos?.rows ?? [])],
        fornecedores: [...monitorDerived.all],
        entradas: [...(monitor.entradas?.rows ?? [])],
        inventario: [...(monitor.inventario?.rows ?? [])],
        desperdicios: [...(monitor.desperdicios?.rows ?? [])],
        fichas: [...(monitor.fichas?.rows ?? [])],
        prePreparo: [...(monitor.prePreparo?.rows ?? [])],
      };

      const res = await fetch("/api/admin/importacao-manual/clear-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em, companyId, confirm: wipeConfirm }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok || !json?.ok) {
        setWipeResult(json);
        setWipeError(String(json?.error ?? `failed_${res.status}`));
        return;
      }
      setWipeResult(json);

      await refreshMonitor();
      const after = {
        insumos: [...(monitor.insumos?.rows ?? [])],
        fornecedores: [...monitorDerived.all],
        entradas: [...(monitor.entradas?.rows ?? [])],
        inventario: [...(monitor.inventario?.rows ?? [])],
        desperdicios: [...(monitor.desperdicios?.rows ?? [])],
        fichas: [...(monitor.fichas?.rows ?? [])],
        prePreparo: [...(monitor.prePreparo?.rows ?? [])],
      };

      const diffRemoved = (b: any[], a: any[], fallbackKeys: string[]) => {
        const setA = new Set(a.map((r) => keyFromRow(r, fallbackKeys)));
        return b.filter((r) => !setA.has(keyFromRow(r, fallbackKeys)));
      };

      const deleted: DeletedPreview["deleted"] = {
        insumos: diffRemoved(before.insumos, after.insumos, ["item", "categoria", "medida"]),
        fornecedores: diffRemoved(before.fornecedores, after.fornecedores, ["fornecedor", "whatsapp", "vendedor"]),
        entradas: diffRemoved(before.entradas, after.entradas, ["numero", "data_lancamento", "fornecedor", "valor_nota"]),
        inventario: diffRemoved(before.inventario, after.inventario, ["nome", "data_contagem"]),
        desperdicios: diffRemoved(before.desperdicios, after.desperdicios, ["data", "item", "motivo"]),
        fichas: diffRemoved(before.fichas, after.fichas, ["receita", "nome", "categoria"]),
        prePreparo: diffRemoved(before.prePreparo, after.prePreparo, ["nome", "categoria"]),
      };

      setDeletedPreview({
        at: new Date().toLocaleString(),
        before,
        after,
        deleted,
      });
      setWipeConfirm("");
      await refreshCounts();
    } finally {
      setIsWiping(false);
    }
  }

  const targetUserParam = useMemo(() => {
    const uid = importAsUserId.trim();
    return uid && isUuid(uid) ? `?userId=${encodeURIComponent(uid)}&source=legacy` : "?source=legacy";
  }, [importAsUserId]);

  const tableStyles = useMemo(() => {
    return {
      table: { width: "100%", borderCollapse: "collapse", fontSize: 12 } as const,
      th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" } as const,
      td: { padding: "8px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" as const } as const,
      muted: { color: "#6b7280" } as const,
      wrap: { overflowX: "auto" as const, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" } as const,
    };
  }, []);

  function renderTable(args: {
    columns: Array<{ key: string; label: string; render: (row: any) => string }>;
    rows: any[];
    maxRows?: number;
    empty?: string;
  }) {
    const max = typeof args.maxRows === "number" ? args.maxRows : 30;
    const rows = Array.isArray(args.rows) ? args.rows.slice(0, max) : [];
    if (!rows.length) return <div className={styles.fileMeta}>{args.empty ?? "Sem dados ainda."}</div>;
    return (
      <div style={tableStyles.wrap}>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              {args.columns.map((c) => (
                <th key={c.key} style={tableStyles.th}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={String(r?.id ?? r?.key ?? idx)}>
                {args.columns.map((c) => (
                  <td key={c.key} style={tableStyles.td}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const compact = Boolean(props?.compact);

  if (compact) {
    return (
      <div className={styles.pageWrap}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Migrador</h1>
            <p className={styles.sub}>1) Resolver usuário 2) Sincronizar 3) Importar tudo</p>
          </div>
          <div className={styles.actions}>
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
            <span className={styles.noticeStrong}>Depois:</span> quando terminar, vá em <a href="/ajustes/importar-bubble" style={{ textDecoration: "underline" }}>/ajustes/importar-bubble</a> e clique em “Importar tudo”.
          </div>

          <div className={styles.fileList}>
            <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                <div className={styles.fileName}>Usuário alvo</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className={styles.fileMeta}>Email do usuário</div>
                    <input value={targetEmail} onChange={(e) => setTargetEmail(e.currentTarget.value)} placeholder="ex: usuario@dominio.com" className={styles.input} disabled={isRunning || isResolvingTarget} />
                  </label>
                  <button type="button" className={styles.btn} onClick={() => void resolveTargetByEmail()} disabled={isRunning || isResolvingTarget || !targetEmail.trim()}>
                    {isResolvingTarget ? "Resolvendo..." : "Resolver"}
                  </button>
                </div>
                {targetResolveError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{targetResolveError}</div> : null}
                {targetResolved ? <div className={styles.fileMeta}>empresa detectada: {targetResolved.companyName ?? "(sem nome)"} ({targetResolved.companyId})</div> : null}

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className={styles.fileMeta}>userId destino (Supabase UUID)</div>
                  <input value={importAsUserId} onChange={(e) => setImportAsUserId(e.currentTarget.value)} placeholder="UUID do usuário" className={styles.input} disabled={isRunning} />
                </label>

                <details>
                  <summary className={styles.fileName} style={{ cursor: "pointer" }}>
                    Apagar dados do usuário (opcional)
                  </summary>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className={styles.fileMeta}>Use somente se precisar zerar antes de sincronizar.</div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>Digite para confirmar</div>
                      <input value={wipeConfirm} onChange={(e) => setWipeConfirm(e.currentTarget.value)} placeholder={wipeRequiredConfirm || "Digite o email acima para gerar a confirmação"} className={styles.input} disabled={isRunning || isResolvingTarget || isWiping} />
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void wipeUserCompanyData()} disabled={isRunning || isResolvingTarget || isWiping || !wipeRequiredConfirm || !targetResolved?.companyId}>
                        {isWiping ? "Apagando..." : "Apagar dados deste usuário"}
                      </button>
                      {wipeRequiredConfirm ? <div className={styles.fileMeta}>confirmação: {wipeRequiredConfirm}</div> : null}
                    </div>
                    {wipeError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{wipeError}</div> : null}
                    {wipeResult?.steps?.length ? (
                      <div className={styles.pathsBox}>
                        {JSON.stringify(
                          {
                            ok: wipeResult.ok,
                            companyId: wipeResult.companyId,
                            steps: wipeResult.steps,
                          },
                          null,
                          2,
                        )}
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            </div>
          </div>

          {syncStatePath ? (
            <div className={styles.fileList}>
              <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className={styles.fileName}>Sync no servidor</div>
                  {syncState?.phase ? <div className={styles.fileMeta}>fase: {syncState.phase}</div> : null}
                  {syncState?.lastError || syncState?.import?.lastError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>erro: {syncState.lastError || syncState.import?.lastError}</div> : null}
                  {syncWarning ? (
                    <div className={`${styles.fileMeta} ${styles.statusErr}`}>
                      Erro: {syncWarning}
                      {parseBubbleAuthError(syncWarning)?.kind === "token" ? (
                        <span>
                          {" "}
                          • Token inválido/expirado: atualize em{" "}
                          <a href="/ajustes/conexao-migracao" style={{ textDecoration: "underline" }}>
                            /ajustes/conexao-migracao
                          </a>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {result ? <div className={styles.pathsBox}>{result}</div> : null}
        </section>
      </div>
    );
  }

  return (
    <div className={styles.pageWrap}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Migrador</h1>
          <p className={styles.sub}>Resolver usuário, apagar dados e sincronizar do Bubble.</p>
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
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className={styles.fileName}>Usuário alvo</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className={styles.fileMeta}>Email do usuário</div>
                        <input
                          value={targetEmail}
                          onChange={(e) => setTargetEmail(e.currentTarget.value)}
                          placeholder="ex: orenancapeletto@gmail.com"
                          className={styles.input}
                          disabled={isRunning || isResolvingTarget}
                        />
                      </label>
                      <button type="button" className={styles.btn} onClick={() => void resolveTargetByEmail()} disabled={isRunning || isResolvingTarget || !targetEmail.trim()}>
                        {isResolvingTarget ? "Resolvendo..." : "Resolver"}
                      </button>
                    </div>
                    {targetResolveError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{targetResolveError}</div> : null}
                    {targetResolved ? <div className={styles.fileMeta}>empresa detectada: {targetResolved.companyName ?? "(sem nome)"} ({targetResolved.companyId})</div> : null}

                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className={styles.fileMeta}>userId destino (Supabase UUID)</div>
                      <input
                        value={importAsUserId}
                        onChange={(e) => setImportAsUserId(e.currentTarget.value)}
                        placeholder="UUID do usuário (ex.: 00000000-0000-0000-0000-000000000000)"
                        className={styles.input}
                        disabled={isRunning}
                      />
                    </label>

                    <details>
                      <summary className={styles.fileName} style={{ cursor: "pointer" }}>
                        Apagar dados do usuário no Supabase (perigoso)
                      </summary>
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className={styles.fileMeta}>
                          Apaga os dados da empresa detectada acima (companyId) nas tabelas do banco compatível. Use somente se tiver certeza.
                        </div>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div className={styles.fileMeta}>Digite para confirmar</div>
                          <input
                            value={wipeConfirm}
                            onChange={(e) => setWipeConfirm(e.currentTarget.value)}
                            placeholder={wipeRequiredConfirm || "Digite o email acima para gerar a confirmação"}
                            className={styles.input}
                            disabled={isRunning || isResolvingTarget || isWiping}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnDanger}`}
                            onClick={() => void wipeUserCompanyData()}
                            disabled={isRunning || isResolvingTarget || isWiping || !wipeRequiredConfirm || !targetResolved?.companyId}
                          >
                            {isWiping ? "Apagando..." : "Apagar dados deste usuário"}
                          </button>
                          {wipeRequiredConfirm ? <div className={styles.fileMeta}>confirmação: {wipeRequiredConfirm}</div> : null}
                        </div>
                        {wipeError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{wipeError}</div> : null}
                        {wipeResult?.steps?.length ? (
                          <div className={styles.pathsBox}>
                            {JSON.stringify(
                              {
                                ok: wipeResult.ok,
                                companyId: wipeResult.companyId,
                                steps: wipeResult.steps,
                              },
                              null,
                              2,
                            )}
                          </div>
                        ) : null}
                        {deletedPreview && deletedCounts ? (
                          <div className={styles.fileMeta}>
                            apagados em {deletedPreview.at}: insumos {deletedCounts.insumos}, fornecedores {deletedCounts.fornecedores}, entradas {deletedCounts.entradas}, inventário{" "}
                            {deletedCounts.inventario}, desperdícios {deletedCounts.desperdicios}, fichas {deletedCounts.fichas}, pré-preparo {deletedCounts.prePreparo}
                          </div>
                        ) : null}
                      </div>
                    </details>

                    <details>
                      <summary className={styles.fileName} style={{ cursor: "pointer" }}>
                        Opções avançadas
                      </summary>
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className={styles.fileName}>Filtro no Bubble (opcional)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div className={styles.fileMeta}>Email (filtro)</div>
                            <input
                              value={filterEmail}
                              onChange={(e) => setFilterEmail(e.currentTarget.value)}
                              placeholder="ex: usuario@dominio.com"
                              className={styles.input}
                              disabled={isRunning}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div className={styles.fileMeta}>Bubble userId (Created By)</div>
                            <input
                              value={filterBubbleUserId}
                              onChange={(e) => setFilterBubbleUserId(e.currentTarget.value)}
                              placeholder="ex: 1690000000000x000000000000000000"
                              className={styles.input}
                              disabled={isRunning}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div className={styles.fileMeta}>Empresa/Restaurante (Bubble)</div>
                            <input
                              value={filterCompanyId}
                              onChange={(e) => setFilterCompanyId(e.currentTarget.value)}
                              placeholder="opcional (empresa_id/restaurante_id)"
                              className={styles.input}
                              disabled={isRunning}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div className={styles.fileMeta}>Tipo do usuário no Bubble</div>
                            <input
                              value={filterUserType}
                              onChange={(e) => setFilterUserType(e.currentTarget.value)}
                              placeholder="ex: User"
                              className={styles.input}
                              disabled={isRunning}
                            />
                          </label>
                        </div>

                        <div className={styles.fileName}>Colar texto para extrair campos (opcional)</div>
                        <textarea
                          value={pastedInfo}
                          onChange={(e) => setPastedInfo(e.currentTarget.value)}
                          placeholder="Cole aqui o texto (IDs, email, URLs, etc)."
                          className={styles.input}
                          rows={7}
                          disabled={isRunning}
                        />
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button type="button" className={styles.btn} onClick={parsePasted} disabled={isRunning || !pastedInfo.trim()}>
                            Extrair campos
                          </button>
                          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={runAllFromPaste} disabled={isRunning || !pastedInfo.trim() || !types.length}>
                            Executar tudo
                          </button>
                          {pasteResult ? <div className={styles.fileMeta}>{pasteResult}</div> : null}
                        </div>
                      </div>
                    </details>
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
                      {syncWarning ? (
                        <div className={`${styles.fileMeta} ${styles.statusErr}`}>
                          Conexão instável: {syncWarning}
                          {parseBubbleAuthError(syncWarning)?.kind === "token" ? (
                            <span>
                              {" "}
                              • Token inválido/expirado: atualize em{" "}
                              <a href="/ajustes/bubble-global" style={{ textDecoration: "underline" }}>
                                /ajustes/bubble-global
                              </a>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
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
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div className={styles.fileName}>Dados por módulo (preenche enquanto roda)</div>
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
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <details open>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Insumos ({(monitor.insumos?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/insumos${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Insumos
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.insumos?.rows ?? [],
                            columns: [
                              { key: "item", label: "Item", render: (r) => String(r?.item ?? "") },
                              { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") || "Pendente" },
                              { key: "medida", label: "Medida", render: (r) => String(r?.medida ?? "Und") },
                              { key: "custo", label: "Custo médio", render: (r) => String(r?.custoMedio ?? "") },
                            ],
                            maxRows: 30,
                          })}
                        </div>
                        {deletedPreview?.deleted?.insumos?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.insumos.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.insumos,
                                columns: [
                                  { key: "item", label: "Item", render: (r) => String(r?.item ?? "") },
                                  { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") || "Pendente" },
                                  { key: "medida", label: "Medida", render: (r) => String(r?.medida ?? "Und") },
                                  { key: "custo", label: "Custo médio", render: (r) => String(r?.custoMedio ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details open>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>
                          Fornecedores ({monitorDerived.fornecedoresCount.toLocaleString("pt-BR")}) • Com unique id ({monitorDerived.withUniqueId.length.toLocaleString("pt-BR")}) • Sem
                          unique id ({monitorDerived.withoutUniqueId.length.toLocaleString("pt-BR")}) • Produtos ({monitorDerived.produtosCount.toLocaleString("pt-BR")})
                        </summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/fornecedores${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Fornecedores
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitorDerived.withUniqueId,
                            columns: [
                              { key: "id", label: "Unique ID", render: (r) => String(r?.key ?? "") },
                              { key: "fornecedor", label: "Fornecedor", render: (r) => String(r?.fornecedor ?? "").trim() || "Sem nome" },
                              { key: "whatsapp", label: "WhatsApp", render: (r) => String(r?.whatsapp ?? "") },
                              { key: "vendedor", label: "Vendedor", render: (r) => String(r?.vendedor ?? "") },
                              { key: "produtos", label: "Produtos", render: (r) => String(r?.produtosCount ?? 0) },
                            ],
                            maxRows: 25,
                          })}
                        </div>
                        {monitorDerived.withoutUniqueId.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Sem unique id (verificar origem): {monitorDerived.withoutUniqueId.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: monitorDerived.withoutUniqueId,
                                columns: [
                                  { key: "chave", label: "Chave", render: (r) => String(r?.key ?? "") },
                                  { key: "fornecedor", label: "Fornecedor", render: (r) => String(r?.fornecedor ?? r?.fornecedorRaw ?? "").trim() || "Sem nome" },
                                  { key: "whatsapp", label: "WhatsApp", render: (r) => String(r?.whatsapp ?? "") },
                                  { key: "vendedor", label: "Vendedor", render: (r) => String(r?.vendedor ?? "") },
                                ],
                                maxRows: 25,
                              })}
                            </div>
                          </div>
                        ) : null}
                        {deletedPreview?.deleted?.fornecedores?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.fornecedores.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.fornecedores,
                                columns: [
                                  { key: "id", label: "Chave", render: (r) => String(r?.key ?? r?.id ?? "") },
                                  { key: "fornecedor", label: "Fornecedor", render: (r) => String(r?.fornecedor ?? "").trim() || "Sem nome" },
                                  { key: "whatsapp", label: "WhatsApp", render: (r) => String(r?.whatsapp ?? "") },
                                  { key: "vendedor", label: "Vendedor", render: (r) => String(r?.vendedor ?? "") },
                                  { key: "produtos", label: "Produtos", render: (r) => String(r?.produtosCount ?? 0) },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Entradas ({(monitor.entradas?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/entradas${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Entradas
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.entradas?.rows ?? [],
                            columns: [
                              { key: "numero", label: "Nº", render: (r) => String(r?.numero ?? "") },
                              { key: "data", label: "Data", render: (r) => String(r?.data_lancamento ?? r?.dataLancamento ?? "") },
                              { key: "fornecedor", label: "Fornecedor", render: (r) => String(r?.fornecedor ?? "") },
                              { key: "valor", label: "Valor", render: (r) => String(r?.valor_nota ?? r?.valorNota ?? "") },
                            ],
                            maxRows: 20,
                          })}
                        </div>
                        {deletedPreview?.deleted?.entradas?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.entradas.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.entradas,
                                columns: [
                                  { key: "numero", label: "Nº", render: (r) => String(r?.numero ?? "") },
                                  { key: "data", label: "Data", render: (r) => String(r?.data_lancamento ?? r?.dataLancamento ?? "") },
                                  { key: "fornecedor", label: "Fornecedor", render: (r) => String(r?.fornecedor ?? "") },
                                  { key: "valor", label: "Valor", render: (r) => String(r?.valor_nota ?? r?.valorNota ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Inventário ({(monitor.inventario?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/inventario${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Inventário
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.inventario?.rows ?? [],
                            columns: [
                              { key: "nome", label: "Nome", render: (r) => String(r?.nome ?? r?.nomeLabel ?? "") },
                              { key: "data", label: "Data", render: (r) => String(r?.data_contagem ?? r?.dataContagem ?? r?.data ?? "") },
                              { key: "itens", label: "Itens", render: (r) => String(r?.itens ?? r?.itensCount ?? "") },
                              { key: "valor", label: "Valor", render: (r) => String(r?.valor ?? r?.valorLabel ?? "") },
                            ],
                            maxRows: 20,
                          })}
                        </div>
                        {deletedPreview?.deleted?.inventario?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.inventario.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.inventario,
                                columns: [
                                  { key: "nome", label: "Nome", render: (r) => String(r?.nome ?? r?.nomeLabel ?? "") },
                                  { key: "data", label: "Data", render: (r) => String(r?.data_contagem ?? r?.dataContagem ?? r?.data ?? "") },
                                  { key: "itens", label: "Itens", render: (r) => String(r?.itens ?? r?.itensCount ?? "") },
                                  { key: "valor", label: "Valor", render: (r) => String(r?.valor ?? r?.valorLabel ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Desperdícios ({(monitor.desperdicios?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/desperdicios${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Desperdícios
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.desperdicios?.rows ?? [],
                            columns: [
                              { key: "data", label: "Data", render: (r) => String(r?.data ?? r?.dataLabel ?? "") },
                              { key: "item", label: "Item", render: (r) => String(r?.item ?? r?.insumo ?? "") },
                              { key: "qtd", label: "Qtd", render: (r) => String(r?.quantidade ?? r?.quantidadeLabel ?? "") },
                              { key: "motivo", label: "Motivo", render: (r) => String(r?.motivo ?? "") },
                            ],
                            maxRows: 20,
                          })}
                        </div>
                        {deletedPreview?.deleted?.desperdicios?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.desperdicios.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.desperdicios,
                                columns: [
                                  { key: "data", label: "Data", render: (r) => String(r?.data ?? r?.dataLabel ?? "") },
                                  { key: "item", label: "Item", render: (r) => String(r?.item ?? r?.insumo ?? "") },
                                  { key: "qtd", label: "Qtd", render: (r) => String(r?.quantidade ?? r?.quantidadeLabel ?? "") },
                                  { key: "motivo", label: "Motivo", render: (r) => String(r?.motivo ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Fichas Técnicas ({(monitor.fichas?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/fichas-tecnicas${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Fichas Técnicas
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.fichas?.rows ?? [],
                            columns: [
                              { key: "nome", label: "Receita", render: (r) => String(r?.receita ?? r?.nome ?? r?.name ?? "") },
                              { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") },
                              { key: "rendimento", label: "Rendimento", render: (r) => String(r?.rendimento ?? "") },
                              { key: "cmv", label: "CMV", render: (r) => String(r?.cmv ?? "") },
                            ],
                            maxRows: 20,
                          })}
                        </div>
                        {deletedPreview?.deleted?.fichas?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.fichas.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.fichas,
                                columns: [
                                  { key: "nome", label: "Receita", render: (r) => String(r?.receita ?? r?.nome ?? r?.name ?? "") },
                                  { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") },
                                  { key: "rendimento", label: "Rendimento", render: (r) => String(r?.rendimento ?? "") },
                                  { key: "cmv", label: "CMV", render: (r) => String(r?.cmv ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>

                      <details>
                        <summary style={{ fontWeight: 900, cursor: "pointer" }}>Pré-preparo ({(monitor.prePreparo?.rows ?? []).length.toLocaleString("pt-BR")})</summary>
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <a className={styles.fileMeta} href={`/pre-preparo${targetUserParam}`} style={{ textDecoration: "underline" }}>
                            Abrir Pré-preparo
                          </a>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          {renderTable({
                            rows: monitor.prePreparo?.rows ?? [],
                            columns: [
                              { key: "nome", label: "Nome", render: (r) => String(r?.nome ?? r?.name ?? "") },
                              { key: "validade", label: "Validade", render: (r) => String(r?.validade ?? "") },
                              { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") },
                              { key: "itens", label: "Itens", render: (r) => String(r?.itens ?? r?.ingredientes ?? "") },
                            ],
                            maxRows: 20,
                          })}
                        </div>
                        {deletedPreview?.deleted?.prePreparo?.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className={styles.fileMeta}>Apagados na última limpeza: {deletedPreview.deleted.prePreparo.length.toLocaleString("pt-BR")}</div>
                            <div style={{ marginTop: 8 }}>
                              {renderTable({
                                rows: deletedPreview.deleted.prePreparo,
                                columns: [
                                  { key: "nome", label: "Nome", render: (r) => String(r?.nome ?? r?.name ?? "") },
                                  { key: "validade", label: "Validade", render: (r) => String(r?.validade ?? "") },
                                  { key: "categoria", label: "Categoria", render: (r) => String(r?.categoria ?? "") },
                                  { key: "itens", label: "Itens", render: (r) => String(r?.itens ?? r?.ingredientes ?? "") },
                                ],
                                maxRows: 20,
                              })}
                            </div>
                          </div>
                        ) : null}
                      </details>
                    </div>
                  </div>
                </div>
              </div>

              <details style={{ marginTop: 12 }}>
                <summary className={styles.fileName} style={{ cursor: "pointer" }}>
                  Contagens do Supabase (diagnóstico)
                </summary>
                <div className={styles.fileList} style={{ marginTop: 10 }}>
                  <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
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
              </details>

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

              <details style={{ marginTop: 12 }}>
                <summary className={styles.fileName} style={{ cursor: "pointer" }}>
                  Configuração e manutenção
                </summary>
                <div className={styles.fileList} style={{ marginTop: 10 }}>
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
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={reimportEntradasFromBubble}
                        disabled={isRunning || isResetting || reimportingEntradas}
                      >
                        {reimportingEntradas ? "Corrigindo entradas..." : "Reimportar somente Entradas do Bubble"}
                      </button>
                      {resetError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{resetError}</div> : null}
                      {reimportEntradasResult ? <div className={styles.fileMeta}>{reimportEntradasResult}</div> : null}
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
                    <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 800, color: "#111827" }}>
                      <input type="checkbox" checked={useOverrideCreds} onChange={(e) => setUseOverrideCreds(e.target.checked)} />
                      Usar credenciais manuais (override)
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => {
                          setUseOverrideCreds(false);
                          setBaseUrl("");
                          setToken("");
                          try {
                            window.localStorage.removeItem("cmvfacil:bubbleUseOverrideCreds");
                            window.localStorage.removeItem("cmvfacil:bubbleBaseUrl");
                            window.localStorage.removeItem("cmvfacil:bubbleToken");
                          } catch {}
                        }}
                      >
                        Limpar override salvo
                      </button>
                    </div>
                    {!useOverrideCreds ? (
                      <div className={styles.fileMeta}>
                        Usando as credenciais globais salvas no Supabase. Para alterar:{" "}
                        <a href="/ajustes/conexao-migracao" style={{ textDecoration: "underline" }}>
                          /ajustes/conexao-migracao
                        </a>
                      </div>
                    ) : null}
                    {useOverrideCreds ? (
                      <>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div className={styles.fileMeta}>URL do Bubble</div>
                          <input className={styles.input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://app.seudominio.com" />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div className={styles.fileMeta}>Token da Data API</div>
                          <input className={styles.input} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="cole o token aqui" />
                        </label>
                      </>
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
              </details>

      {result ? <div className={styles.pathsBox}>{result}</div> : null}
      </section>
    </div>
  );
}

export default function ImportarBubbleApiClient() {
  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <ImportarBubbleApiPanel />
        </div>
      </main>
    </>
  );
}
