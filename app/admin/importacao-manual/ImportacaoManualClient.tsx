"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";

type ModuleKey = "insumos" | "fornecedores" | "entradas" | "inventario" | "desperdicios" | "fichas-tecnicas" | "pre-preparo";
type SourceMode = "pasted_text" | "bubble_network_json" | "bubble_csv";

type ResolvedUser = {
  userId: string;
  email: string;
  companyId: string;
  companyName: string | null;
  memberships: Array<{ companyId: string; companyName: string | null; role: string | null; permissionLevel: number | null }>;
};

type InsumoDraftRow = {
  rowId: string;
  bubbleId?: string;
  item: string;
  medida: string;
  custoMedio: string;
  categoria: string;
  especificacao: string;
  ocultar: boolean;
  warnings: string[];
};

type AnalyzeResult = {
  ok: boolean;
  module: ModuleKey;
  source: "pasted_text";
  sectionsDetected?: string[];
  recognizedColumns: string[];
  missingColumns: string[];
  totalRows: number;
  pendingClassificationCount: number;
  duplicates: Array<{ key: string; rowIds: string[] }>;
  categoryCounts: Array<{ categoria: string; count: number }>;
  rows: InsumoDraftRow[];
  errors: string[];
};

type ApplyResult = {
  ok: boolean;
  module: ModuleKey;
  companyId: string;
  created: number;
  updated: number;
  ignored: number;
  deleted?: number | null;
  tables?: string[];
  errors: Array<{ rowId: string; message: string }>;
};

type NetworkAnalyzeResult = {
  ok: true;
  mode: "bubble_network_json";
  parsed: { ok: number; error: number };
  totals: { recordsDetected: number; missingBubbleId: number; missingBubbleType: number; duplicateKeys: number };
  byType: Array<{ type: string; count: number }>;
  destinationByType: Array<{ type: string; table: string | null }>;
  duplicates: Array<{ key: string; count: number; sources: string[] }>;
  missing: {
    bubbleId: Array<{ bubble_type: string | null; bubble_id: string | null; sources: string[] }>;
    bubbleType: Array<{ bubble_type: string | null; bubble_id: string | null; sources: string[] }>;
  };
  relations: {
    total: number;
    resolved: number;
    broken: number;
    brokenSamples: Array<{ from_type: string; from_id: string; key: string; expected: string; inferred_to: string | null }>;
    resolvedSamples: Array<{ from_type: string; from_id: string; key: string; to_id: string; inferred_to: string | null }>;
  };
  unmapped: { topUnmappedKeysByType: Record<string, Array<{ key: string; count: number }>> };
  samples: Record<string, any[]>;
  plan: {
    companyId: string;
    byTable: Array<{
      table: string;
      baseTypes: string[];
      sourceRows: number;
      plannedRows: number;
      missingBubbleId: number;
      duplicatesInSource: number;
      wouldCreate: number;
      wouldUpdate: number;
      wouldIgnore: number;
      brokenRelations: number;
      reason?: string;
    }>;
  };
  detectedRecords: Array<{ bubble_type: string | null; bubble_id: string | null; table: string | null; status: string; ignoreReason: string }>;
  recordsForApply: Array<{
    bubble_id: string | null;
    bubble_type: string | null;
    base_type: string | null;
    raw: any;
    normalized: any;
    sources: string[];
  }>;
  delta?: { new: number; existing: number; updated: number; duplicates: number };
  session?: { label: string; createdAt: string; updatedAt: string; records: number; path: string };
  validation?: { ok: true; criticalCount: number; warningsCount: number; checks: Array<{ key: string; label: string; critical: boolean; count: number; samples: any[] }> };
};

type NetworkApplyResult = {
  ok: true;
  mode: "bubble_network_json" | "bubble_csv";
  email: string;
  companyId: string;
  userId: string;
  startedAt: string;
  finishedAt: string;
  totals: { processed: number; created: number; updated: number; ignored: number; errors: number; brokenRelations: number };
  perTable: Record<
    string,
    {
      attempted: number;
      created: number;
      updated: number;
      ignored: number;
      errors: Array<{ bubble_id: string; error: string }>;
      ignoredReasons: Record<string, number>;
      brokenRelations: number;
      brokenSamples: Array<{ bubble_id: string; relation: string; column: string; expected: string }>;
    }
  >;
  ignoredSamples: Array<{ bubble_id: string; base_type: string; reason: string }>;
  ignoredRecords: Array<{
    bubble_id: string;
    bubble_type: string | null;
    base_type: string;
    table: string | null;
    reason: string;
    broken?: Array<{ relation: string; column: string; expected: string }> | null;
  }>;
  links: Array<{ label: string; href: string }>;
  audit: { bucket: string; path: string };
};

type CsvAnalyzeResult = {
  ok: true;
  mode: "bubble_csv";
  email: string;
  companyId: string;
  derivedCompany?: { companyId: string; companyName: string | null; bubbleCompanyId: string } | null;
  files: Array<{
    name: string;
    baseType: string | null;
    destinationTable: string | null;
    rows: number;
    headers: string[];
    rawHeaders: string[];
    missingRequiredColumns: Array<string[]> | any[];
    unknownColumns?: string[];
    status: "ok" | "error";
    statusReason: string;
    hash: string;
  }>;
  detection?: Array<{ name: string; baseType: string | null; destinationTable: string | null; rows: number; status: string; statusReason: string }>;
  unknownFiles: Array<{ name: string; rows: number; headers: string[] }>;
  missingFiles?: string[];
  duplicatesInCsv?: Array<{ baseType: string; bubble_id: string; count: number; files: string[] }>;
  plan?: {
    order: string[];
    byTable: Array<{
      order: number;
      table: string;
      baseTypes: string[];
      sourceRows: number;
      missingBubbleId: number;
      duplicatesInSource: number;
      wouldCreate: number;
      wouldUpdate: number;
      wouldIgnore: number;
      ignoreReasons?: Record<string, number>;
      ignoreReasonTop?: string;
    }>;
  };
  totals: { files: number; rows: number; byType: number };
  byType: Array<{ type: string; count: number }>;
  recordsForApply: Array<{
    bubble_id: string | null;
    bubble_type: string | null;
    base_type: string | null;
    raw: any;
    normalized: any;
    sources: string[];
  }>;
  validation?: { ok: true; criticalCount: number; warningsCount: number; checks: Array<{ key: string; label: string; critical: boolean; count: number; samples: any[] }> };
  relationResolution?:
    | {
        ok: true;
        total: number;
        truncated: boolean;
        stats: { bubbleId: number; name: number; date: number; primaryField: number; ambiguous: number; notFound: number };
        rows: Array<{
          type: string;
          csvValue: string;
          resolution: string;
          found: string;
          reason?: string;
          overrideKey?: string | null;
          strategy?: string | null;
          candidates?: Array<{ value: string; label: string }> | null;
        }>;
      }
    | { ok: false; error: string };
};

type AuditCompanyResult = {
  ok: true;
  companyId: string;
  capturedAt: string;
  counts: Record<string, number>;
  perTable?: Record<
    string,
    {
      count: number;
      expected: number | null;
      mismatch: boolean;
      missingBubbleIds: number;
      duplicateBubbleIds: Array<{ bubble_id: string; count: number }>;
      recent: Array<{ bubble_id: string | null; created_at?: any; updated_at?: any }>;
      truncated: boolean;
    }
  >;
};

function normalizeSpace(s: string) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s: string) {
  return normalizeSpace(s).toLowerCase();
}

function formatIntPT(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

export default function ImportacaoManualClient() {
  const [email, setEmail] = useState("orenancapeletto@gmail.com");
  const [resolved, setResolved] = useState<ResolvedUser | null>(null);
  const [resolveError, setResolveError] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  const [mode, setMode] = useState<SourceMode>("bubble_csv");

  const [pasted, setPasted] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  const [pastedNetworkJson, setPastedNetworkJson] = useState("");
  const [networkFileInfo, setNetworkFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [isAnalyzingNetwork, setIsAnalyzingNetwork] = useState(false);
  const [analysisNetwork, setAnalysisNetwork] = useState<NetworkAnalyzeResult | null>(null);
  const [analysisNetworkError, setAnalysisNetworkError] = useState("");
  const [isApplyingNetwork, setIsApplyingNetwork] = useState(false);
  const [applyNetworkResult, setApplyNetworkResult] = useState<NetworkApplyResult | null>(null);
  const [applyNetworkError, setApplyNetworkError] = useState("");
  const [networkTab, setNetworkTab] = useState<"preview" | "resumo" | "integridade">("preview");
  const [networkAck, setNetworkAck] = useState(false);
  const [networkModules, setNetworkModules] = useState<Record<string, boolean>>({
    empresas: true,
    categorias: true,
    itens: true,
    fornecedores: true,
    entradas: true,
    inventario: true,
    desperdicios: true,
    receitas: true,
    lista_de_compras: true,
  });

  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState("");

  const [csvFiles, setCsvFiles] = useState<File[]>([]);
  const [csvStep, setCsvStep] = useState<1 | 2 | 3 | 4>(1);
  const [isAnalyzingCsv, setIsAnalyzingCsv] = useState(false);
  const [analysisCsv, setAnalysisCsv] = useState<CsvAnalyzeResult | null>(null);
  const [analysisCsvError, setAnalysisCsvError] = useState("");
  const [csvRelationOverrides, setCsvRelationOverrides] = useState<Record<string, string>>({});
  const [isApplyingCsv, setIsApplyingCsv] = useState(false);
  const [applyCsvResult, setApplyCsvResult] = useState<NetworkApplyResult | null>(null);
  const [applyCsvError, setApplyCsvError] = useState("");
  const [csvAudit, setCsvAudit] = useState<AuditCompanyResult | null>(null);
  const [csvAuditError, setCsvAuditError] = useState("");
  const [csvProgressKey, setCsvProgressKey] = useState("");
  const [csvProgress, setCsvProgress] = useState<any>(null);
  const csvApplyingRef = useRef(false);
  const [csvReportDownloadedKey, setCsvReportDownloadedKey] = useState("");

  const [isClearingModule, setIsClearingModule] = useState(false);
  const [isWipingUser, setIsWipingUser] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wipeResult, setWipeResult] = useState<any>(null);
  const [wipeError, setWipeError] = useState("");

  const moduleOptions: Array<{ key: ModuleKey; label: string; enabled: boolean }> = useMemo(
    () => [
      { key: "insumos", label: "Insumos", enabled: true },
      { key: "fornecedores", label: "Fornecedores", enabled: false },
      { key: "entradas", label: "Entradas", enabled: false },
      { key: "inventario", label: "Inventário", enabled: false },
      { key: "desperdicios", label: "Desperdícios", enabled: false },
      { key: "fichas-tecnicas", label: "Fichas Técnicas", enabled: false },
      { key: "pre-preparo", label: "Pré-preparo", enabled: false },
    ],
    [],
  );

  const canAnalyze = Boolean(resolved?.companyId && pasted.trim() && !isAnalyzing && !isResolving && mode === "pasted_text");
  const canApply = Boolean(resolved?.companyId && analysis?.ok && analysis.module === "insumos" && analysis.rows.length && !isApplying);
  const canAnalyzeNetwork = Boolean(resolved?.companyId && pastedNetworkJson.trim() && !isAnalyzingNetwork && !isResolving && mode === "bubble_network_json");
  const canApplyNetwork = Boolean(
    resolved?.companyId &&
      analysisNetwork?.ok &&
      analysisNetwork.recordsForApply.length &&
      !isApplyingNetwork &&
      !isAnalyzingNetwork &&
      !isResolving &&
      mode === "bubble_network_json",
  );

  const canAnalyzeCsv = Boolean(normalizeSpace(email).includes("@") && csvFiles.length && !isAnalyzingCsv && !isResolving && mode === "bubble_csv");
  const csvRelationResolution = analysisCsv?.ok && analysisCsv.relationResolution && (analysisCsv.relationResolution as any)?.ok ? (analysisCsv.relationResolution as any) : null;
  const csvUnresolvedAmbiguous = useMemo(() => {
    if (!csvRelationResolution) return 0;
    const rows = Array.isArray(csvRelationResolution.rows) ? csvRelationResolution.rows : [];
    const missing = new Set<string>();
    for (const r of rows) {
      const overrideKey = String((r as any)?.overrideKey ?? "").trim();
      const hasCandidates = Array.isArray((r as any)?.candidates) && (r as any)?.candidates?.length;
      const isAmbiguous = String((r as any)?.resolution ?? "").includes("ambígua");
      if (!overrideKey || !hasCandidates || !isAmbiguous) continue;
      if (!String(csvRelationOverrides[overrideKey] ?? "").trim()) missing.add(overrideKey);
    }
    return missing.size;
  }, [csvRelationResolution, csvRelationOverrides]);
  const csvAdjustedResolutionStats = useMemo(() => {
    if (!csvRelationResolution) return null;
    const base = csvRelationResolution.stats ?? null;
    if (!base) return null;
    const next = {
      bubbleId: Number(base.bubbleId ?? 0),
      name: Number(base.name ?? 0),
      date: Number(base.date ?? 0),
      primaryField: Number(base.primaryField ?? 0),
      ambiguous: Number(base.ambiguous ?? 0),
      notFound: Number(base.notFound ?? 0),
    };
    const rows = Array.isArray(csvRelationResolution.rows) ? csvRelationResolution.rows : [];
    for (const r of rows) {
      const isAmbiguous = String((r as any)?.resolution ?? "").includes("ambígua");
      if (!isAmbiguous) continue;
      const overrideKey = String((r as any)?.overrideKey ?? "").trim();
      if (!overrideKey) continue;
      const chosen = String(csvRelationOverrides[overrideKey] ?? "").trim();
      if (!chosen) continue;
      if (next.ambiguous > 0) next.ambiguous -= 1;
      const strategy = String((r as any)?.strategy ?? "").trim();
      if (strategy === "date") next.date += 1;
      else if (strategy === "primary_field") next.primaryField += 1;
      else next.name += 1;
    }
    return next;
  }, [csvRelationResolution, csvRelationOverrides]);
  const csvRelationReview = useMemo(() => {
    if (!csvRelationResolution) {
      return {
        total: 0,
        autoResolved: 0,
        pendingOccurrences: 0,
        pendingGroupsCount: 0,
        pendingActionableCount: 0,
        pendingBlockedCount: 0,
        pendingUnresolvedCount: 0,
        pendingGroups: [] as Array<{
          groupKey: string;
          type: string;
          csvValue: string;
          resolution: string;
          reason: string;
          overrideKey: string;
          candidates: Array<{ value: string; label: string }>;
          occurrences: number;
          chosenValue: string;
          chosenLabel: string;
          actionable: boolean;
        }>,
      };
    }
    const rows = Array.isArray(csvRelationResolution.rows) ? (csvRelationResolution.rows as any[]) : [];
    const groupByKey = new Map<
      string,
      {
        groupKey: string;
        type: string;
        csvValue: string;
        resolution: string;
        reason: string;
        overrideKey: string;
        candidatesByValue: Map<string, string>;
        occurrences: number;
      }
    >();

    let total = 0;
    let autoResolved = 0;
    let pendingOccurrences = 0;

    for (const r of rows) {
      total += 1;
      const resolution = String(r?.resolution ?? "").trim();
      const isPending = resolution.startsWith("⚠️") || resolution.startsWith("❌");
      if (!isPending) {
        autoResolved += 1;
        continue;
      }
      pendingOccurrences += 1;
      const type = String(r?.type ?? "").trim();
      const csvValue = String(r?.csvValue ?? "").trim();
      const reason = String(r?.reason ?? "").trim();
      const overrideKey = String(r?.overrideKey ?? "").trim();
      const groupKey = overrideKey || `pending:${normKey(type)}:${normKey(csvValue)}:${normKey(resolution)}`;
      const candidates = Array.isArray(r?.candidates) ? (r.candidates as any[]) : [];

      const cur =
        groupByKey.get(groupKey) ??
        ({
          groupKey,
          type,
          csvValue,
          resolution,
          reason,
          overrideKey,
          candidatesByValue: new Map<string, string>(),
          occurrences: 0,
        } as any);

      cur.occurrences += 1;
      if (!cur.reason && reason) cur.reason = reason;
      if (!cur.type && type) cur.type = type;
      if (!cur.csvValue && csvValue) cur.csvValue = csvValue;
      if (!cur.resolution && resolution) cur.resolution = resolution;
      if (!cur.overrideKey && overrideKey) cur.overrideKey = overrideKey;

      for (const c of candidates) {
        const v = String(c?.value ?? "").trim();
        const l = String(c?.label ?? "").trim();
        if (!v) continue;
        if (!cur.candidatesByValue.has(v)) cur.candidatesByValue.set(v, l || v);
      }
      groupByKey.set(groupKey, cur);
    }

    const pendingGroupsRaw = Array.from(groupByKey.values()).map((g) => {
      const candidates = Array.from(g.candidatesByValue.entries())
        .slice(0, 50)
        .map(([value, label]) => ({ value, label }));
      const chosenValue = g.overrideKey ? String(csvRelationOverrides[g.overrideKey] ?? "").trim() : "";
      const chosenLabel = chosenValue ? String(g.candidatesByValue.get(chosenValue) ?? "").trim() : "";
      const actionable = Boolean(g.overrideKey && candidates.length);
      return {
        groupKey: g.groupKey,
        type: g.type,
        csvValue: g.csvValue,
        resolution: g.resolution,
        reason: g.reason,
        overrideKey: g.overrideKey,
        candidates,
        occurrences: g.occurrences,
        chosenValue,
        chosenLabel,
        actionable,
      };
    });

    pendingGroupsRaw.sort((a, b) => {
      const aRank = a.resolution.startsWith("⚠️") ? 0 : 1;
      const bRank = b.resolution.startsWith("⚠️") ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return a.type.localeCompare(b.type);
    });

    const pendingGroupsCount = pendingGroupsRaw.length;
    const pendingActionableCount = pendingGroupsRaw.filter((g) => g.actionable).length;
    const pendingBlockedCount = pendingGroupsRaw.filter((g) => !g.actionable).length;
    const pendingUnresolvedCount = pendingGroupsRaw.filter((g) => !g.actionable || !g.chosenValue).length;

    return {
      total,
      autoResolved,
      pendingOccurrences,
      pendingGroupsCount,
      pendingActionableCount,
      pendingBlockedCount,
      pendingUnresolvedCount,
      pendingGroups: pendingGroupsRaw,
    };
  }, [csvRelationResolution, csvRelationOverrides]);
  const csvCriticalReasons = useMemo(() => {
    if (!analysisCsv?.ok) return [] as string[];
    const reasons: string[] = [];
    const fileErrors = analysisCsv.files.filter((f) => f.status !== "ok");
    if (fileErrors.length) reasons.push(`Arquivos com erro: ${formatIntPT(fileErrors.length)}`);
    if (analysisCsv.missingFiles?.length) reasons.push(`Arquivos ausentes: ${analysisCsv.missingFiles.join(", ")}`);
    if (analysisCsv.duplicatesInCsv?.length) reasons.push(`Bubble IDs duplicados: ${formatIntPT(analysisCsv.duplicatesInCsv.length)}`);
    const plannedIgnore = (analysisCsv.plan?.byTable ?? []).reduce((acc, t) => acc + (Number((t as any)?.wouldIgnore ?? 0) || 0), 0);
    if (plannedIgnore) {
      const details = (analysisCsv.plan?.byTable ?? [])
        .filter((t) => Number((t as any)?.wouldIgnore ?? 0) > 0)
        .slice(0, 4)
        .map((t) => `${String((t as any)?.table ?? "")}: ${String((t as any)?.ignoreReasonTop ?? "").trim() || "—"}`)
        .filter(Boolean)
        .join(" • ");
      reasons.push(`Registros que seriam ignorados: ${formatIntPT(plannedIgnore)}${details ? ` — ${details}` : ""}`);
    }
    if (analysisCsv.validation?.ok && analysisCsv.validation.criticalCount) reasons.push(`Relacionamentos quebrados: ${formatIntPT(analysisCsv.validation.criticalCount)}`);
    if (csvRelationReview.pendingUnresolvedCount) reasons.push(`Pendências de relacionamento: ${formatIntPT(csvRelationReview.pendingUnresolvedCount)}`);
    return reasons;
  }, [analysisCsv, csvRelationReview.pendingUnresolvedCount]);
  const csvHasCritical = csvCriticalReasons.length > 0;
  const canApplyCsv = Boolean(
    resolved?.companyId &&
      analysisCsv?.ok &&
      analysisCsv.recordsForApply.length &&
      !csvHasCritical &&
      !isApplyingCsv &&
      !isAnalyzingCsv &&
      !isResolving &&
      mode === "bubble_csv",
  );

  useEffect(() => {
    if (!resolved?.companyId) return;
    if (!resolved?.email) return;
    if (!csvProgressKey) return;
    if (!isApplyingCsv) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/admin/importacao-manual/csv-progress?email=${encodeURIComponent(resolved.email)}&companyId=${encodeURIComponent(resolved.companyId)}&key=${encodeURIComponent(csvProgressKey)}`,
          { cache: "no-store" },
        ).catch(() => null);
        const json = res ? await res.json().catch(() => null) : null;
        if (!cancelled && res?.ok && json?.ok) setCsvProgress(json.value);
      } catch {}
      if (!cancelled) setTimeout(tick, 1000);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [csvProgressKey, isApplyingCsv, resolved?.companyId, resolved?.email]);

  const downloadJsonFile = (filename: string, obj: unknown) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  useEffect(() => {
    if (!analysisCsv?.ok) return;
    if (!applyCsvResult?.ok) return;
    if (!csvAudit?.ok) return;
    if (!resolved?.companyId) return;
    const key = csvProgressKey || applyCsvResult.finishedAt || "";
    if (!key) return;
    if (csvReportDownloadedKey === key) return;
    const companySafe = String(resolved.companyName ?? "empresa")
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .slice(0, 40);
    const day = new Date().toISOString().slice(0, 10);
    const filename = `Migracao-${companySafe || "empresa"}-${day}.json`;
    const startedAt = applyCsvResult.startedAt;
    const finishedAt = applyCsvResult.finishedAt;
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    const report = {
      mode: "bubble_csv",
      companyId: resolved.companyId,
      companyName: resolved.companyName,
      email: resolved.email,
      generatedAt: new Date().toISOString(),
      files: analysisCsv.files.map((f) => ({
        name: f.name,
        baseType: f.baseType,
        destinationTable: f.destinationTable,
        rows: f.rows,
        status: f.status,
        statusReason: f.statusReason,
        missingRequiredColumns: f.missingRequiredColumns ?? [],
        unknownColumns: f.unknownColumns ?? [],
      })),
      unknownFiles: analysisCsv.unknownFiles ?? [],
      missingFiles: analysisCsv.missingFiles ?? [],
      duplicatesInCsv: analysisCsv.duplicatesInCsv ?? [],
      validation: analysisCsv.validation ?? null,
      order: analysisCsv.plan?.order ?? [],
      plan: analysisCsv.plan ?? null,
      apply: applyCsvResult,
      audit: csvAudit,
      progressLast: csvProgress ?? null,
      blockedReasons: csvHasCritical ? csvCriticalReasons : [],
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
    };
    downloadJsonFile(filename, report);
    setCsvReportDownloadedKey(key);
  }, [analysisCsv, applyCsvResult, csvAudit, resolved?.companyId, csvProgressKey, csvProgress, csvReportDownloadedKey]);

  const networkModuleOptions = useMemo(
    () => [
      { key: "empresas", label: "Empresas" },
      { key: "categorias", label: "Categorias" },
      { key: "itens", label: "Itens" },
      { key: "fornecedores", label: "Fornecedores" },
      { key: "entradas", label: "Entradas" },
      { key: "inventario", label: "Inventário" },
      { key: "desperdicios", label: "Desperdícios" },
      { key: "receitas", label: "Receitas" },
      { key: "lista_de_compras", label: "Lista de Compras" },
    ],
    [],
  );

  const moduleKeyForBaseType = (baseType: string | null) => {
    const t = String(baseType ?? "").trim().toLowerCase();
    if (!t) return null;
    if (t === "custom.empresas" || t === "user") return "empresas";
    if (t === "custom.categorias") return "categorias";
    if (t === "custom.itens" || t === "custom.item" || t === "custom.custo_medio_item") return "itens";
    if (t === "custom.fornecedores" || t === "custom.itens_fornecedores") return "fornecedores";
    if (t === "custom.notas_fiscais" || t === "custom.itens_notas") return "entradas";
    if (t === "custom.inventarios" || t === "custom.itens_inventarios") return "inventario";
    if (t === "custom.desperdicio" || t === "custom.motivos_desperdicios" || t === "custom.etiquetas") return "desperdicios";
    if (t === "custom.ingredientes" || t === "custom.ingredientes".toLowerCase()) return "receitas";
    if (t === "custom.itens_lista_compras" || t === "custom.qtd_compra_real" || t === "custom.faturamentos") return "lista_de_compras";
    return null;
  };

  const bubbleNetworkConsoleSnippet = useMemo(() => {
    return `(() => {
  const exists = window.__bubbleNetworkCapture;
  if (exists && exists.stop) {
    exists.stop();
  }

  const nowIso = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalizeBubbleRef = (value) => {
    if (typeof value !== "string") return value;
    if (value.includes("__LOOKUP__")) return value.split("__LOOKUP__").pop();
    return value;
  };
  const normalizeDeep = (value) => {
    const seen = new WeakMap();
    const walk = (v, keyHint) => {
      const hint = String(keyHint || "");
      if (typeof v === "string") {
        const should = v.includes("__LOOKUP__") || hint.toLowerCase().includes("custom_");
        return should ? normalizeBubbleRef(v) : v;
      }
      if (!v || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.map((it) => walk(it, hint));
      if (seen.has(v)) return seen.get(v);
      const out = {};
      seen.set(v, out);
      for (const k of Object.keys(v)) out[k] = walk(v[k], k);
      return out;
    };
    return walk(value, "");
  };
  const scanForRecords = (root) => {
    const found = [];
    const seen = new WeakSet();
    const stack = [root];
    const max = 250000;
    let n = 0;
    while (stack.length) {
      const v = stack.pop();
      n += 1;
      if (n > max) break;
      if (!v || typeof v !== "object") continue;
      if (seen.has(v)) continue;
      seen.add(v);
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
        continue;
      }
      const obj = v;
      const id = String(obj._id ?? obj.unique_id ?? obj.id ?? "").trim();
      const type = String(obj._type ?? obj.type ?? "").trim();
      if (id && type) {
        const source = obj._source && typeof obj._source === "object" ? obj._source : obj;
        found.push({ _id: id, _type: type, _source: source, _normalized: normalizeDeep(source) });
      } else if (obj._source && typeof obj._source === "object") {
        const s = obj._source;
        const sid = String(obj._id ?? s._id ?? s.unique_id ?? s.id ?? "").trim();
        const st = String(obj._type ?? s._type ?? s.type ?? "").trim();
        if (sid && st) found.push({ _id: sid, _type: st, _source: s, _normalized: normalizeDeep(s) });
      }
      for (const k of Object.keys(obj)) {
        if (k === "_source") continue;
        stack.push(obj[k]);
      }
    }
    return found;
  };

  const state = {
    startedAt: nowIso(),
    responses: [],
    recordsByKey: new Map(),
    types: new Map(),
    captures: 0,
    recordsFound: 0,
    email: "",
    pending: 0,
    lastActivityAt: Date.now(),
    auto: { running: false, stop: false, detected: 0, visited: 0, errors: 0, phase: "" },
    pageFiles: {
      tab: "capture",
      history: [],
      selectedHistoryKey: "",
    },
    bubbleRequests: {
      mget: { items: [], seen: new Map(), lastAt: "" },
      msearch: { items: [], seen: new Map(), lastAt: "" },
      search: { items: [], seen: new Map(), lastAt: "" },
    },
    coverage: { selected: "", byKey: new Map() },
    recording: {
      running: false,
      startedAt: "",
      actions: [],
      lastUrl: location.href,
      lastNavAt: 0,
      lastModalAt: 0,
      lastModalKey: "",
      selectsCaptured: 0,
      dropdownsCaptured: 0,
      dropdownOptionsCaptured: 0,
      dropdownPending: null,
      dropdownLastKey: "",
      dropdownLastAt: 0,
    },
    replay: {
      running: false,
      stop: false,
      index: 0,
      total: 0,
      errors: 0,
      phase: "",
      lastError: "",
      recording: null,
      selectsReplayed: 0,
      dropdownsReplayed: 0,
      dropdownOptionsReplayed: 0,
    },
    replayScan: {
      running: false,
      stop: false,
      index: 0,
      total: 0,
      errors: 0,
      phase: "",
      module: "",
      list: "",
      itemsTotal: 0,
      itemIndex: 0,
      lastError: "",
      recording: null,
      selectsReplayed: 0,
      dropdownsReplayed: 0,
      dropdownOptionsReplayed: 0,
    },
  };

  const setActivity = () => {
    state.lastActivityAt = Date.now();
  };

  const hashString = (s) => {
    const str = String(s ?? "");
    let h = 5381;
    const max = Math.min(str.length, 200000);
    for (let i = 0; i < max; i += 1) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  };

  const normalizeBodyForKey = (body) => {
    try {
      if (body == null) return "";
      if (typeof body === "string") return body.trim();
      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
      if (typeof FormData !== "undefined" && body instanceof FormData) return "[formdata]";
      if (typeof Blob !== "undefined" && body instanceof Blob) return "[blob]";
      if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return "[arraybuffer]";
      if (typeof body === "object") return JSON.stringify(body);
      return String(body);
    } catch {
      return "";
    }
  };

  const bubbleKindFromUrl = (url) => {
    const u = String(url || "").toLowerCase();
    if (!u) return null;
    if (u.includes("/mget")) return "mget";
    if (u.includes("/msearch")) return "msearch";
    const idx = u.indexOf("/search");
    if (idx >= 0) {
      const after = u.slice(idx + "/search".length, idx + "/search".length + 1);
      if (!after || after === "?" || after === "#" || after === "/") return "search";
    }
    return null;
  };

  const extractResultCount = (json) => {
    try {
      if (!json) return 0;
      if (Array.isArray(json)) return json.length;
      if (Array.isArray(json.results)) return json.results.length;
      if (json.response && Array.isArray(json.response.results)) return json.response.results.length;
      if (json.data && Array.isArray(json.data.results)) return json.data.results.length;
      if (json.response && Array.isArray(json.response)) return json.response.length;
      return 0;
    } catch {
      return 0;
    }
  };

  const addBubbleRequest = (kind, payload) => {
    try {
      if (!kind) return;
      const k = String(kind);
      const bucket = state.bubbleRequests[k];
      if (!bucket) return;

      const ts = String(payload.timestamp || nowIso());
      const nowMs = Date.now();
      const url = String(payload.url || "");
      const method = String(payload.method || "GET").toUpperCase();
      const bodyNorm = normalizeBodyForKey(payload.body || "");
      const respText = String(payload.responseText || "");
      const respHash = hashString(respText);
      const reqKey = method + " " + url + " " + hashString(bodyNorm);

      const last = bucket.seen.get(reqKey);
      if (last && last.respHash === respHash && nowMs - Number(last.at || 0) < 2500) return;
      bucket.seen.set(reqKey, { at: nowMs, respHash });

      const item = {
        key: k + "::" + String(nowMs) + "::" + reqKey,
        kind: k,
        timestamp: ts,
        url,
        method,
        status: typeof payload.status === "number" ? payload.status : Number(payload.status || 0) || 0,
        body: bodyNorm,
        responseText: respText,
        responseJson: payload.responseJson ?? null,
        responseHash: respHash,
        records: extractResultCount(payload.responseJson),
      };

      bucket.items.push(item);
      if (bucket.items.length > 5000) bucket.items.splice(0, bucket.items.length - 5000);
      bucket.lastAt = ts;

      const h = state.pageFiles.history;
      h.push({ key: item.key, timestamp: item.timestamp, kind: item.kind, endpoint: item.url, records: item.records });
      if (h.length > 8000) h.splice(0, h.length - 8000);
    } catch {}
  };

  const bumpType = (type) => state.types.set(type, (state.types.get(type) || 0) + 1);
  const checklistModules = [
    { key: "empresas", label: "Empresas", required: true },
    { key: "usuarios", label: "Usuários", required: true },
    { key: "categorias", label: "Categorias", required: true },
    { key: "itens", label: "Itens", required: true },
    { key: "fornecedores", label: "Fornecedores", required: true },
    { key: "entradas", label: "Entradas (Notas)", required: true },
    { key: "itens_nota", label: "Itens da Nota", required: true },
    { key: "inventarios", label: "Inventários", required: true },
    { key: "itens_inventario", label: "Itens do Inventário", required: true },
    { key: "desperdicios", label: "Desperdícios", required: true },
    { key: "motivos_desperdicio", label: "Motivos de Desperdício", required: true },
    { key: "ingredientes", label: "Fichas Técnicas / Ingredientes", required: true },
    { key: "pre_preparo", label: "Pré-preparo", required: false },
    { key: "etiquetas", label: "Etiquetas", required: false },
    { key: "lista_compras", label: "Lista de Compras", required: false },
    { key: "compra_real", label: "Compra Real", required: false },
    { key: "cmv_real", label: "CMV Real", required: false },
  ];

  const moduleKeyFromType = (type) => {
    const t0 = String(type || "").trim();
    if (!t0) return null;
    const t = t0.toLowerCase();
    if (t === "user" || t === "users" || t.includes("user_profiles")) return "usuarios";
    if (t === "custom.empresas") return "empresas";
    if (t === "custom.categorias") return "categorias";
    if (t === "custom.itens" || t === "custom.item" || t === "custom.custo_medio_item") return "itens";
    if (t === "custom.fornecedores" || t === "custom.itens_fornecedores") return "fornecedores";
    if (t === "custom.notas_fiscais") return "entradas";
    if (t === "custom.itens_notas") return "itens_nota";
    if (t === "custom.inventarios") return "inventarios";
    if (t === "custom.itens_inventarios") return "itens_inventario";
    if (t === "custom.desperdicio" || t === "custom.desperdicios") return "desperdicios";
    if (t === "custom.motivos_desperdicios") return "motivos_desperdicio";
    if (t === "custom.ingredientes") return "ingredientes";
    if (t === "custom.etiquetas") return "etiquetas";
    if (t === "custom.itens_lista_compras") return "lista_compras";
    if (t === "custom.qtd_compra_real") return "compra_real";
    if (t === "custom.faturamentos") return "cmv_real";
    if (t.includes("pre_preparo") || t.includes("pre-preparo")) return "pre_preparo";
    if (t.includes("lista_compras") || t.includes("lista_de_compras")) return "lista_compras";
    if (t.includes("compra_real") || t.includes("qtd_compra_real")) return "compra_real";
    if (t.includes("cmv_real") || t.includes("faturamento") || t.includes("cmv")) return "cmv_real";
    return null;
  };

  const ensureCoverage = (key) => {
    if (!key) return null;
    if (!state.coverage.byKey.has(key)) state.coverage.byKey.set(key, { count: 0, lastCapturedAt: "", lastUrl: "", lastRecords: [] });
    return state.coverage.byKey.get(key);
  };

  const getCoverageCounts = () => {
    const out = {};
    for (const m of checklistModules) out[m.key] = 0;
    for (const m of checklistModules) {
      const st = state.coverage.byKey.get(m.key);
      if (st && st.count) out[m.key] = Number(st.count || 0);
    }
    return out;
  };

  const getCoverageMissing = () => {
    const counts = getCoverageCounts();
    const missingRequired = [];
    for (const m of checklistModules) if (m.required && !(Number(counts[m.key] || 0) > 0)) missingRequired.push(m);
    return { counts, missingRequired };
  };

  const addRecords = (records, meta) => {
    const capturedAt = meta && meta.capturedAt ? String(meta.capturedAt) : nowIso();
    const url = meta && meta.url ? String(meta.url) : String(location.href || "");
    for (const r of records) {
      const key = String(r._type) + "::" + String(r._id);
      if (!state.recordsByKey.has(key)) {
        state.recordsByKey.set(key, { _id: r._id, _type: r._type, _source: r._source, _normalized: r._normalized });
        bumpType(r._type);
        const mk = moduleKeyFromType(r._type);
        const c = ensureCoverage(mk);
        if (c) {
          c.count = Number(c.count || 0) + 1;
          c.lastCapturedAt = capturedAt;
          c.lastUrl = url;
          const last = Array.isArray(c.lastRecords) ? c.lastRecords : [];
          last.push({ _id: r._id, _type: r._type });
          if (last.length > 6) last.splice(0, last.length - 6);
          c.lastRecords = last;
        }
      }
    }
  };

  const el = (() => {
    const root = document.createElement("div");
    root.id = "__bubbleNetworkCapturePanel";
    root.style.position = "fixed";
    root.style.right = "12px";
    root.style.bottom = "12px";
    root.style.zIndex = "2147483647";
    root.style.width = "360px";
    root.style.background = "#111";
    root.style.color = "#fff";
    root.style.borderRadius = "12px";
    root.style.border = "1px solid rgba(255,255,255,0.15)";
    root.style.boxShadow = "0 12px 30px rgba(0,0,0,0.35)";
    root.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    root.style.fontSize = "12px";
    root.style.padding = "12px";
    root.innerHTML = \`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:700">Bubble Network Capture</div>
        <button data-action="close" style="background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px;line-height:14px;">×</button>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
        <button data-action="tab-capture" style="background:#0b57d0;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:999px;padding:6px 10px;cursor:pointer;">Captura</button>
        <button data-action="tab-history" style="background:#1b1b1b;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:999px;padding:6px 10px;cursor:pointer;">Histórico da página</button>
        <button data-action="clear" style="background:#fff;border:1px solid rgba(255,255,255,0.15);color:#111;border-radius:999px;padding:6px 10px;cursor:pointer;">🗑 Limpar captura</button>
      </div>

      <div data-k="tabCapture" style="margin-top:10px;">
        <div style="font-weight:700">ARQUIVOS DA PÁGINA</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          <button data-action="dl-mget" style="background:#0b57d0;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;">📥 Baixar mget</button>
          <button data-action="dl-msearch" style="background:#0b57d0;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;">📥 Baixar msearch</button>
          <button data-action="dl-search" style="background:#0b57d0;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;">📥 Baixar search</button>
          <button data-action="dl-all" style="background:#16a34a;border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer;">📥 Baixar Todos</button>
        </div>
        <div style="margin-top:10px;background:#1b1b1b;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px;">
          <div style="display:flex;justify-content:space-between;gap:10px;"><div>mget</div><div style="font-weight:700"><span data-k="mgetCount">0</span></div></div>
          <div style="color:#9ca3af;margin-top:2px;">Último: <span data-k="mgetLast">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;"><div>msearch</div><div style="font-weight:700"><span data-k="msearchCount">0</span></div></div>
          <div style="color:#9ca3af;margin-top:2px;">Último: <span data-k="msearchLast">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;"><div>search</div><div style="font-weight:700"><span data-k="searchCount">0</span></div></div>
          <div style="color:#9ca3af;margin-top:2px;">Último: <span data-k="searchLast">-</span></div>
        </div>
        <div style="margin-top:8px;color:#999">Requests pendentes: <span data-k="pending">0</span></div>
      </div>

      <div data-k="tabHistory" style="margin-top:10px;display:none;">
        <div style="font-weight:700">Histórico da página</div>
        <div style="margin-top:8px;max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:#1b1b1b;" data-k="historyList"></div>
        <div style="margin-top:8px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:#1b1b1b;padding:8px;white-space:pre-wrap;line-height:1.35;display:none;" data-k="historyDetail"></div>
      </div>

      <div style="margin-top:8px;color:#888">Não envia nada para servidor externo. Tudo local.</div>
    \`;
    document.documentElement.appendChild(root);
    return root;
  })();

  const render = () => {
    const tabCapture = el.querySelector('[data-k="tabCapture"]');
    const tabHistory = el.querySelector('[data-k="tabHistory"]');
    const pending = el.querySelector('[data-k="pending"]');
    const mgetCount = el.querySelector('[data-k="mgetCount"]');
    const mgetLast = el.querySelector('[data-k="mgetLast"]');
    const msearchCount = el.querySelector('[data-k="msearchCount"]');
    const msearchLast = el.querySelector('[data-k="msearchLast"]');
    const searchCount = el.querySelector('[data-k="searchCount"]');
    const searchLast = el.querySelector('[data-k="searchLast"]');
    const historyList = el.querySelector('[data-k="historyList"]');
    const historyDetail = el.querySelector('[data-k="historyDetail"]');

    const tab = String((state.pageFiles && state.pageFiles.tab) || "capture");
    if (tabCapture) tabCapture.style.display = tab === "history" ? "none" : "block";
    if (tabHistory) tabHistory.style.display = tab === "history" ? "block" : "none";

    if (pending) pending.textContent = String(state.pending || 0);

    const mget = state.bubbleRequests.mget;
    const msearch = state.bubbleRequests.msearch;
    const search = state.bubbleRequests.search;
    if (mgetCount) mgetCount.textContent = String((mget.items || []).length || 0);
    if (msearchCount) msearchCount.textContent = String((msearch.items || []).length || 0);
    if (searchCount) searchCount.textContent = String((search.items || []).length || 0);
    if (mgetLast) mgetLast.textContent = mget.lastAt ? String(mget.lastAt) : "-";
    if (msearchLast) msearchLast.textContent = msearch.lastAt ? String(msearch.lastAt) : "-";
    if (searchLast) searchLast.textContent = search.lastAt ? String(search.lastAt) : "-";

    if (historyList) {
      const items = Array.isArray(state.pageFiles.history) ? state.pageFiles.history : [];
      const selected = String(state.pageFiles.selectedHistoryKey || "");
      const view = items.slice(Math.max(0, items.length - 120)).reverse();
      const html = view
        .map((it) => {
          const isSel = String(it.key || "") === selected;
          const bg = isSel ? "#0b57d0" : "transparent";
          const border = isSel ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(255,255,255,0.08)";
          const time = String(it.timestamp || "").split("T").pop()?.replace("Z", "") || String(it.timestamp || "");
          const kind = String(it.kind || "");
          const ep = String(it.endpoint || "");
          const recs = Number(it.records || 0);
          return (
            '<div data-hist-key="' +
            String(it.key || "") +
            '" style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);background:' +
            bg +
            ";border-left:" +
            border +
            ';cursor:pointer;">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;"><div style="color:#e5e7eb;">' +
            kind +
            '</div><div style="color:#e5e7eb;font-weight:700;">' +
            String(recs) +
            "</div></div>" +
            '<div style="color:#9ca3af;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            time +
            " • " +
            ep +
            "</div>" +
            "</div>"
          );
        })
        .join("");
      historyList.innerHTML = html || '<div style="padding:10px;color:#9ca3af;">(sem histórico)</div>';
    }

    if (historyDetail) {
      const selected = String(state.pageFiles.selectedHistoryKey || "");
      if (!selected) {
        historyDetail.style.display = "none";
        historyDetail.textContent = "";
      } else {
        const buckets = [state.bubbleRequests.mget, state.bubbleRequests.msearch, state.bubbleRequests.search];
        let found = null;
        for (const b of buckets) {
          const list = Array.isArray(b.items) ? b.items : [];
          const it = list.find((x) => String(x.key || "") === selected);
          if (it) {
            found = it;
            break;
          }
        }
        historyDetail.style.display = "block";
        historyDetail.textContent = found ? JSON.stringify(found) : "(não encontrado)";
      }
    }
  };

  const getExport = () => {
    const typesObj = {};
    for (const [k, v] of state.types.entries()) typesObj[k] = v;
    const exportObj = {
      source: "bubble-network-capture",
      capturedAt: nowIso(),
      pageUrl: location.href,
      responses: state.responses,
      records: Array.from(state.recordsByKey.values()).map((r) => ({ _id: r._id, _type: r._type, _source: r._source, _normalized: r._normalized })),
      summary: { responses: state.responses.length, records: state.recordsByKey.size, types: typesObj },
    };
    return exportObj;
  };

  const download = () => {
    render();
    const cov = getCoverageMissing();
    if (cov.missingRequired.length) {
      try {
        alert("Export incompleto: faltando " + cov.missingRequired.map((m) => m.label).join(", "));
      } catch {}
    }
    const exportObj = getExport();
    const blob = new Blob([JSON.stringify(exportObj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const email = String(state.email || prompt("Email do cliente (para nome do arquivo):", "cliente") || "cliente").trim().toLowerCase();
    state.email = email;
    const safeEmail = email.replace(/[^a-z0-9._-]+/g, "_").slice(0, 80) || "cliente";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = \`bubble-network-export-\${safeEmail}-\${stamp}.json\`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const downloadExportAuto = () => {
    render();
    const cov = getCoverageMissing();
    if (cov.missingRequired.length) {
      try {
        alert("Export incompleto: faltando " + cov.missingRequired.map((m) => m.label).join(", "));
      } catch {}
    }
    const exportObj = getExport();
    const blob = new Blob([JSON.stringify(exportObj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bubble-network-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const downloadJson = (filename, obj) => {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportBubbleKind = (kind) => {
    const k = String(kind || "");
    const b = state.bubbleRequests[k];
    const items = b && Array.isArray(b.items) ? b.items : [];
    return {
      source: "bubble-" + k,
      capturedAt: nowIso(),
      pageUrl: location.href,
      requests: items.map((it) => ({
        timestamp: it.timestamp,
        url: it.url,
        method: it.method,
        status: it.status,
        body: it.body,
        responseText: it.responseText,
        responseJson: it.responseJson,
        responseHash: it.responseHash,
        records: it.records,
      })),
    };
  };

  const downloadBubbleKind = (kind) => {
    const k = String(kind || "");
    if (!k) return;
    const obj = exportBubbleKind(k);
    downloadJson("bubble-" + k + ".json", obj);
  };

  const downloadBubbleAll = () => {
    const obj = {
      source: "bubble-bundle",
      capturedAt: nowIso(),
      pageUrl: location.href,
      mget: exportBubbleKind("mget").requests,
      msearch: exportBubbleKind("msearch").requests,
      search: exportBubbleKind("search").requests,
    };
    downloadJson("bubble-bundle.json", obj);
  };

  const clear = () => {
    state.responses = [];
    state.recordsByKey.clear();
    state.types.clear();
    state.captures = 0;
    state.recordsFound = 0;
    try { state.coverage.selected = ""; } catch {}
    try { state.coverage.byKey.clear(); } catch {}
    try { state.pageFiles.tab = "capture"; } catch {}
    try { state.pageFiles.history = []; } catch {}
    try { state.pageFiles.selectedHistoryKey = ""; } catch {}
    try {
      for (const k of ["mget", "msearch", "search"]) {
        const b = state.bubbleRequests[k];
        if (!b) continue;
        b.items = [];
        b.seen.clear();
        b.lastAt = "";
      }
    } catch {}
    render();
  };

  const handleCapture = (meta, json) => {
    try {
      const records = scanForRecords(json);
      state.captures += 1;
      setActivity();
      state.responses.push({ url: meta.url, method: meta.method, status: meta.status, capturedAt: nowIso(), json });
      addRecords(records, { url: meta.url, capturedAt: nowIso() });
      render();
    } catch (e) {
      state.captures += 1;
      setActivity();
    }
  };

  const waitForNetworkIdle = async (timeoutMs, idleMs) => {
    const start = Date.now();
    const idle = typeof idleMs === "number" && idleMs >= 0 ? idleMs : 600;
    const timeout = typeof timeoutMs === "number" && timeoutMs >= 0 ? timeoutMs : 10000;
    while (Date.now() - start < timeout) {
      if (state.pending <= 0 && Date.now() - state.lastActivityAt >= idle) return true;
      await sleep(120);
    }
    return false;
  };

  const isVisible = (node) => {
    try {
      if (!node || !(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
      const st = window.getComputedStyle(node);
      if (!st) return false;
      if (st.display === "none" || st.visibility === "hidden") return false;
      if (Number(st.opacity || "1") <= 0.02) return false;
      return true;
    } catch {
      return false;
    }
  };

  const elementLabel = (node) => {
    try {
      if (!node || !(node instanceof Element)) return "";
      const a = (node.getAttribute("aria-label") || "").trim();
      if (a) return a;
      const t = (node.getAttribute("title") || "").trim();
      if (t) return t;
      const it = (node.innerText || "").trim();
      return it;
    } catch {
      return "";
    }
  };

  const isDangerous = (node) => {
    const text = elementLabel(node).toLowerCase();
    if (!text) return false;
    const bad = [
      "excluir",
      "apagar",
      "remover",
      "delete",
      "trash",
      "lixeira",
      "cancelar assinatura",
      "salvar",
      "save",
      "editar",
      "edit",
    ];
    return bad.some((w) => text.includes(w));
  };

  const isClickable = (node) => {
    try {
      if (!node || !(node instanceof Element)) return false;
      if (node.closest("#__bubbleNetworkCapturePanel")) return false;
      if (node.disabled) return false;
      const ariaDis = String(node.getAttribute("aria-disabled") || "").toLowerCase();
      if (ariaDis === "true") return false;
      const tag = node.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || tag === "option") return false;
      if (tag === "button") {
        const type = String(node.type || "").toLowerCase();
        if (type === "submit") return false;
      }
      if (node.closest("form") && tag === "button") {
        const type = String(node.type || "").toLowerCase();
        if (!type || type === "submit") return false;
      }
      if (isDangerous(node)) return false;
      const role = String(node.getAttribute("role") || "").toLowerCase();
      const tabindex = node.getAttribute("tabindex");
      if (tag === "a") return true;
      if (tag === "button") return true;
      if (role === "button") return true;
      if (tabindex != null && tabindex !== "-1") return true;
      if (node.hasAttribute("onclick")) return true;
      const st = window.getComputedStyle(node);
      if (st && st.cursor === "pointer") return true;
      return false;
    } catch {
      return false;
    }
  };

  const findClickTargets = () => {
    const candidates = [];
    const seen = new Set();

    const push = (target) => {
      if (!target) return;
      if (!isVisible(target)) return;
      if (!isClickable(target)) return;
      if (isDangerous(target)) return;
      const rect = target.getBoundingClientRect();
      const label = elementLabel(target).slice(0, 80);
      const key =
        String(target.tagName) +
        ":" +
        String(Math.round(rect.top)) +
        ":" +
        String(Math.round(rect.left)) +
        ":" +
        String(Math.round(rect.width)) +
        ":" +
        String(Math.round(rect.height)) +
        ":" +
        String(label);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(target);
    };

    const nodes = Array.from(document.querySelectorAll('a[href],button,[role="button"],[onclick],[tabindex]'));
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      let target = node;
      try {
        const parent = node.closest('a[href],button,[role="button"],[onclick],[tabindex]');
        if (parent) target = parent;
      } catch {}
      push(target);
    }

    const pickClickableFromPoint = (x, y) => {
      let elp = null;
      try {
        elp = document.elementFromPoint(x, y);
      } catch {
        elp = null;
      }
      if (!elp || !(elp instanceof Element)) return null;
      if (elp.closest("#__bubbleNetworkCapturePanel")) return null;
      let cur = elp;
      for (let i = 0; i < 7; i += 1) {
        if (!cur || !(cur instanceof Element)) break;
        if (cur.closest("#__bubbleNetworkCapturePanel")) return null;
        const tag = cur.tagName.toLowerCase();
        const role = String(cur.getAttribute("role") || "").toLowerCase();
        const tabindex = cur.getAttribute("tabindex");
        const st = window.getComputedStyle(cur);
        const cursorPointer = Boolean(st && st.cursor === "pointer");
        const matches = tag === "a" || tag === "button" || role === "button" || (tabindex != null && tabindex !== "-1") || cur.hasAttribute("onclick") || cursorPointer;
        if (matches && isClickable(cur) && !isDangerous(cur) && isVisible(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    };

    const w = window.innerWidth || 0;
    const h = window.innerHeight || 0;
    const cols = 5;
    const rows = 6;
    const marginX = 24;
    const marginY = 24;
    if (w > 200 && h > 200) {
      for (let ry = 0; ry < rows; ry += 1) {
        for (let cx = 0; cx < cols; cx += 1) {
          const x = Math.round(marginX + ((w - marginX * 2) * (cx + 0.5)) / cols);
          const y = Math.round(marginY + ((h - marginY * 2) * (ry + 0.5)) / rows);
          const pick = pickClickableFromPoint(x, y);
          if (pick) push(pick);
        }
      }
    }

    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    return candidates;
  };

  const pressEscape = () => {
    try {
      const down = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
      const up = new KeyboardEvent("keyup", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
      document.dispatchEvent(down);
      document.dispatchEvent(up);
    } catch {}
  };

  const tryCloseOverlay = async () => {
    pressEscape();
    await sleep(120);
    const closers = Array.from(document.querySelectorAll('button,[role="button"],a[href],[tabindex]')).filter((n) => {
      if (!isVisible(n)) return false;
      if (n.closest("#__bubbleNetworkCapturePanel")) return false;
      const txt = elementLabel(n).trim().toLowerCase();
      if (!txt) return false;
      if (txt === "x" || txt === "×") return true;
      if (txt.includes("fechar")) return true;
      if (txt.includes("close")) return true;
      return false;
    });
    const pick = closers[0] ?? null;
    if (!pick) return false;
    try {
      pick.scrollIntoView({ block: "center", inline: "center" });
    } catch {}
    try {
      pick.click();
      await sleep(180);
      return true;
    } catch {
      return false;
    }
  };

  const findLoadMore = () => {
    const opts = ["carregar mais", "load more", "ver mais", "mais", "próxima", "proxima", "next", ">"];
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],a[href],[tabindex]'));
    const visible = nodes.filter((n) => isVisible(n) && isClickable(n) && !isDangerous(n));
    for (const n of visible) {
      const txt = elementLabel(n).trim().toLowerCase();
      if (!txt) continue;
      if (opts.some((o) => txt === o || txt.includes(o))) return n;
    }
    return null;
  };

  const autoCapturePage = async () => {
    if (state.auto.running) return;
    state.auto.running = true;
    state.auto.stop = false;
    state.auto.detected = 0;
    state.auto.visited = 0;
    state.auto.errors = 0;
    state.auto.phase = "Escaneando";
    render();

    try {
      let round = 0;
      let lastTotalVisited = -1;
      while (!state.auto.stop && round < 60) {
        round += 1;
        state.auto.phase = "Itens visíveis";
        const items = findClickTargets();
        state.auto.detected = items.length;
        render();

        const startHref = location.href;
        for (let i = 0; i < items.length; i += 1) {
          if (state.auto.stop) break;
          const it = items[i];
          if (!isVisible(it) || !isClickable(it)) continue;
          const beforeHref = location.href;
          state.auto.phase = "Abrindo " + String(Math.min(items.length, i + 1)) + "/" + String(items.length);
          state.auto.visited += 1;
          render();

          try {
            try {
              it.scrollIntoView({ block: "center", inline: "center" });
              await sleep(120);
            } catch {}
            it.click();
            setActivity();
            await waitForNetworkIdle(10000, 650);
            await sleep(220);
            await tryCloseOverlay();
            if (location.href !== beforeHref && location.href !== startHref) {
              try {
                history.back();
              } catch {}
              await sleep(420);
              await waitForNetworkIdle(10000, 650);
            }
          } catch (err) {
            state.auto.errors += 1;
            render();
          }
        }

        if (state.auto.stop) break;
        if (state.auto.visited === lastTotalVisited) break;
        lastTotalVisited = state.auto.visited;

        state.auto.phase = "Paginação";
        render();
        const more = findLoadMore();
        if (!more) {
          state.auto.phase = "Rolando";
          render();
          try {
            window.scrollBy(0, Math.max(260, Math.floor(window.innerHeight * 0.7)));
          } catch {}
          setActivity();
          await waitForNetworkIdle(10000, 650);
          await sleep(250);
          continue;
        }
        try {
          more.scrollIntoView({ block: "center", inline: "center" });
        } catch {}
        try {
          more.click();
          setActivity();
          await waitForNetworkIdle(10000, 650);
          await sleep(250);
        } catch {
          break;
        }
      }
    } finally {
      state.auto.phase = "";
      state.auto.running = false;
      render();
    }
  };

  const stopAutoCapture = () => {
    state.auto.stop = true;
    render();
  };

  const clampText = (value, maxLen) => {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const max = typeof maxLen === "number" && maxLen > 0 ? maxLen : 120;
    return s.length > max ? s.slice(0, max) : s;
  };

  const safeClassList = (el) => {
    try {
      if (!el || !(el instanceof Element)) return "";
      const raw = String(el.className || "").trim();
      if (!raw) return "";
      const parts = raw
        .split(/\s+/g)
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => !x.includes(":") && !x.includes("/") && x.length <= 40)
        .filter((x) => !/^css-[a-z0-9]+$/i.test(x))
        .slice(0, 6);
      return parts.join(" ");
    } catch {
      return "";
    }
  };

  const cssSelectorFor = (el) => {
    try {
      if (!el || !(el instanceof Element)) return "";
      if (el.id) return "#" + CSS.escape(String(el.id));
      const parts = [];
      let cur = el;
      for (let depth = 0; depth < 6; depth += 1) {
        if (!cur || !(cur instanceof Element)) break;
        if (cur.id) {
          parts.unshift(cur.tagName.toLowerCase() + "#" + CSS.escape(String(cur.id)));
          break;
        }
        const tag = cur.tagName.toLowerCase();
        const cls = safeClassList(cur)
          .split(/\s+/g)
          .filter(Boolean)
          .slice(0, 3)
          .map((c) => "." + CSS.escape(c))
          .join("");
        let nth = "";
        try {
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((x) => x && x.tagName && String(x.tagName).toLowerCase() === tag);
            if (siblings.length >= 2) {
              const idx = siblings.indexOf(cur);
              nth = idx >= 0 ? ":nth-of-type(" + String(idx + 1) + ")" : "";
            }
          }
        } catch {}
        parts.unshift(tag + cls + nth);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    } catch {
      return "";
    }
  };

  const elementInfo = (el) => {
    try {
      if (!el || !(el instanceof Element)) return null;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const bbox = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 };
      const text = clampText(elementLabel(el), 120);
      const nearText = (() => {
        const bits = [];
        try {
          const parent = el.parentElement;
          if (parent) bits.push(clampText(parent.innerText || "", 120));
        } catch {}
        try {
          const prev = el.previousElementSibling;
          if (prev) bits.push(clampText(prev.innerText || "", 120));
        } catch {}
        try {
          const next = el.nextElementSibling;
          if (next) bits.push(clampText(next.innerText || "", 120));
        } catch {}
        const joined = bits.filter(Boolean).join(" • ");
        return clampText(joined, 160);
      })();
      return {
        text,
        selector: cssSelectorFor(el),
        bbox,
        elementTag: String(el.tagName || "").toLowerCase(),
        elementRole: String(el.getAttribute("role") || ""),
        elementClasses: safeClassList(el),
        elementId: String(el.id || ""),
        nearText,
      };
    } catch {
      return null;
    }
  };

  const pushAction = (action) => {
    if (!state.recording.running) return;
    const list = state.recording.actions || [];
    list.push(action);
    if (list.length > 5000) list.splice(0, list.length - 5000);
    state.recording.actions = list;
    render();
  };

  const recordNavigation = (fromUrl, toUrl) => {
    const from = String(fromUrl ?? "");
    const to = String(toUrl ?? "");
    if (!from || !to || from === to) return;
    const now = Date.now();
    if (now - (state.recording.lastNavAt || 0) < 120) return;
    state.recording.lastNavAt = now;
    pushAction({ type: "navigation", timestamp: nowIso(), fromUrl: from, toUrl: to });
  };

  const getRecordingExport = () => {
    const typesObj = {};
    for (const [k, v] of state.types.entries()) typesObj[k] = v;
    const actions = Array.isArray(state.recording.actions) ? state.recording.actions : [];
    return {
      source: "bubble-navigation-recording",
      capturedAt: nowIso(),
      pageUrl: location.href,
      actions,
      responses: state.responses,
      records: Array.from(state.recordsByKey.values()).map((r) => ({ _id: r._id, _type: r._type, _source: r._source, _normalized: r._normalized })),
      summary: { actions: actions.length, responses: state.responses.length, records: state.recordsByKey.size, types: typesObj },
    };
  };

  const downloadRecording = () => {
    const exportObj = getRecordingExport();
    const blob = new Blob([JSON.stringify(exportObj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const email = String(state.email || prompt("Email do cliente (para nome do arquivo):", "cliente") || "cliente").trim().toLowerCase();
    state.email = email;
    const safeEmail = email.replace(/[^a-z0-9._-]+/g, "_").slice(0, 80) || "cliente";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = "bubble-navigation-recording-" + safeEmail + "-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const lastInputByEl = new WeakMap();

  const isDropdownMenuRoot = (node) => {
    try {
      if (!node || !(node instanceof Element)) return false;
      const role = String(node.getAttribute("role") || "").toLowerCase();
      if (role === "listbox" || role === "menu" || role === "tree") return true;
      if (String(node.getAttribute("aria-modal") || "").toLowerCase() === "true") return false;
      return false;
    } catch {
      return false;
    }
  };

  const findVisibleDropdownMenus = () => {
    const nodes = Array.from(document.querySelectorAll("[role='listbox'],[role='menu'],[role='tree']"));
    return nodes.filter((n) => isVisible(n) && !n.closest("#__bubbleNetworkCapturePanel"));
  };

  const extractDropdownOptions = (menuRoot) => {
    try {
      if (!menuRoot || !(menuRoot instanceof Element)) return [];
      const nodes = Array.from(menuRoot.querySelectorAll("[role='option'],[role='menuitem'],button,a,[tabindex],li,div,span"));
      const opts = [];
      const seen = new Set();
      for (const n of nodes) {
        if (!(n instanceof Element)) continue;
        if (!isVisible(n)) continue;
        if (n.closest("#__bubbleNetworkCapturePanel")) continue;
        const txt = clampText(elementLabel(n), 120);
        if (!txt) continue;
        const info = elementInfo(n);
        if (!info) continue;
        const key = String(info.selector || "") + "::" + txt;
        if (seen.has(key)) continue;
        seen.add(key);
        opts.push({ text: txt, selector: info.selector, bbox: info.bbox, role: String(n.getAttribute("role") || "") });
        if (opts.length >= 60) break;
      }
      return opts;
    } catch {
      return [];
    }
  };

  const onDocClick = (ev) => {
    try {
      if (!state.recording.running) return;
      const t = ev && ev.target ? ev.target : null;
      if (!t || !(t instanceof Element)) return;
      if (t.closest("#__bubbleNetworkCapturePanel")) return;
      const menu = t.closest("[role='listbox'],[role='menu'],[role='tree']");
      const role = String(t.getAttribute("role") || "").toLowerCase();
      const isOpt = role === "option" || role === "menuitem" || (menu && (t.matches("[role='option'],[role='menuitem']") || t.closest("[role='option'],[role='menuitem']")));
      if (isOpt) {
        const optEl = t.closest("[role='option'],[role='menuitem']") || t;
        const info = elementInfo(optEl);
        if (!info) return;
        state.recording.dropdownOptionsCaptured = Number(state.recording.dropdownOptionsCaptured || 0) + 1;
        pushAction({
          type: "dropdown_option",
          timestamp: nowIso(),
          url: location.href,
          text: info.text,
          selector: info.selector,
          bbox: info.bbox,
          nearText: info.nearText,
          elementTag: info.elementTag,
          elementRole: info.elementRole,
        });
        return;
      }

      const el0 = t.closest("button,a,input,textarea,select,[role='button'],[onclick],[tabindex]") || t;
      const info = elementInfo(el0);
      if (!info) return;
      const elRole = String(el0.getAttribute("role") || "").toLowerCase();
      const hasPopup = String(el0.getAttribute("aria-haspopup") || "").toLowerCase();
      const ariaExpanded = String(el0.getAttribute("aria-expanded") || "").toLowerCase();
      const looksDropdown =
        elRole === "combobox" ||
        hasPopup === "true" ||
        hasPopup === "listbox" ||
        hasPopup === "menu" ||
        ariaExpanded === "true" ||
        info.elementClasses.toLowerCase().includes("dropdown") ||
        info.elementClasses.toLowerCase().includes("select") ||
        info.elementClasses.toLowerCase().includes("combo");
      if (looksDropdown) {
        state.recording.dropdownPending = { at: Date.now(), trigger: info };
      }
      pushAction({
        type: "click",
        timestamp: nowIso(),
        url: location.href,
        text: info.text,
        selector: info.selector,
        path: info.selector,
        bbox: info.bbox,
        nearText: info.nearText,
        elementTag: info.elementTag,
        elementRole: info.elementRole,
        elementClasses: info.elementClasses,
        elementId: info.elementId,
      });
    } catch {}
  };

  const onDocInput = (ev) => {
    try {
      if (!state.recording.running) return;
      const t = ev && ev.target ? ev.target : null;
      if (!t || !(t instanceof Element)) return;
      if (t.closest("#__bubbleNetworkCapturePanel")) return;
      const tag = String(t.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
      const value = (() => {
        try {
          if (tag === "select") return clampText(t.value ?? "", 250);
          const type = String(t.getAttribute("type") || "").toLowerCase();
          if (type === "password") return "";
          if (type === "checkbox" || type === "radio") return String(Boolean(t.checked));
          return clampText(t.value ?? "", 250);
        } catch {
          return "";
        }
      })();
      const prev = lastInputByEl.get(t) || { value: null, at: 0 };
      const now = Date.now();
      if (prev.value === value && now - (prev.at || 0) < 800) return;
      if (now - (prev.at || 0) < 200) return;
      lastInputByEl.set(t, { value, at: now });
      if (tag === "select") {
        const info = elementInfo(t);
        const options = (() => {
          try {
            const arr = [];
            const opts = t.options ? Array.from(t.options) : [];
            for (const o of opts) {
              arr.push({ value: String(o.value ?? ""), text: clampText(o.text ?? "", 120) });
              if (arr.length >= 120) break;
            }
            return arr;
          } catch {
            return [];
          }
        })();
        let selectedIndex = -1;
        let selectedText = "";
        try {
          selectedIndex = typeof t.selectedIndex === "number" ? t.selectedIndex : -1;
          const opt = t.options && selectedIndex >= 0 ? t.options[selectedIndex] : null;
          selectedText = opt ? clampText(opt.text ?? "", 120) : "";
        } catch {}
        state.recording.selectsCaptured = Number(state.recording.selectsCaptured || 0) + 1;
        pushAction({
          type: "select",
          timestamp: nowIso(),
          url: location.href,
          selector: info ? info.selector : cssSelectorFor(t),
          value,
          selectedIndex,
          selectedText,
          options,
          bbox: info ? info.bbox : { x: 0, y: 0, width: 0, height: 0 },
          nearText: info ? info.nearText : "",
        });
        return;
      }
      pushAction({
        type: "input",
        timestamp: nowIso(),
        url: location.href,
        value,
        placeholder: String(t.getAttribute("placeholder") || ""),
        selector: cssSelectorFor(t),
      });
    } catch {}
  };

  const detectDropdownOpen = () => {
    try {
      if (!state.recording.running) return;
      const pending = state.recording.dropdownPending;
      if (!pending || !pending.at || !pending.trigger) return;
      if (Date.now() - Number(pending.at) > 1200) return;
      const menus = findVisibleDropdownMenus();
      const pick = menus[0] ?? null;
      if (!pick) return;
      const info = elementInfo(pick);
      if (!info) return;
      const key = String(info.selector || "") + "::" + String(clampText(pick.innerText || "", 80));
      const now = Date.now();
      if (key && key === state.recording.dropdownLastKey && now - (state.recording.dropdownLastAt || 0) < 1200) return;
      state.recording.dropdownLastKey = key;
      state.recording.dropdownLastAt = now;
      state.recording.dropdownPending = null;
      state.recording.dropdownsCaptured = Number(state.recording.dropdownsCaptured || 0) + 1;
      pushAction({
        type: "dropdown_open",
        timestamp: nowIso(),
        url: location.href,
        trigger: pending.trigger,
        menu: { selector: info.selector, bbox: info.bbox, role: info.elementRole },
        options: extractDropdownOptions(pick),
      });
    } catch {}
  };

  const detectModalOpen = () => {
    try {
      if (!state.recording.running) return;
      const nodes = Array.from(document.querySelectorAll("[role='dialog'],[aria-modal='true'],.modal,.popup,[class*='modal'],[class*='popup']"));
      const visible = nodes.filter((n) => isVisible(n) && !n.closest("#__bubbleNetworkCapturePanel"));
      const pick = visible[0] ?? null;
      if (!pick) return;
      const info = elementInfo(pick);
      if (!info) return;
      const key = String(info.selector || "") + "::" + String(info.text || "");
      const now = Date.now();
      if (key && key === state.recording.lastModalKey && now - (state.recording.lastModalAt || 0) < 1500) return;
      state.recording.lastModalKey = key;
      state.recording.lastModalAt = now;
      pushAction({
        type: "modal_open",
        timestamp: nowIso(),
        url: location.href,
        text: info.text,
        selector: info.selector,
        bbox: info.bbox,
        nearText: info.nearText,
        elementTag: info.elementTag,
        elementRole: info.elementRole,
        elementClasses: info.elementClasses,
        elementId: info.elementId,
      });
    } catch {}
  };

  let recObserver = null;
  let recUrlPoll = null;
  const origPushState = history.pushState ? history.pushState.bind(history) : null;
  const origReplaceState = history.replaceState ? history.replaceState.bind(history) : null;

  const startRecording = () => {
    if (state.recording.running) return;
    state.recording.running = true;
    state.recording.startedAt = nowIso();
    state.recording.lastUrl = location.href;
    state.recording.lastNavAt = 0;
    state.recording.lastModalAt = 0;
    state.recording.lastModalKey = "";
    if (!Array.isArray(state.recording.actions)) state.recording.actions = [];

    try {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("input", onDocInput, true);
      document.addEventListener("change", onDocInput, true);
      window.addEventListener("popstate", () => recordNavigation(state.recording.lastUrl, location.href), true);
      window.addEventListener("hashchange", () => recordNavigation(state.recording.lastUrl, location.href), true);
    } catch {}

    try {
      if (origPushState) {
        history.pushState = function (...args) {
          const from = location.href;
          const res = origPushState(...args);
          const to = location.href;
          recordNavigation(from, to);
          state.recording.lastUrl = to;
          return res;
        };
      }
      if (origReplaceState) {
        history.replaceState = function (...args) {
          const from = location.href;
          const res = origReplaceState(...args);
          const to = location.href;
          recordNavigation(from, to);
          state.recording.lastUrl = to;
          return res;
        };
      }
    } catch {}

    try {
      recObserver = new MutationObserver(() => {
        detectModalOpen();
        detectDropdownOpen();
      });
      recObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch {
      recObserver = null;
    }

    try {
      recUrlPoll = setInterval(() => {
        if (!state.recording.running) return;
        const href = String(location.href || "");
        const prev = String(state.recording.lastUrl || "");
        if (prev && href && href !== prev) {
          recordNavigation(prev, href);
          state.recording.lastUrl = href;
        }
      }, 400);
    } catch {
      recUrlPoll = null;
    }

    render();
  };

  const stopRecording = () => {
    state.recording.running = false;
    try { document.removeEventListener("click", onDocClick, true); } catch {}
    try { document.removeEventListener("input", onDocInput, true); } catch {}
    try { document.removeEventListener("change", onDocInput, true); } catch {}
    try { if (recObserver) recObserver.disconnect(); } catch {}
    recObserver = null;
    try { if (recUrlPoll) clearInterval(recUrlPoll); } catch {}
    recUrlPoll = null;
    try { if (origPushState) history.pushState = origPushState; } catch {}
    try { if (origReplaceState) history.replaceState = origReplaceState; } catch {}
    render();
  };

  const clickElementLikeUser = (el) => {
    try {
      if (!el || !(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
      try { el.dispatchEvent(new MouseEvent("mouseover", opts)); } catch {}
      try { el.dispatchEvent(new MouseEvent("mousemove", opts)); } catch {}
      try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch {}
      try { el.dispatchEvent(new MouseEvent("mouseup", opts)); } catch {}
      try { el.dispatchEvent(new MouseEvent("click", opts)); } catch {}
      try { el.click(); } catch {}
      return true;
    } catch {
      return false;
    }
  };

  const setInputValueLikeUser = (el, value) => {
    try {
      if (!el || !(el instanceof Element)) return false;
      const tag = String(el.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
      try { el.focus(); } catch {}
      try {
        if (tag === "select") {
          el.value = String(value ?? "");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      } catch {}
      try {
        const type = String(el.getAttribute("type") || "").toLowerCase();
        if (type === "checkbox" || type === "radio") {
          const want = String(value ?? "").toLowerCase();
          const checked = want === "1" || want === "true" || want === "sim" || want === "yes" || want === "on";
          el.checked = checked;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      } catch {}
      try {
        el.value = String(value ?? "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch {}
      return false;
    } catch {
      return false;
    }
  };

  const isVisibleNow = (node) => isVisible(node);

  const pickReplayTarget = (action) => {
    const sel = String((action && action.selector) || "").trim();
    if (sel) {
      try {
        const found = document.querySelector(sel);
        if (found && isVisibleNow(found)) return found;
      } catch {}
    }
    const bbox = action && action.bbox ? action.bbox : null;
    if (bbox && typeof bbox.x === "number") {
      const x = Math.round(Number(bbox.x) + Number(bbox.width || 0) / 2);
      const y = Math.round(Number(bbox.y) + Number(bbox.height || 0) / 2);
      try {
        const elp = document.elementFromPoint(x, y);
        if (elp && elp instanceof Element) {
          const pick = elp.closest("button,a,input,textarea,select,[role='button'],[onclick],[tabindex]") || elp;
          if (pick && isVisibleNow(pick)) return pick;
        }
      } catch {}
    }
    const text = clampText((action && action.text) || "", 80).toLowerCase();
    if (text) {
      try {
        const nodes = Array.from(document.querySelectorAll("button,a,[role='button'],[onclick],[tabindex]")).filter((n) => isVisibleNow(n));
        for (const n of nodes) {
          const t = clampText(elementLabel(n), 80).toLowerCase();
          if (t && t === text) return n;
        }
        for (const n of nodes) {
          const t = clampText(elementLabel(n), 80).toLowerCase();
          if (t && t.includes(text)) return n;
        }
      } catch {}
    }
    return null;
  };

  const findVisibleDropdownOptionByText = (text) => {
    try {
      const want = clampText(text || "", 120).toLowerCase();
      if (!want) return null;
      const menus = findVisibleDropdownMenus();
      for (const menu of menus) {
        const nodes = Array.from(menu.querySelectorAll("[role='option'],[role='menuitem'],button,a,[tabindex],li,div,span")).filter((n) => isVisibleNow(n));
        for (const n of nodes) {
          const t = clampText(elementLabel(n), 120).toLowerCase();
          if (t && t === want) return n;
        }
        for (const n of nodes) {
          const t = clampText(elementLabel(n), 120).toLowerCase();
          if (t && t.includes(want)) return n;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const waitForUrl = async (targetUrl, timeoutMs) => {
    const start = Date.now();
    const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 8000;
    const want = String(targetUrl ?? "");
    while (Date.now() - start < timeout) {
      const cur = String(location.href || "");
      if (cur === want) return true;
      await sleep(120);
    }
    return false;
  };

  const softNavigate = async (toUrl) => {
    const from = String(location.href || "");
    const to = String(toUrl || "");
    if (!to || to === from) return true;
    if (await waitForUrl(to, 1200)) return true;
    try {
      history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}
    if (await waitForUrl(to, 1200)) return true;
    return false;
  };

  const pickJsonFile = () => {
    return new Promise((resolve) => {
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.style.position = "fixed";
        input.style.left = "-10000px";
        input.style.top = "-10000px";
        document.body.appendChild(input);
        input.addEventListener("change", () => {
          const file = input.files && input.files[0] ? input.files[0] : null;
          try { input.remove(); } catch {}
          resolve(file);
        });
        input.click();
      } catch {
        resolve(null);
      }
    });
  };

  const readFileText = (file) => {
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsText(file);
      } catch {
        resolve("");
      }
    });
  };

  const startReplay = async (recording) => {
    if (state.replay.running) return;
    state.replay.running = true;
    state.replay.stop = false;
    state.replay.errors = 0;
    state.replay.lastError = "";
    state.replay.index = 0;
    state.replay.phase = "Preparando";
    state.replay.recording = recording || null;
    const actions = recording && Array.isArray(recording.actions) ? recording.actions : [];
    state.replay.total = actions.length;
    render();

    try {
      const email = String(state.email || "").trim().toLowerCase();
      if (!email) {
        const e = String(prompt("Email do cliente (para export):", "cliente") || "").trim().toLowerCase();
        if (e) state.email = e;
      }

      for (let i = 0; i < actions.length; i += 1) {
        if (state.replay.stop) break;
        state.replay.index = i + 1;
        const a = actions[i] || {};
        const type = String(a.type || "").trim().toLowerCase();
        try {
          if (type === "navigation") {
            state.replay.phase = "Navegando";
            render();
            await softNavigate(a.toUrl);
            await waitForNetworkIdle(12000, 650);
            await sleep(180);
            continue;
          }
          if (type === "select") {
            state.replay.phase = "Select";
            render();
            const target = pickReplayTarget(a);
            if (target && target instanceof Element) {
              try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              await sleep(60);
              let ok = false;
              const tag = String(target.tagName || "").toLowerCase();
              if (tag === "select") {
                const value = String(a.value ?? "");
                if (value) {
                  ok = setInputValueLikeUser(target, value);
                } else if (a.selectedText) {
                  try {
                    const want = String(a.selectedText || "").trim().toLowerCase();
                    const opts = target.options ? Array.from(target.options) : [];
                    const match = opts.find((o) => String(o.text || "").trim().toLowerCase() === want) || opts.find((o) => String(o.text || "").trim().toLowerCase().includes(want));
                    if (match) ok = setInputValueLikeUser(target, String(match.value ?? ""));
                  } catch {}
                } else if (typeof a.selectedIndex === "number" && a.selectedIndex >= 0) {
                  try {
                    const idx = Number(a.selectedIndex);
                    const opt = target.options && target.options[idx] ? target.options[idx] : null;
                    if (opt) ok = setInputValueLikeUser(target, String(opt.value ?? ""));
                  } catch {}
                }
              }
              if (!ok) {
                try {
                  clickElementLikeUser(target);
                  await sleep(120);
                  const optByText = findVisibleDropdownOptionByText(a.selectedText || a.value || a.text || "");
                  if (optByText) {
                    clickElementLikeUser(optByText);
                    ok = true;
                  }
                } catch {}
              }
              if (!ok) {
                state.replay.errors += 1;
                state.replay.lastError = "select_failed";
              } else {
                state.replay.selectsReplayed = Number(state.replay.selectsReplayed || 0) + 1;
              }
            } else {
              state.replay.errors += 1;
              state.replay.lastError = "select_target_not_found";
            }
            await waitForNetworkIdle(12000, 650);
            await sleep(160);
            continue;
          }
          if (type === "dropdown_open") {
            state.replay.phase = "Dropdown";
            render();
            const trig = a.trigger ? a.trigger : a;
            const target = pickReplayTarget(trig);
            if (target) {
              try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              await sleep(60);
              clickElementLikeUser(target);
              state.replay.dropdownsReplayed = Number(state.replay.dropdownsReplayed || 0) + 1;
              const start = Date.now();
              while (Date.now() - start < 2200) {
                if (findVisibleDropdownMenus().length) break;
                await sleep(60);
              }
            } else {
              state.replay.errors += 1;
              state.replay.lastError = "dropdown_trigger_not_found";
            }
            await waitForNetworkIdle(12000, 650);
            await sleep(120);
            continue;
          }
          if (type === "dropdown_option") {
            state.replay.phase = "Opção";
            render();
            const wantText = a.text || a.value || "";
            const opt = findVisibleDropdownOptionByText(wantText);
            if (opt) {
              try { opt.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              await sleep(40);
              clickElementLikeUser(opt);
              state.replay.dropdownOptionsReplayed = Number(state.replay.dropdownOptionsReplayed || 0) + 1;
            } else {
              state.replay.errors += 1;
              state.replay.lastError = "dropdown_option_not_found";
            }
            await waitForNetworkIdle(12000, 650);
            await sleep(160);
            continue;
          }
          if (type === "click") {
            state.replay.phase = "Clicando";
            render();
            const target = pickReplayTarget(a);
            if (target) {
              try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              await sleep(80);
              clickElementLikeUser(target);
            } else {
              state.replay.errors += 1;
              state.replay.lastError = "click_target_not_found";
            }
            await waitForNetworkIdle(12000, 650);
            await sleep(160);
            continue;
          }
          if (type === "input") {
            state.replay.phase = "Preenchendo";
            render();
            const target = pickReplayTarget(a);
            if (target) {
              try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
              await sleep(80);
              const ok = setInputValueLikeUser(target, a.value);
              if (!ok) {
                state.replay.errors += 1;
                state.replay.lastError = "input_failed";
              }
            } else {
              state.replay.errors += 1;
              state.replay.lastError = "input_target_not_found";
            }
            await waitForNetworkIdle(12000, 650);
            await sleep(160);
            continue;
          }
        } catch (err) {
          state.replay.errors += 1;
          state.replay.lastError = err && err.message ? String(err.message) : String(err);
        }
      }
    } finally {
      state.replay.phase = "";
      state.replay.running = false;
      render();
      try {
        downloadExportAuto();
      } catch {}
    }
  };

  const stopReplay = () => {
    state.replay.stop = true;
    state.replayScan.stop = true;
    render();
  };

  const rowSignature = (row) => {
    try {
      if (!row || !(row instanceof Element)) return "";
      const tag = String(row.tagName || "").toLowerCase();
      const cls = safeClassList(row)
        .split(/\s+/g)
        .filter(Boolean)
        .slice(0, 3)
        .join(".");
      return tag + (cls ? "." + cls : "");
    } catch {
      return "";
    }
  };

  const findListContextFromClickAction = (clickAction) => {
    try {
      const target = pickReplayTarget(clickAction);
      if (!target || !(target instanceof Element)) return null;
      if (!isVisibleNow(target)) return null;
      if (isDangerous(target)) return null;

      let best = null;
      let cur = target;
      for (let depth = 0; depth < 8; depth += 1) {
        if (!cur || !(cur instanceof Element)) break;
        const parent = cur.parentElement;
        if (!parent) break;
        const sig = rowSignature(cur);
        if (!sig) {
          cur = parent;
          continue;
        }
        const siblings = Array.from(parent.children).filter((x) => x && x instanceof Element && isVisibleNow(x) && rowSignature(x) === sig);
        if (siblings.length >= 4) {
          best = { row: cur, container: parent, signature: sig };
          break;
        }
        cur = parent;
      }
      if (!best) return null;

      const rel = [];
      let node = target;
      let row = best.row;
      while (node && node !== row && rel.length < 10) {
        const p = node.parentElement;
        if (!p) break;
        const idx = Array.from(p.children).indexOf(node);
        rel.push(idx);
        node = p;
      }
      rel.reverse();

      const containerSel = cssSelectorFor(best.container);
      const rowSel = cssSelectorFor(best.row);
      return {
        listUrl: String(clickAction && clickAction.url ? clickAction.url : location.href),
        containerSel,
        rowSel,
        signature: best.signature,
        relPath: rel,
      };
    } catch {
      return null;
    }
  };

  const resolveListContainer = (ctx) => {
    try {
      if (!ctx || !ctx.containerSel) return null;
      const el0 = document.querySelector(String(ctx.containerSel));
      if (el0 && el0 instanceof Element) return el0;
      return null;
    } catch {
      return null;
    }
  };

  const findRowsInContext = (ctx) => {
    try {
      const cont = resolveListContainer(ctx);
      if (!cont) return [];
      const rows = Array.from(cont.children).filter((x) => x && x instanceof Element && isVisibleNow(x) && rowSignature(x) === ctx.signature);
      return rows;
    } catch {
      return [];
    }
  };

  const pickRowClickTarget = (row, ctx) => {
    try {
      if (!row || !(row instanceof Element)) return null;
      let node = row;
      const rel = Array.isArray(ctx.relPath) ? ctx.relPath : [];
      for (const idx of rel) {
        if (!node || !(node instanceof Element)) break;
        const kids = Array.from(node.children);
        const child = kids[idx];
        if (!child || !(child instanceof Element)) break;
        node = child;
      }
      if (node && node !== row) {
        const pick = node.closest("button,a,[role='button'],[onclick],[tabindex]") || node;
        if (pick && pick instanceof Element && isVisibleNow(pick) && !isDangerous(pick)) return pick;
      }
      const fallback = row.querySelector("button,a,[role='button'],[onclick],[tabindex]");
      if (fallback && fallback instanceof Element && isVisibleNow(fallback) && !isDangerous(fallback)) return fallback;
      return null;
    } catch {
      return null;
    }
  };

  const loadAllListRows = async (ctx) => {
    let stable = 0;
    let lastCount = -1;
    for (let round = 0; round < 60; round += 1) {
      if (state.replayScan.stop) break;
      const rows = findRowsInContext(ctx);
      const count = rows.length;
      if (count === lastCount) stable += 1;
      else stable = 0;
      lastCount = count;
      if (stable >= 3) break;
      const more = findLoadMore();
      if (more) {
        try { more.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(80);
        try { clickElementLikeUser(more); } catch {}
        setActivity();
        await waitForNetworkIdle(10000, 650);
        await sleep(180);
        continue;
      }
      try { window.scrollBy(0, Math.max(320, Math.floor(window.innerHeight * 0.8))); } catch {}
      setActivity();
      await waitForNetworkIdle(10000, 650);
      await sleep(120);
    }
  };

  const capturePageSnapshot = () => {
    try {
      const roots = [];
      try {
        const w = window;
        const keys = Object.keys(w)
          .map((k) => String(k || ""))
          .filter((k) => {
            const lk = k.toLowerCase();
            if (!lk) return false;
            if (lk.includes("bubble")) return true;
            if (lk === "app" || lk === "application") return true;
            if (lk.includes("app_")) return true;
            return false;
          })
          .slice(0, 25);
        for (const k of keys) {
          let v = null;
          try {
            v = w[k];
          } catch {
            v = null;
          }
          if (!v || typeof v !== "object") continue;
          roots.push(v);
        }
      } catch {}

      for (const root of roots) {
        try {
          const recs = scanForRecords(root);
          addRecords(recs, { url: String(location.href || ""), capturedAt: nowIso() });
        } catch {}
      }
      render();
    } catch {}
  };

  const isBackLike = (a) => {
    const txt = clampText((a && a.text) || "", 80).toLowerCase();
    const near = clampText((a && a.nearText) || "", 80).toLowerCase();
    if (txt.includes("voltar") || txt.includes("back") || txt.includes("retornar")) return true;
    if (near.includes("voltar") || near.includes("back") || near.includes("retornar")) return true;
    if (txt === "←" || txt === "<") return true;
    return false;
  };

  const findScanBlockEnd = (actions, idx) => {
    const listUrl = String(actions[idx] && actions[idx].url ? actions[idx].url : "");
    for (let j = idx + 1; j < actions.length; j += 1) {
      const a = actions[j] || {};
      const t = String(a.type || "").toLowerCase();
      if (t === "navigation" && String(a.toUrl || "") === listUrl) return j;
      if (t === "click" && isBackLike(a)) return j;
      if (j - idx >= 18) break;
    }
    return Math.min(actions.length - 1, idx + 10);
  };

  const waitForListVisible = async (ctx, timeoutMs) => {
    const start = Date.now();
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 10000;
    while (Date.now() - start < timeout) {
      if (state.replayScan.stop) return false;
      const rows = findRowsInContext(ctx);
      if (rows.length) return true;
      await sleep(120);
    }
    return false;
  };

  const runWithTimeout = async (fn, timeoutMs) => {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 10000;
    return await Promise.race([
      Promise.resolve().then(fn).then(() => ({ ok: true })),
      sleep(timeout).then(() => ({ ok: false, error: "timeout" })),
    ]);
  };

  const runScanAction = async (a) => {
    const type = String(a.type || "").trim().toLowerCase();
    if (type === "navigation") {
      state.replayScan.phase = "Navegando";
      render();
      await softNavigate(a.toUrl);
      await waitForNetworkIdle(12000, 650);
      await sleep(160);
      capturePageSnapshot();
      return;
    }
    if (type === "select") {
      state.replayScan.phase = "Select";
      render();
      const target = pickReplayTarget(a);
      let ok = false;
      if (target && target instanceof Element) {
        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(60);
        const tag = String(target.tagName || "").toLowerCase();
        if (tag === "select") {
          const value = String(a.value ?? "");
          if (value) ok = setInputValueLikeUser(target, value);
          else if (a.selectedText) {
            try {
              const want = String(a.selectedText || "").trim().toLowerCase();
              const opts = target.options ? Array.from(target.options) : [];
              const match = opts.find((o) => String(o.text || "").trim().toLowerCase() === want) || opts.find((o) => String(o.text || "").trim().toLowerCase().includes(want));
              if (match) ok = setInputValueLikeUser(target, String(match.value ?? ""));
            } catch {}
          }
        }
        if (!ok) {
          try {
            clickElementLikeUser(target);
            await sleep(120);
            const optByText = findVisibleDropdownOptionByText(a.selectedText || a.value || a.text || "");
            if (optByText) {
              clickElementLikeUser(optByText);
              ok = true;
            }
          } catch {}
        }
      }
      if (!ok) {
        state.replayScan.errors += 1;
        state.replayScan.lastError = "select_failed";
      } else {
        state.replayScan.selectsReplayed = Number(state.replayScan.selectsReplayed || 0) + 1;
      }
      await waitForNetworkIdle(12000, 650);
      await sleep(160);
      return;
    }
    if (type === "dropdown_open") {
      state.replayScan.phase = "Dropdown";
      render();
      const trig = a.trigger ? a.trigger : a;
      const target = pickReplayTarget(trig);
      if (target) {
        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(60);
        clickElementLikeUser(target);
        state.replayScan.dropdownsReplayed = Number(state.replayScan.dropdownsReplayed || 0) + 1;
        const start = Date.now();
        while (Date.now() - start < 2200) {
          if (findVisibleDropdownMenus().length) break;
          await sleep(60);
        }
      } else {
        state.replayScan.errors += 1;
        state.replayScan.lastError = "dropdown_trigger_not_found";
      }
      await waitForNetworkIdle(12000, 650);
      await sleep(120);
      return;
    }
    if (type === "dropdown_option") {
      state.replayScan.phase = "Opção";
      render();
      const wantText = a.text || a.value || "";
      const opt = findVisibleDropdownOptionByText(wantText);
      if (opt) {
        try { opt.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(40);
        clickElementLikeUser(opt);
        state.replayScan.dropdownOptionsReplayed = Number(state.replayScan.dropdownOptionsReplayed || 0) + 1;
      } else {
        state.replayScan.errors += 1;
        state.replayScan.lastError = "dropdown_option_not_found";
      }
      await waitForNetworkIdle(12000, 650);
      await sleep(160);
      return;
    }
    if (type === "click") {
      state.replayScan.phase = "Clicando";
      render();
      const target = pickReplayTarget(a);
      if (target) {
        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(60);
        if (!isDangerous(target)) clickElementLikeUser(target);
      } else {
        state.replayScan.errors += 1;
        state.replayScan.lastError = "click_target_not_found";
      }
      await waitForNetworkIdle(12000, 650);
      await sleep(160);
      return;
    }
    if (type === "input") {
      state.replayScan.phase = "Preenchendo";
      render();
      const target = pickReplayTarget(a);
      if (target) {
        try { target.scrollIntoView({ block: "center", inline: "center" }); } catch {}
        await sleep(60);
        const ok = setInputValueLikeUser(target, a.value);
        if (!ok) {
          state.replayScan.errors += 1;
          state.replayScan.lastError = "input_failed";
        }
      } else {
        state.replayScan.errors += 1;
        state.replayScan.lastError = "input_target_not_found";
      }
      await waitForNetworkIdle(12000, 650);
      await sleep(160);
      return;
    }
  };

  const startReplayScan = async (recording) => {
    if (state.replayScan.running) return;
    state.replayScan.running = true;
    state.replayScan.stop = false;
    state.replayScan.errors = 0;
    state.replayScan.lastError = "";
    state.replayScan.index = 0;
    state.replayScan.phase = "Preparando";
    state.replayScan.module = "";
    state.replayScan.list = "";
    state.replayScan.itemsTotal = 0;
    state.replayScan.itemIndex = 0;
    state.replayScan.recording = recording || null;
    state.replayScan.selectsReplayed = 0;
    state.replayScan.dropdownsReplayed = 0;
    state.replayScan.dropdownOptionsReplayed = 0;
    const actions = recording && Array.isArray(recording.actions) ? recording.actions : [];
    state.replayScan.total = actions.length;
    render();

    try {
      const email = String(state.email || "").trim().toLowerCase();
      if (!email) {
        const e = String(prompt("Email do cliente (para export):", "cliente") || "").trim().toLowerCase();
        if (e) state.email = e;
      }

      let i = 0;
      while (i < actions.length) {
        if (state.replayScan.stop) break;
        state.replayScan.index = i + 1;
        const a = actions[i] || {};
        const type = String(a.type || "").trim().toLowerCase();
        state.replayScan.module = String((location.pathname || "") + (location.hash || "")).slice(0, 60);
        render();

        if (type === "click") {
          const ctx = findListContextFromClickAction(a);
          if (ctx) {
            const blockEnd = findScanBlockEnd(actions, i);
            state.replayScan.phase = "Varredura";
            state.replayScan.list = String(ctx.containerSel || "").slice(0, 60);
            render();
            if (ctx.listUrl && String(location.href || "") !== String(ctx.listUrl)) {
              await softNavigate(ctx.listUrl);
              await waitForNetworkIdle(12000, 650);
              await sleep(220);
            }
            capturePageSnapshot();
            await loadAllListRows(ctx);
            capturePageSnapshot();
            state.replayScan.itemsTotal = findRowsInContext(ctx).length;
            state.replayScan.itemIndex = 0;
            render();

            for (let k = 0; k < state.replayScan.itemsTotal; k += 1) {
              if (state.replayScan.stop) break;
              const rowsNow = findRowsInContext(ctx);
              if (rowsNow.length > state.replayScan.itemsTotal) state.replayScan.itemsTotal = rowsNow.length;
              state.replayScan.itemIndex = k + 1;
              render();

              const row = rowsNow[k];
              if (!row) break;
              const res = await runWithTimeout(async () => {
                const clickTarget = pickRowClickTarget(row, ctx);
                if (!clickTarget) throw new Error("list_item_target_not_found");
                try { clickTarget.scrollIntoView({ block: "center", inline: "center" }); } catch {}
                await sleep(80);
                clickElementLikeUser(clickTarget);
                setActivity();
                await waitForNetworkIdle(12000, 650);
                await sleep(160);

                for (let j = i + 1; j <= blockEnd; j += 1) {
                  if (state.replayScan.stop) break;
                  await runScanAction(actions[j] || {});
                }

                await tryCloseOverlay();
                const okBack = await waitForListVisible(ctx, 9000);
                if (!okBack) {
                  try { history.back(); } catch {}
                  await waitForNetworkIdle(12000, 650);
                  await waitForListVisible(ctx, 9000);
                }
                capturePageSnapshot();
              }, 10000);
              if (!res.ok) {
                state.replayScan.errors += 1;
                state.replayScan.lastError = String(res.error || "item_failed");
                render();
                try { await tryCloseOverlay(); } catch {}
                try { await waitForListVisible(ctx, 2500); } catch {}
              }
            }

            i = blockEnd + 1;
            continue;
          }
        }

        try {
          await runScanAction(a);
        } catch (err) {
          state.replayScan.errors += 1;
          state.replayScan.lastError = err && err.message ? String(err.message) : String(err);
        }
        i += 1;
      }
    } finally {
      state.replayScan.phase = "";
      state.replayScan.running = false;
      render();
      try {
        downloadExportAuto();
      } catch {}
    }
  };

  const replayScanFromFile = async () => {
    if (state.replayScan.running) return;
    state.replayScan.phase = "Carregando arquivo";
    render();
    const file = await pickJsonFile();
    if (!file) {
      state.replayScan.phase = "";
      render();
      return;
    }
    const txt = await readFileText(file);
    let parsed = null;
    try { parsed = JSON.parse(String(txt || "")); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object") {
      alert("Arquivo inválido (JSON).");
      state.replayScan.phase = "";
      render();
      return;
    }
    const src = String(parsed.source || "");
    if (src !== "bubble-navigation-recording") {
      alert("Arquivo não é bubble-navigation-recording.");
      state.replayScan.phase = "";
      render();
      return;
    }
    const acts = Array.isArray(parsed.actions) ? parsed.actions : [];
    state.replayScan.recording = { source: src, actions: acts, pageUrl: String(parsed.pageUrl || ""), capturedAt: String(parsed.capturedAt || "") };
    state.replayScan.phase = "";
    render();
    await startReplayScan(state.replayScan.recording);
  };

  const replayFromFile = async () => {
    if (state.replay.running) return;
    state.replay.phase = "Carregando arquivo";
    render();
    const file = await pickJsonFile();
    if (!file) {
      state.replay.phase = "";
      render();
      return;
    }
    const txt = await readFileText(file);
    let parsed = null;
    try { parsed = JSON.parse(String(txt || "")); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object") {
      alert("Arquivo inválido (JSON).");
      state.replay.phase = "";
      render();
      return;
    }
    const src = String(parsed.source || "");
    if (src !== "bubble-navigation-recording") {
      alert("Arquivo não é bubble-navigation-recording.");
      state.replay.phase = "";
      render();
      return;
    }
    const acts = Array.isArray(parsed.actions) ? parsed.actions : [];
    state.replay.recording = { source: src, actions: acts, pageUrl: String(parsed.pageUrl || ""), capturedAt: String(parsed.capturedAt || "") };
    state.replay.phase = "";
    render();
    await startReplay(state.replay.recording);
  };

  const shouldIgnoreByContentType = (ct) => {
    const s = String(ct || "").toLowerCase();
    if (!s) return false;
    if (s.includes("text/css")) return true;
    if (s.includes("text/html")) return true;
    if (s.includes("image/")) return true;
    if (s.includes("font/")) return true;
    if (s.includes("application/javascript")) return true;
    if (s.includes("text/javascript")) return true;
    if (s.includes("application/x-javascript")) return true;
    if (s.includes("application/octet-stream")) return true;
    return false;
  };

  const tryParseJsonText = (txt) => {
    const s = String(txt || "");
    const t = s.trimStart();
    if (!t) return null;
    const first = t[0];
    if (first !== "{" && first !== "[") return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const req = args[0];
    const init = args[1] || {};
    const method = (init && init.method) ? String(init.method).toUpperCase() : (req && req.method ? String(req.method).toUpperCase() : "GET");
    const url = typeof req === "string" ? req : (req && req.url ? String(req.url) : "");
    const kind = bubbleKindFromUrl(url);
    const body = normalizeBodyForKey(init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : "");
    state.pending += 1;
    setActivity();
    render();
    const res = await origFetch(...args).finally(() => {
      state.pending = Math.max(0, (state.pending || 0) - 1);
      render();
    });
    try {
      if (!kind) return res;
      const ct = (res.headers && res.headers.get) ? String(res.headers.get("content-type") || "") : "";
      if (!shouldIgnoreByContentType(ct)) {
        const capturedAt = nowIso();
        res.clone().text().then((txt) => {
          const parsed = tryParseJsonText(txt);
          addBubbleRequest(kind, { timestamp: capturedAt, url, method, status: res.status, body, responseText: txt, responseJson: parsed });
          render();
        });
      }
    } catch {}
    return res;
  };

  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  XHR.prototype.open = function (method, url, ...rest) {
    try {
      this.__bn_method = String(method || "GET").toUpperCase();
      this.__bn_url = String(url || "");
      this.__bn_body = "";
    } catch {}
    return origOpen.call(this, method, url, ...rest);
  };
  XHR.prototype.send = function (...args) {
    try {
      try {
        this.__bn_body = normalizeBodyForKey(args && args.length ? args[0] : "");
      } catch {}
      state.pending += 1;
      setActivity();
      render();
      const dec = () => {
        state.pending = Math.max(0, (state.pending || 0) - 1);
        render();
      };
      this.addEventListener("loadend", () => {
        try {
          dec();
        } catch {}
      });
      this.addEventListener("load", () => {
        try {
          const url = this.__bn_url || "";
          const method = this.__bn_method || "GET";
          const kind = bubbleKindFromUrl(url);
          if (!kind) return;
          const ct = String(this.getResponseHeader("content-type") || "");
          if (shouldIgnoreByContentType(ct)) return;
          const txt = String(this.responseText || "");
          const parsed = tryParseJsonText(txt);
          addBubbleRequest(kind, { timestamp: nowIso(), url, method, status: this.status, body: this.__bn_body || "", responseText: txt, responseJson: parsed });
          render();
        } catch {}
      });
    } catch {}
    return origSend.apply(this, args);
  };

  el.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    if (btn) {
      const action = btn.getAttribute("data-action");
      if (action === "clear") clear();
      if (action === "tab-capture") {
        state.pageFiles.tab = "capture";
        render();
      }
      if (action === "tab-history") {
        state.pageFiles.tab = "history";
        render();
      }
      if (action === "dl-mget") downloadBubbleKind("mget");
      if (action === "dl-msearch") downloadBubbleKind("msearch");
      if (action === "dl-search") downloadBubbleKind("search");
      if (action === "dl-all") downloadBubbleAll();
      if (action === "close") {
        window.__bubbleNetworkCapture.stop();
      }
      return;
    }
    const row = e.target && e.target.closest ? e.target.closest("[data-hist-key]") : null;
    if (row) {
      const key = String(row.getAttribute("data-hist-key") || "");
      state.pageFiles.selectedHistoryKey = state.pageFiles.selectedHistoryKey === key ? "" : key;
      render();
    }
  });

  const stop = () => {
    stopAutoCapture();
    stopRecording();
    stopReplay();
    try { window.fetch = origFetch; } catch {}
    try { XHR.prototype.open = origOpen; } catch {}
    try { XHR.prototype.send = origSend; } catch {}
    try { el.remove(); } catch {}
  };

  window.__bubbleNetworkCapture = {
    stop,
    clear,
    exportBubbleKind,
    downloadBubbleKind,
    downloadBubbleAll,
    state,
  };
  render();
})();`;
  }, []);

  const bubbleNetworkBookmarklet = useMemo(() => {
    const oneLine = String(bubbleNetworkConsoleSnippet ?? "")
      .replace(/\r?\n/g, "")
      .trim();
    const withoutTrailingSemicolon = oneLine.endsWith(";") ? oneLine.slice(0, -1) : oneLine;
    return `javascript:${withoutTrailingSemicolon}`;
  }, [bubbleNetworkConsoleSnippet]);

  const moduleKeyForTable = (table: string) => {
    const t = String(table ?? "").trim().toLowerCase();
    if (!t) return null;
    if (t === "companies" || t === "user_profiles" || t === "company_members") return "empresas";
    if (t === "categories") return "categorias";
    if (t === "items" || t === "avg_cost_events") return "itens";
    if (t === "suppliers" || t === "supplier_items") return "fornecedores";
    if (t === "invoices" || t === "invoice_items") return "entradas";
    if (t === "inventories" || t === "inventory_items") return "inventario";
    if (t === "waste_reasons" || t === "wastes" || t === "labels") return "desperdicios";
    if (t === "recipe_ingredients") return "receitas";
    if (t === "shopping_list_items" || t === "purchase_real_qty" || t === "revenues") return "lista_de_compras";
    return null;
  };

  const networkSummary = useMemo(() => {
    if (!analysisNetwork?.ok) return [];
    const rows = analysisNetwork.plan.byTable ?? [];
    const byModule = new Map<
      string,
      { moduleKey: string; label: string; sourceRows: number; plannedRows: number; wouldCreate: number; wouldUpdate: number; wouldIgnore: number; errors: number }
    >();
    const labelByModule: Record<string, string> = Object.fromEntries(networkModuleOptions.map((o) => [o.key, o.label]));
    for (const t of rows) {
      const mk = moduleKeyForTable(t.table);
      if (!mk) continue;
      if (!networkModules[mk]) continue;
      const cur =
        byModule.get(mk) ??
        ({
          moduleKey: mk,
          label: labelByModule[mk] ?? mk,
          sourceRows: 0,
          plannedRows: 0,
          wouldCreate: 0,
          wouldUpdate: 0,
          wouldIgnore: 0,
          errors: 0,
        } as any);
      cur.sourceRows += Number(t.sourceRows ?? 0) || 0;
      cur.plannedRows += Number(t.plannedRows ?? 0) || 0;
      cur.wouldCreate += Number(t.wouldCreate ?? 0) || 0;
      cur.wouldUpdate += Number(t.wouldUpdate ?? 0) || 0;
      cur.wouldIgnore += Number(t.wouldIgnore ?? 0) || 0;
      if (t.reason) cur.errors += cur.plannedRows;
      byModule.set(mk, cur);
    }
    return Array.from(byModule.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [analysisNetwork, networkModuleOptions, networkModules]);

  async function resolveUser() {
    setResolveError("");
    setResolved(null);
    setAnalysis(null);
    setAnalysisNetwork(null);
    setApplyNetworkResult(null);
    setApplyNetworkError("");
    setApplyResult(null);
    setApplyError("");
    setWipeResult(null);
    setWipeError("");

    const target = normalizeSpace(email).toLowerCase();
    if (!target || !target.includes("@")) {
      setResolveError("Email inválido.");
      return;
    }
    if (target.endsWith("@gmail.cor")) {
      setResolveError("Email inválido. Parece que está com “@gmail.cor”. Verifique se não é “@gmail.com”.");
      return;
    }
    setIsResolving(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);
      let res: Response | null = null;
      try {
        res = await fetch("/api/admin/importacao-manual/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: target }),
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error && (err as any)?.name === "AbortError" ? "Tempo esgotado ao buscar usuário/empresa." : String(err instanceof Error ? err.message : err);
        setResolveError(msg || "Falha ao resolver usuário/empresa.");
        return;
      } finally {
        clearTimeout(timeout);
      }
      const rawText = await res.text().catch(() => "");
      const json = rawText ? (JSON.parse(rawText) as any) : null;
      if (!res.ok || !json?.ok) {
        const rawMsg = String(json?.error ?? "").trim();
        const msg =
          rawMsg === "supabase_rest_timeout"
            ? "Supabase REST não está respondendo (timeout). Verifique o status do projeto e tente novamente."
            : rawMsg === "supabase_rest_unhealthy"
              ? "Supabase REST está indisponível (schema cache). Verifique o status do projeto e tente novamente."
              : rawMsg === "company_members_timeout" || rawMsg === "companies_timeout"
                ? "Supabase está lento para carregar vínculos da empresa. Tente novamente em alguns segundos."
              : rawMsg;
        setResolveError(msg || `Falha ao resolver usuário/empresa (HTTP ${res.status}).`);
        return;
      }
      setResolved(json.user as ResolvedUser);
    } finally {
      setIsResolving(false);
    }
  }

  async function analyze() {
    setAnalysisError("");
    setAnalysis(null);
    setApplyResult(null);
    setApplyError("");
    setWipeResult(null);
    setWipeError("");

    if (!resolved?.companyId) {
      setAnalysisError("Selecione um usuário/empresa primeiro.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: "auto", text: pasted }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao analisar dados.");
        setAnalysisError(msg);
        return;
      }
      setAnalysis(json.result as AnalyzeResult);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function analyzeNetworkJson() {
    setAnalysisNetworkError("");
    setAnalysisNetwork(null);
    setAnalysisError("");
    setAnalysis(null);
    setApplyNetworkResult(null);
    setApplyNetworkError("");
    setApplyResult(null);
    setApplyError("");
    setWipeResult(null);
    setWipeError("");

    if (!resolved?.companyId) {
      setAnalysisNetworkError("Selecione um usuário/empresa primeiro.");
      return;
    }
    setIsAnalyzingNetwork(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/analyze-network-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, action: "append", text: pastedNetworkJson }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao analisar JSONs.");
        setAnalysisNetworkError(msg);
        return;
      }
      setAnalysisNetwork(json.result as NetworkAnalyzeResult);
      setNetworkTab("preview");
      setNetworkAck(false);
    } finally {
      setIsAnalyzingNetwork(false);
    }
  }

  async function validateNetworkIntegrity() {
    setAnalysisNetworkError("");
    if (!resolved?.companyId) {
      setAnalysisNetworkError("Selecione um usuário/empresa primeiro.");
      return;
    }
    setIsAnalyzingNetwork(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/analyze-network-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, action: "validate", text: "" }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao validar integridade.");
        setAnalysisNetworkError(msg);
        return;
      }
      setAnalysisNetwork(json.result as NetworkAnalyzeResult);
      setNetworkTab("integridade");
    } finally {
      setIsAnalyzingNetwork(false);
    }
  }

  async function resetNetworkSession() {
    setAnalysisNetworkError("");
    setApplyNetworkError("");
    setApplyNetworkResult(null);
    if (!resolved?.companyId) {
      setAnalysisNetworkError("Selecione um usuário/empresa primeiro.");
      return;
    }
    if (!window.confirm("Reiniciar sessão de importação (JSON de rede)?\n\nIsso vai limpar os registros analisados salvos para esta empresa.")) return;
    setIsAnalyzingNetwork(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/analyze-network-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, action: "reset", text: "" }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao reiniciar sessão.");
        setAnalysisNetworkError(msg);
        return;
      }
      setAnalysisNetwork(json.result as NetworkAnalyzeResult);
      setNetworkTab("preview");
      setNetworkAck(false);
      setPastedNetworkJson("");
    } finally {
      setIsAnalyzingNetwork(false);
    }
  }

  async function loadNetworkJsonFile(file: File) {
    setAnalysisNetworkError("");
    setNetworkFileInfo({ name: file.name, size: file.size });
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => resolve("");
      reader.readAsText(file);
    });
    if (!text.trim()) {
      setAnalysisNetworkError("Arquivo vazio ou não foi possível ler.");
      return;
    }
    setPastedNetworkJson(text);
  }

  async function analyzeBubbleCsv() {
    setAnalysisCsvError("");
    setAnalysisCsv(null);
    setCsvRelationOverrides({});
    setApplyCsvResult(null);
    setApplyCsvError("");
    setCsvAudit(null);
    setCsvAuditError("");
    setAnalysisNetworkError("");
    setAnalysisNetwork(null);
    setApplyNetworkError("");
    setApplyNetworkResult(null);
    setApplyError("");
    setApplyResult(null);
    setWipeResult(null);
    setWipeError("");

    const emailToUse = (resolved?.email ?? normalizeSpace(email)).toLowerCase();
    if (!emailToUse || !emailToUse.includes("@")) {
      setAnalysisCsvError("Email inválido.");
      return;
    }
    if (!csvFiles.length) {
      setAnalysisCsvError("Selecione pelo menos um CSV.");
      return;
    }
    setIsAnalyzingCsv(true);
    try {
      const fd = new FormData();
      fd.set("email", emailToUse);
      fd.set("companyId", resolved?.companyId ?? "");
      for (const f of csvFiles) fd.append("files", f, f.name);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      let res: Response | null = null;
      try {
        res = await fetch("/api/admin/importacao-manual/analyze-bubble-csv", { method: "POST", body: fd, signal: controller.signal });
      } catch (err) {
        const msg = err instanceof Error && (err as any)?.name === "AbortError" ? "Tempo esgotado ao analisar CSVs." : String(err instanceof Error ? err.message : err);
        setAnalysisCsvError(msg || "Falha ao analisar CSVs.");
        return;
      } finally {
        clearTimeout(timeout);
      }
      const rawText = await res.text().catch(() => "");
      const json = rawText ? (JSON.parse(rawText) as any) : null;
      if (!res.ok || !json?.ok) {
        const msg = String(json?.error ?? "").trim();
        setAnalysisCsvError(msg || `Falha ao analisar CSVs (HTTP ${res.status}).`);
        return;
      }
      const parsed = json as CsvAnalyzeResult;
      setAnalysisCsv(parsed);
      setCsvRelationOverrides({});
      if (!resolved?.companyId && parsed?.companyId) {
        setResolved({
          userId: "",
          email: parsed.email,
          companyId: parsed.companyId,
          companyName: parsed.derivedCompany?.companyName ?? null,
          memberships: [],
        });
      }
      setCsvStep(2);
    } finally {
      setIsAnalyzingCsv(false);
    }
  }

  async function applyBubbleCsv() {
    setApplyCsvError("");
    setApplyCsvResult(null);
    setCsvAudit(null);
    setCsvAuditError("");
    setApplyNetworkError("");
    setApplyNetworkResult(null);
    setApplyError("");
    setApplyResult(null);

    const emailToUse = (resolved?.email ?? analysisCsv?.email ?? normalizeSpace(email)).toLowerCase();
    const companyIdToUse = resolved?.companyId ?? analysisCsv?.companyId ?? "";
    if (!companyIdToUse) {
      setApplyCsvError("Rode “Analisar CSVs” primeiro (ou selecione um usuário/empresa).");
      return;
    }
    if (!analysisCsv?.ok) {
      setApplyCsvError("Rode “Analisar CSVs” primeiro.");
      return;
    }
    if (csvHasCritical) {
      setApplyCsvError(`Execução bloqueada por erros críticos: ${csvCriticalReasons.join(" • ")}`);
      return;
    }
    if (!analysisCsv.recordsForApply.length) {
      setApplyCsvError("Nenhum registro analisado para aplicar.");
      return;
    }
    setCsvStep(4);
    const progressKey = (globalThis.crypto as any)?.randomUUID?.() ? (globalThis.crypto as any).randomUUID() : `csv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setCsvProgressKey(progressKey);
    setCsvProgress(null);
    setIsApplyingCsv(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/apply-network-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: emailToUse,
          companyId: companyIdToUse,
          records: analysisCsv.recordsForApply,
          progressKey,
          sourceMode: "bubble_csv",
          relationOverrides: csvRelationOverrides,
        }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao aplicar importação.");
        setApplyCsvError(msg);
        return;
      }
      const result = json.result as NetworkApplyResult;
      setApplyCsvResult(result);
      try {
        const expectedByTable = Object.fromEntries((analysisCsv.plan?.byTable ?? []).map((t) => [t.table, t.sourceRows]));
        const r2 = await fetch("/api/admin/importacao-manual/audit-company", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: emailToUse, companyId: companyIdToUse, expectedByTable }),
        }).catch(() => null);
        const j2 = r2 ? await r2.json().catch(() => null) : null;
        if (r2?.ok && j2?.ok) setCsvAudit(j2 as AuditCompanyResult);
        else setCsvAuditError(String(j2?.error ?? "Falha ao auditar no Supabase."));
      } catch {
        setCsvAuditError("Falha ao auditar no Supabase.");
      }
    } finally {
      setIsApplyingCsv(false);
    }
  }

  async function applyNetworkJson() {
    setApplyNetworkError("");
    setApplyNetworkResult(null);
    setApplyError("");
    setApplyResult(null);
    if (!resolved?.companyId) {
      setApplyNetworkError("Selecione um usuário/empresa primeiro.");
      return;
    }
    if (!analysisNetwork?.ok) {
      setApplyNetworkError("Rode “Analisar JSONs” primeiro.");
      return;
    }
    if (!analysisNetwork.recordsForApply.length) {
      setApplyNetworkError("Nenhum registro analisado para aplicar.");
      return;
    }
    if (!analysisNetwork.validation) {
      setIsAnalyzingNetwork(true);
      try {
        const res = await fetch("/api/admin/importacao-manual/analyze-network-json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, action: "validate", text: "" }),
        }).catch(() => null);
        const json = res ? await res.json().catch(() => null) : null;
        if (!res?.ok || !json?.ok) {
          const msg = String(json?.error ?? "Falha ao validar integridade.");
          setApplyNetworkError(msg);
          return;
        }
        const next = json.result as NetworkAnalyzeResult;
        setAnalysisNetwork(next);
        setNetworkTab("integridade");
        if (next?.validation?.criticalCount && !networkAck) {
          setApplyNetworkError("Integridade com erros críticos. Marque “Estou ciente e desejo importar mesmo assim” para liberar.");
          return;
        }
      } finally {
        setIsAnalyzingNetwork(false);
      }
    }
    if (analysisNetwork.validation?.criticalCount && !networkAck) {
      setNetworkTab("integridade");
      setApplyNetworkError("Integridade com erros críticos. Marque “Estou ciente e desejo importar mesmo assim” para liberar.");
      return;
    }
    const filtered = analysisNetwork.recordsForApply.filter((r) => {
      const mk = moduleKeyForBaseType(r.base_type);
      if (!mk) return false;
      return Boolean(networkModules[mk]);
    });
    if (!filtered.length) {
      setApplyNetworkError("Nenhum registro selecionado pelos filtros de módulo.");
      return;
    }
    setIsApplyingNetwork(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/apply-network-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, records: filtered }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao aplicar importação.");
        setApplyNetworkError(msg);
        return;
      }
      setApplyNetworkResult(json.result as NetworkApplyResult);
    } finally {
      setIsApplyingNetwork(false);
    }
  }

  function updateRow(rowId: string, patch: Partial<Omit<InsumoDraftRow, "rowId">>) {
    setAnalysis((prev) => {
      if (!prev?.ok) return prev;
      const rows = prev.rows.map((r) => (r.rowId === rowId ? ({ ...r, ...patch } as InsumoDraftRow) : r));
      return { ...prev, rows };
    });
  }

  async function applyImport() {
    setApplyError("");
    setApplyResult(null);
    if (!resolved?.companyId) {
      setApplyError("Selecione um usuário/empresa primeiro.");
      return;
    }
    if (!analysis?.ok) {
      setApplyError("Rode “Analisar e organizar” primeiro.");
      return;
    }
    if (analysis.module !== "insumos") {
      const opt = moduleOptions.find((o) => o.key === analysis.module);
      setApplyError(`Módulo detectado: ${opt?.label ?? analysis.module}. Importação ainda não implementada para este módulo.`);
      return;
    }
    setIsApplying(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: analysis.module, rows: analysis.rows }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        const msg = String(json?.error ?? "Falha ao aplicar importação.");
        setApplyError(msg);
        return;
      }
      setApplyResult(json.result as ApplyResult);
    } finally {
      setIsApplying(false);
    }
  }

  async function clearModule() {
    setApplyError("");
    setApplyResult(null);
    if (!resolved?.companyId) {
      setApplyError("Selecione um usuário/empresa primeiro.");
      return;
    }
    let detected: AnalyzeResult | null = analysis?.ok ? analysis : null;
    if (!detected) {
      if (!pasted.trim()) {
        setApplyError("Cole os dados para o sistema detectar o módulo antes de limpar.");
        return;
      }
      const res = await fetch("/api/admin/importacao-manual/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: "auto", text: pasted }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        setApplyError(String(json?.error ?? "Falha ao detectar módulo para limpar."));
        return;
      }
      detected = json.result as AnalyzeResult;
      setAnalysis(detected);
    }

    const opt = moduleOptions.find((o) => o.key === detected.module);
    if (!opt?.enabled) {
      setApplyError(`Módulo detectado: ${opt?.label ?? detected.module}. Limpeza ainda não liberada para este módulo.`);
      return;
    }
    if (!window.confirm(`Limpar dados antigos do módulo ${opt.label} para a empresa selecionada?\n\nIsso remove dados no banco compatível para esta empresa.`)) return;
    setIsClearingModule(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/clear-module", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: detected.module }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        setApplyError(String(json?.error ?? "Falha ao limpar módulo."));
        return;
      }
      setApplyResult(json.result as ApplyResult);
    } finally {
      setIsClearingModule(false);
    }
  }

  async function wipeAllUserData() {
    setWipeError("");
    setWipeResult(null);
    if (!resolved?.companyId) {
      setWipeError("Selecione um usuário/empresa primeiro.");
      return;
    }
    if (normalizeSpace(wipeConfirm).toUpperCase() !== "APAGAR DADOS") {
      setWipeError('Confirmação inválida. Digite exatamente: "APAGAR DADOS".');
      return;
    }
    if (!window.confirm("Confirma apagar TODOS os dados antigos deste usuário/empresa?")) return;

    setIsWipingUser(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/clear-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, confirm: wipeConfirm }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok) {
        setWipeError(String(json?.error ?? "Falha ao apagar dados do usuário."));
        return;
      }
      if (!json?.ok) {
        setWipeResult(json);
        setWipeError(String(json?.error ?? "Falha ao apagar dados do usuário."));
        return;
      }
      setWipeResult(json);
    } finally {
      setIsWipingUser(false);
    }
  }

  function cancel() {
    setPasted("");
    setPastedNetworkJson("");
    setNetworkFileInfo(null);
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisNetwork(null);
    setAnalysisNetworkError("");
    setApplyNetworkResult(null);
    setApplyNetworkError("");
    setApplyResult(null);
    setApplyError("");
    setWipeConfirm("");
    setWipeResult(null);
    setWipeError("");
  }

  function resetCsvFlow() {
    setCsvFiles([]);
    setCsvStep(1);
    setAnalysisCsv(null);
    setAnalysisCsvError("");
    setCsvRelationOverrides({});
    setApplyCsvResult(null);
    setApplyCsvError("");
    setCsvAudit(null);
    setCsvAuditError("");
    setCsvProgressKey("");
    setCsvProgress(null);
    setCsvReportDownloadedKey("");
  }

  function switchMode(next: SourceMode) {
    if (next === mode) return;
    cancel();
    resetCsvFlow();
    setNetworkTab("preview");
    setNetworkAck(false);
    setMode(next);
  }

  const modeLabel = useMemo(() => {
    if (mode === "bubble_csv") return "CSVs do Bubble";
    if (mode === "bubble_network_json") return "JSON de rede do Bubble";
    return "Texto colado manualmente";
  }, [mode]);

  const modeDescription = useMemo(() => {
    if (mode === "bubble_csv") return "Envie os CSVs exportados do Bubble, valide e importe para o banco compatível.";
    if (mode === "bubble_network_json") return "Cole ou faça upload do export de rede (JSON) capturado do Bubble.";
    return "Cole dados copiados do Bubble (tabela/texto), organize e grave no banco compatível.";
  }, [mode]);

  const categoriesSummary = useMemo(() => {
    if (!analysis?.ok) return [];
    return analysis.categoryCounts;
  }, [analysis]);

  return (
    <main className={dash.content}>
      <div className={dash.pageFrame}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 20 }}>Importação manual assistida</h1>
              <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>{modeDescription}</div>
            </div>
          </div>

          <section style={{ marginTop: 16, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#333" }}>Email do usuário</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  style={{ border: "1px solid #d7d7d7", borderRadius: 10, padding: "10px 12px" }}
                />
              </label>

              <div style={{ display: "grid", gap: 6, alignContent: "end" }}>
                <button
                  onClick={() => void resolveUser()}
                  disabled={isResolving}
                  style={{
                    border: "1px solid #111",
                    background: isResolving ? "#f4f4f4" : "#111",
                    color: isResolving ? "#777" : "#fff",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: isResolving ? "default" : "pointer",
                  }}
                >
                  {isResolving ? "Resolvendo..." : "Buscar usuário/empresa"}
                </button>
              </div>
            </div>

            {resolveError ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{resolveError}</div> : null}

            {resolved ? (
              <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
                <div>
                  <strong>Usuário:</strong> {resolved.email} <span style={{ color: "#777" }}>({resolved.userId})</span>
                </div>
                <div>
                  <strong>Empresa:</strong> {resolved.companyName ?? "(sem nome)"} <span style={{ color: "#777" }}>({resolved.companyId})</span>
                </div>
                <div>
                  <strong>Módulo:</strong>{" "}
                  {analysis?.ok ? (moduleOptions.find((o) => o.key === analysis.module)?.label ?? analysis.module) : <span style={{ color: "#777" }}>auto (detectado após análise)</span>}
                </div>
                {analysis?.ok && analysis.sectionsDetected?.length ? (
                  <div style={{ color: "#666" }}>
                    <strong>Blocos detectados no texto:</strong>{" "}
                    {analysis.sectionsDetected
                      .map((k) => {
                        if (k === "lista-de-compras") return "Lista de Compras";
                        return moduleOptions.find((o) => o.key === k)?.label ?? k;
                      })
                      .join(", ")}
                  </div>
                ) : null}
                {resolved.memberships.length > 1 ? (
                  <div style={{ color: "#7a4b00", background: "#fff9e8", border: "1px solid #ffe1a3", borderRadius: 10, padding: "8px 10px" }}>
                    Este usuário possui múltiplas empresas vinculadas. A empresa selecionada foi escolhida automaticamente pela maior permissão.
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "#333" }}>
                <strong>Fonte:</strong> {modeLabel}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => switchMode("bubble_csv")}
                  style={{
                    border: "1px solid #d7d7d7",
                    background: mode === "bubble_csv" ? "#111" : "#fff",
                    color: mode === "bubble_csv" ? "#fff" : "#333",
                    borderRadius: 999,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  CSVs do Bubble
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("bubble_network_json")}
                  style={{
                    border: "1px solid #d7d7d7",
                    background: mode === "bubble_network_json" ? "#111" : "#fff",
                    color: mode === "bubble_network_json" ? "#fff" : "#333",
                    borderRadius: 999,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  Rede (JSON)
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("pasted_text")}
                  style={{
                    border: "1px solid #d7d7d7",
                    background: mode === "pasted_text" ? "#111" : "#fff",
                    color: mode === "pasted_text" ? "#fff" : "#333",
                    borderRadius: 999,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  Texto colado
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {mode === "pasted_text" ? (
                <>
                  <button
                    onClick={() => void analyze()}
                    disabled={!canAnalyze}
                    style={{
                      border: "1px solid #111",
                      background: canAnalyze ? "#111" : "#f4f4f4",
                      color: canAnalyze ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canAnalyze ? "pointer" : "default",
                    }}
                  >
                    {isAnalyzing ? "Analisando..." : "Analisar e organizar"}
                  </button>
                  <button
                    onClick={() => void applyImport()}
                    disabled={!canApply}
                    style={{
                      border: "1px solid #1a7f37",
                      background: canApply ? "#1a7f37" : "#f4f4f4",
                      color: canApply ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canApply ? "pointer" : "default",
                    }}
                  >
                    {isApplying ? "Aplicando..." : "Cadastrar/Atualizar dados"}
                  </button>
                  <button
                    onClick={() => void clearModule()}
                    disabled={!resolved?.companyId || isClearingModule}
                    style={{
                      border: "1px solid #d93025",
                      background: !resolved?.companyId || isClearingModule ? "#f4f4f4" : "#fff",
                      color: !resolved?.companyId || isClearingModule ? "#777" : "#d93025",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: !resolved?.companyId || isClearingModule ? "default" : "pointer",
                    }}
                  >
                    {isClearingModule ? "Limpando..." : "Limpar dados antigos deste módulo"}
                  </button>
                </>
              ) : mode === "bubble_network_json" ? (
                <>
                  <button
                    onClick={() => void analyzeNetworkJson()}
                    disabled={!canAnalyzeNetwork}
                    style={{
                      border: "1px solid #111",
                      background: canAnalyzeNetwork ? "#111" : "#f4f4f4",
                      color: canAnalyzeNetwork ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canAnalyzeNetwork ? "pointer" : "default",
                    }}
                  >
                    {isAnalyzingNetwork ? "Analisando..." : "Analisar JSONs"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void validateNetworkIntegrity()}
                    disabled={!resolved?.companyId || isAnalyzingNetwork}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: "#fff",
                      color: "#333",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: !resolved?.companyId || isAnalyzingNetwork ? "default" : "pointer",
                      opacity: !resolved?.companyId || isAnalyzingNetwork ? 0.6 : 1,
                    }}
                  >
                    Validar integridade
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetNetworkSession()}
                    disabled={!resolved?.companyId || isAnalyzingNetwork}
                    style={{
                      border: "1px solid #d93025",
                      background: "#fff",
                      color: "#d93025",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: !resolved?.companyId || isAnalyzingNetwork ? "default" : "pointer",
                      opacity: !resolved?.companyId || isAnalyzingNetwork ? 0.6 : 1,
                    }}
                  >
                    Reiniciar sessão
                  </button>
                  <button
                    onClick={() => void applyNetworkJson()}
                    disabled={!canApplyNetwork}
                    style={{
                      border: "1px solid #1a7f37",
                      background: canApplyNetwork ? "#1a7f37" : "#f4f4f4",
                      color: canApplyNetwork ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canApplyNetwork ? "pointer" : "default",
                    }}
                  >
                    {isApplyingNetwork ? "Aplicando..." : "Cadastrar/Atualizar"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void analyzeBubbleCsv()}
                    disabled={!canAnalyzeCsv}
                    style={{
                      border: "1px solid #111",
                      background: canAnalyzeCsv ? "#111" : "#f4f4f4",
                      color: canAnalyzeCsv ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canAnalyzeCsv ? "pointer" : "default",
                      display: csvStep === 1 ? "inline-block" : "none",
                    }}
                  >
                    {isAnalyzingCsv ? "Analisando..." : "Analisar CSVs"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCsvStep((s) => (s > 1 ? ((s - 1) as any) : s))}
                    disabled={csvStep === 1}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: "#fff",
                      color: "#333",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: csvStep === 1 ? "default" : "pointer",
                      opacity: csvStep === 1 ? 0.6 : 1,
                    }}
                  >
                    Etapa anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setCsvStep((s) => (s < 4 ? ((s + 1) as any) : s))}
                    disabled={csvStep >= 4 || !analysisCsv?.ok}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: "#fff",
                      color: "#333",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: csvStep >= 4 || !analysisCsv?.ok ? "default" : "pointer",
                      opacity: csvStep >= 4 || !analysisCsv?.ok ? 0.6 : 1,
                    }}
                  >
                    Próxima etapa
                  </button>
                  <button
                    onClick={() => void applyBubbleCsv()}
                    disabled={!canApplyCsv}
                    style={{
                      border: "1px solid #1a7f37",
                      background: canApplyCsv ? "#1a7f37" : "#f4f4f4",
                      color: canApplyCsv ? "#fff" : "#777",
                      borderRadius: 10,
                      padding: "9px 12px",
                      cursor: canApplyCsv ? "pointer" : "default",
                      display: csvStep === 4 ? "inline-block" : "none",
                    }}
                  >
                    {isApplyingCsv ? "Aplicando..." : "Cadastrar/Atualizar"}
                  </button>
                </>
              )}
              <button
                onClick={() => cancel()}
                style={{ border: "1px solid #d7d7d7", background: "#fff", color: "#333", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>

            {mode === "bubble_csv" ? (
              <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <strong>Assistente:</strong> Etapa {csvStep}/4
                  </div>
                  <div style={{ color: "#666" }}>
                    {csvStep === 1 ? "Upload dos CSVs" : csvStep === 2 ? "Validação automática" : csvStep === 3 ? "Revisar pendências" : "Importar"}
                  </div>
                </div>
                <div style={{ background: "#f4f4f4", borderRadius: 999, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round((csvStep / 4) * 100)}%`, height: 8, background: "#0b57d0" }} />
                </div>
              </div>
            ) : null}

            {mode === "pasted_text" && analysis?.ok && analysis.module !== "insumos" ? (
              <div style={{ marginTop: 10, color: "#7a4b00", fontSize: 13 }}>
                Módulo detectado: {moduleOptions.find((o) => o.key === analysis.module)?.label ?? analysis.module}. Importação completa ainda não implementada para este módulo.
              </div>
            ) : null}

            <div style={{ marginTop: 12 }}>
              {mode === "pasted_text" ? (
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Cole aqui a tabela/texto copiado do Bubble (linhas/colunas)."
                  style={{ width: "100%", minHeight: 170, border: "1px solid #d7d7d7", borderRadius: 12, padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                />
              ) : mode === "bubble_network_json" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void loadNetworkJsonFile(f);
                      }}
                      style={{ border: "1px solid #d7d7d7", borderRadius: 10, padding: "8px 10px", background: "#fff" }}
                    />
                    {networkFileInfo ? (
                      <span style={{ fontSize: 13, color: "#666" }}>
                        Arquivo: <strong>{networkFileInfo.name}</strong> ({formatIntPT(Math.round(networkFileInfo.size / 1024))} KB)
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "#666" }}>Upload opcional (.json). Você pode colar texto também.</span>
                    )}
                  </div>
                  <textarea
                    value={pastedNetworkJson}
                    onChange={(e) => {
                      setNetworkFileInfo(null);
                      setPastedNetworkJson(e.target.value);
                    }}
                    placeholder="Cole aqui um ou vários JSONs brutos (mget/msearch/search/responses) OU faça upload do export do capturador."
                    style={{ width: "100%", minHeight: 170, border: "1px solid #d7d7d7", borderRadius: 12, padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                  />
                  <details style={{ border: "1px solid #e7e7e7", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>
                      Snippet para DevTools Console (capturar rede do Bubble e baixar export)
                    </summary>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(bubbleNetworkConsoleSnippet)}
                        style={{ border: "1px solid #0b57d0", background: "#0b57d0", color: "#fff", borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}
                      >
                        Copiar snippet
                      </button>
                    </div>
                    <pre
                      style={{
                        marginTop: 10,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                        border: "1px solid #e7e7e7",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fff",
                        maxHeight: 300,
                        overflow: "auto",
                      }}
                    >
                      {bubbleNetworkConsoleSnippet}
                    </pre>
                  </details>
                  <details style={{ border: "1px solid #e7e7e7", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>Bookmarklet (favorito) — capturar rede do Bubble</summary>
                    <div style={{ marginTop: 10, fontSize: 13, color: "#333", display: "grid", gap: 6 }}>
                      <div style={{ color: "#666" }}>
                        Como usar: crie um favorito no navegador e cole o código abaixo no campo URL/Endereço. Depois, com o Bubble aberto e logado, clique no favorito para iniciar a captura.
                      </div>
                      <ol style={{ margin: 0, paddingLeft: 18, color: "#666", display: "grid", gap: 4 }}>
                        <li>Crie um favorito (ex.: “Bubble Export”).</li>
                        <li>Edite o favorito e cole o código no campo URL/Endereço.</li>
                        <li>No Bubble, clique no favorito e navegue nas telas.</li>
                        <li>No painel flutuante, clique em “Baixar export”.</li>
                      </ol>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(bubbleNetworkBookmarklet)}
                        style={{ border: "1px solid #0b57d0", background: "#0b57d0", color: "#fff", borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}
                      >
                        Copiar Bookmarklet
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={bubbleNetworkBookmarklet}
                      style={{
                        marginTop: 10,
                        width: "100%",
                        minHeight: 120,
                        fontSize: 12,
                        border: "1px solid #e7e7e7",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fff",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </details>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {csvStep === 1 ? (
                    <>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <input
                          type="file"
                          multiple
                          accept=".csv,text/csv"
                          onChange={(e) => {
                            const list = Array.from(e.target.files ?? []);
                            setCsvFiles(list);
                            setCsvStep(1);
                            setAnalysisCsv(null);
                            setAnalysisCsvError("");
                            setApplyCsvResult(null);
                            setApplyCsvError("");
                            setCsvAudit(null);
                            setCsvAuditError("");
                          }}
                          style={{ border: "1px solid #d7d7d7", borderRadius: 10, padding: "8px 10px", background: "#fff" }}
                        />
                        <span style={{ fontSize: 13, color: "#666" }}>
                          {csvFiles.length ? (
                            <>
                              {csvFiles.length} arquivo(s) selecionado(s): <strong>{csvFiles.map((f) => f.name).slice(0, 4).join(", ")}</strong>
                              {csvFiles.length > 4 ? <> + {formatIntPT(csvFiles.length - 4)} outros</> : null}
                            </>
                          ) : (
                            <>Selecione todos os CSVs exportados do Bubble de uma vez.</>
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "#666" }}>
                        O sistema detecta o tipo pelo nome do arquivo ou cabeçalho, normaliza __LOOKUP__, preserva Bubble ID e prepara um plano de UPSERT.
                      </div>
                    </>
                  ) : analysisCsv?.ok ? (
                    <div style={{ fontSize: 13, color: "#333", display: "grid", gap: 6 }}>
                      <div>
                        <strong>Arquivos carregados:</strong> {formatIntPT(analysisCsv.totals.files)} • <strong>Linhas:</strong> {formatIntPT(analysisCsv.totals.rows)}
                      </div>
                      <div style={{ color: "#666" }}>
                        Para trocar os arquivos, volte para a Etapa 1.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#666" }}>Volte para a Etapa 1 e faça upload dos CSVs.</div>
                  )}
                </div>
              )}
            </div>

            {mode === "pasted_text" && analysisError ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{analysisError}</div> : null}
            {mode === "bubble_network_json" && analysisNetworkError ? (
              <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{analysisNetworkError}</div>
            ) : null}
            {mode === "bubble_csv" && analysisCsvError ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{analysisCsvError}</div> : null}
          </section>

          {analysisCsv?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Arquivos</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisCsv.totals.files)}</div>
                </div>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Linhas (total)</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisCsv.totals.rows)}</div>
                </div>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Registros para aplicar</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisCsv.recordsForApply.length)}</div>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13 }}>
                <div>
                  <strong>Tipos detectados:</strong>{" "}
                  {analysisCsv.byType.length ? analysisCsv.byType.map((t) => `${t.type} (${formatIntPT(t.count)})`).join(" • ") : "(nenhum)"}
                </div>
                {analysisCsv.unknownFiles?.length ? (
                  <div style={{ color: "#7a4b00", background: "#fff9e8", border: "1px solid #ffe1a3", borderRadius: 10, padding: "8px 10px" }}>
                    <strong>Arquivos sem tipo detectado:</strong> {analysisCsv.unknownFiles.map((f) => f.name).join(", ")}
                  </div>
                ) : null}
              </div>

              {analysisCsv.validation?.ok ? (
                <details style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>Integridade (opcional)</summary>
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                      <div>
                        <strong>Críticos:</strong>{" "}
                        <span style={{ color: analysisCsv.validation.criticalCount ? "#b00020" : "#1a7f37" }}>{formatIntPT(analysisCsv.validation.criticalCount)}</span>
                      </div>
                      <div>
                        <strong>Warnings:</strong> <span style={{ color: "#7a4b00" }}>{formatIntPT(analysisCsv.validation.warningsCount)}</span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                      {analysisCsv.validation.checks
                        .filter((c) => c.count > 0)
                        .slice(0, 12)
                        .map((c) => (
                          <div key={c.key} style={{ color: c.critical ? "#b00020" : "#7a4b00" }}>
                            {c.label}: {formatIntPT(c.count)}
                          </div>
                        ))}
                      {!analysisCsv.validation.checks.some((c) => c.count > 0) ? <div style={{ color: "#1a7f37" }}>Sem problemas de integridade detectados.</div> : null}
                    </div>
                  </div>
                </details>
              ) : null}

              {csvStep === 2 ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Etapa 2 — Validação automática</div>
                  <div style={{ fontSize: 13, color: "#333", display: "grid", gap: 6 }}>
                    <div>
                      <strong>Registros encontrados:</strong> {formatIntPT(analysisCsv.recordsForApply.length)}
                    </div>
                    {csvRelationResolution ? (
                      <div>
                        <strong>Resolvidos automaticamente:</strong> {formatIntPT(csvRelationReview.autoResolved)} • <strong>Pendências (sem repetição):</strong>{" "}
                        {formatIntPT(csvRelationReview.pendingGroupsCount)}
                      </div>
                    ) : (
                      <div style={{ color: "#666" }}>Resolução de relacionamentos: indisponível.</div>
                    )}
                  </div>
                  <details style={{ border: "1px solid #e7e7e7", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>Arquivos e tipos detectados (opcional)</summary>
                    <div style={{ marginTop: 10, overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr>
                            {["Arquivo", "Tipo Bubble", "Tabela destino", "Linhas", "Status"].map((h) => (
                              <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {analysisCsv.files.map((f) => (
                            <tr key={f.hash}>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{f.name}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{f.baseType ?? "-"}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{f.destinationTable ?? "-"}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(f.rows)}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: f.status === "ok" ? "#1a7f37" : "#b00020", fontWeight: 700 }}>
                                {f.status === "ok" ? "OK" : `Erro (${f.statusReason})`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ) : null}

              {csvStep === 3 ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Etapa 3 — Revisar pendências (sem repetição)</div>
                  {!csvRelationResolution ? (
                    <div style={{ fontSize: 13, color: "#666" }}>Sem dados de resolução de relacionamentos para revisar.</div>
                  ) : csvRelationReview.pendingGroupsCount ? (
                    <>
                      <div style={{ fontSize: 13, color: "#333" }}>
                        <strong>Pendências:</strong> {formatIntPT(csvRelationReview.pendingGroupsCount)} • <strong>Ocorrências:</strong> {formatIntPT(csvRelationReview.pendingOccurrences)}
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              {["Tipo", "Valor do CSV", "Situação", "Ocorrências", "Resolver"].map((h) => (
                                <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvRelationReview.pendingGroups.map((g) => (
                              <tr key={g.groupKey}>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{g.type || "—"}</td>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{g.csvValue || "—"}</td>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>
                                  <div style={{ whiteSpace: "nowrap" }}>{g.resolution}</div>
                                  {g.reason ? <div style={{ marginTop: 3, color: "#666", whiteSpace: "normal" }}>{g.reason}</div> : null}
                                </td>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{formatIntPT(g.occurrences)}</td>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 320 }}>
                                  {g.actionable ? (
                                    <div style={{ display: "grid", gap: 6 }}>
                                      <select
                                        value={g.chosenValue}
                                        onChange={(e) => {
                                          const v = String(e.currentTarget.value ?? "");
                                          setCsvRelationOverrides((prev) => ({ ...prev, [g.overrideKey]: v }));
                                        }}
                                        style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}
                                      >
                                        <option value="">— selecione —</option>
                                        {g.candidates.map((c) => (
                                          <option key={c.value} value={c.value}>
                                            {c.label || c.value}
                                          </option>
                                        ))}
                                      </select>
                                      {g.chosenLabel ? <div style={{ fontSize: 12, color: "#1a7f37" }}>Selecionado: {g.chosenLabel}</div> : null}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 12, color: "#b00020" }}>
                                      Não há candidatos disponíveis para seleção automática. Ajuste o CSV (ou crie o registro no sistema) e rode a análise novamente.
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div style={{ color: "#1a7f37", fontSize: 13 }}>Sem pendências. Você já pode importar.</div>
                  )}
                </div>
              ) : null}

              {csvStep === 2 ? (
                <details style={{ marginTop: 12, border: "1px solid #e7e7e7", borderRadius: 12, padding: 12, background: "#fafafa" }}>
                  <summary style={{ cursor: "pointer", fontSize: 13 }}>Plano de importação (opcional)</summary>
                  <div style={{ marginTop: 10, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Ordem", "Tabela", "Linhas", "Criar", "Atualizar", "Ignorar", "Motivo do Ignore", "Bubble ID faltando", "Duplicados no CSV"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(analysisCsv.plan?.byTable ?? []).map((t) => (
                          <tr key={t.table}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{t.order}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{t.table}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.sourceRows)}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#1a7f37", fontWeight: 700 }}>{formatIntPT(t.wouldCreate)}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#0b57d0", fontWeight: 700 }}>{formatIntPT(t.wouldUpdate)}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.wouldIgnore)}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: t.wouldIgnore ? "#b00020" : "#666" }}>
                              {t.wouldIgnore ? String(t.ignoreReasonTop ?? "").trim() || "—" : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: t.missingBubbleId ? "#b00020" : "#666" }}>
                              {formatIntPT(t.missingBubbleId)}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: t.duplicatesInSource ? "#b00020" : "#666" }}>
                              {formatIntPT(t.duplicatesInSource)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              {csvStep === 4 ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Etapa 4 — Importar</div>
                  {csvHasCritical ? (
                    <div style={{ color: "#b00020", fontSize: 13, background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 10px" }}>
                      <strong>Importação bloqueada:</strong> {csvCriticalReasons.join(" • ")}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 13, color: "#333" }}>
                    <strong>Status:</strong>{" "}
                    {isApplyingCsv ? (
                      <span style={{ color: "#0b57d0" }}>
                        {csvProgress?.phase ? String(csvProgress.phase) : "executando"} {csvProgress?.table ? `• ${String(csvProgress.table)}` : ""}
                      </span>
                    ) : applyCsvResult?.ok ? (
                      <span style={{ color: "#1a7f37" }}>finalizado</span>
                    ) : (
                      <span style={{ color: "#666" }}>pronto para importar</span>
                    )}
                  </div>
                  {csvProgress?.perTable && typeof csvProgress.perTable === "object" ? (
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {Object.entries(csvProgress.perTable)
                        .slice(0, 8)
                        .map(([k, v]: any) => `${k} (${formatIntPT(Number(v?.attempted ?? 0))})`)
                        .join(" • ")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {applyCsvError ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{applyCsvError}</div> : null}
            </section>
          ) : null}

          {analysis?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Registros detectados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysis.totalRows)}</div>
                </div>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Pendentes de classificação</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysis.pendingClassificationCount)}</div>
                </div>
                <div style={{ fontSize: 13 }}>
                  <div style={{ color: "#666" }}>Duplicados prováveis</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysis.duplicates.length)}</div>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13 }}>
                <div>
                  <strong>Campos reconhecidos:</strong> {analysis.recognizedColumns.length ? analysis.recognizedColumns.join(", ") : "(nenhum)"}
                </div>
                <div>
                  <strong>Campos faltantes:</strong> {analysis.missingColumns.length ? analysis.missingColumns.join(", ") : "(nenhum)"}
                </div>
              </div>

              {analysis.errors.length ? (
                <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>
                  <strong>Erros:</strong>
                  <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                    {analysis.errors.map((e, i) => (
                      <div key={String(i)}>{e}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {categoriesSummary.length ? (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <strong>Total por categoria:</strong>
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {categoriesSummary.map((c) => (
                      <span key={normKey(c.categoria)} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                        {c.categoria}: {formatIntPT(c.count)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {analysis.duplicates.length ? (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <strong>Duplicados prováveis (por nome):</strong>
                  <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                    {analysis.duplicates.slice(0, 20).map((d) => (
                      <div key={d.key} style={{ color: "#7a4b00" }}>
                        {d.key} ({d.rowIds.join(", ")})
                      </div>
                    ))}
                    {analysis.duplicates.length > 20 ? <div style={{ color: "#777" }}>+ {formatIntPT(analysis.duplicates.length - 20)} outros</div> : null}
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["Item", "Medida", "Custo médio", "Categoria", "Especificação", "Ocultar", "Avisos"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rows.map((r) => (
                      <tr key={r.rowId}>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 220 }}>
                          <input
                            value={r.item}
                            onChange={(e) => updateRow(r.rowId, { item: e.target.value })}
                            style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 110 }}>
                          <input
                            value={r.medida}
                            onChange={(e) => updateRow(r.rowId, { medida: e.target.value })}
                            style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 130 }}>
                          <input
                            value={r.custoMedio}
                            onChange={(e) => updateRow(r.rowId, { custoMedio: e.target.value })}
                            placeholder="ex: 12,34"
                            style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 180 }}>
                          <input
                            value={r.categoria}
                            onChange={(e) => updateRow(r.rowId, { categoria: e.target.value })}
                            style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 220 }}>
                          <input
                            value={r.especificacao}
                            onChange={(e) => updateRow(r.rowId, { especificacao: e.target.value })}
                            style={{ width: "100%", border: "1px solid #d7d7d7", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 90 }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <input type="checkbox" checked={Boolean(r.ocultar)} onChange={(e) => updateRow(r.rowId, { ocultar: e.target.checked })} />
                            <span style={{ color: "#444" }}>Sim</span>
                          </label>
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", minWidth: 240, color: "#7a4b00" }}>
                          {r.warnings.length ? r.warnings.join(" • ") : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {mode === "bubble_network_json" && analysisNetwork?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, color: "#333" }}>
                  <strong>Sessão:</strong>{" "}
                  {analysisNetwork.session?.label ? (
                    <>
                      {analysisNetwork.session.label} • {formatIntPT(analysisNetwork.session.records)} registros • atualizado em{" "}
                      <span style={{ color: "#666" }}>{analysisNetwork.session.updatedAt}</span>
                    </>
                  ) : (
                    <span style={{ color: "#666" }}>sem sessão carregada</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setNetworkTab("preview")}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: networkTab === "preview" ? "#111" : "#fff",
                      color: networkTab === "preview" ? "#fff" : "#333",
                      borderRadius: 999,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setNetworkTab("resumo")}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: networkTab === "resumo" ? "#111" : "#fff",
                      color: networkTab === "resumo" ? "#fff" : "#333",
                      borderRadius: 999,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Resumo da Importação
                  </button>
                  <button
                    type="button"
                    onClick={() => setNetworkTab("integridade")}
                    style={{
                      border: "1px solid #d7d7d7",
                      background: networkTab === "integridade" ? "#111" : "#fff",
                      color: networkTab === "integridade" ? "#fff" : "#333",
                      borderRadius: 999,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Integridade
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13 }}>
                {analysisNetwork.delta ? (
                  <>
                    <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                      Novos: <strong>{formatIntPT(analysisNetwork.delta.new)}</strong>
                    </span>
                    <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                      Já existentes: <strong>{formatIntPT(analysisNetwork.delta.existing)}</strong>
                    </span>
                    <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                      Atualizados: <strong>{formatIntPT(analysisNetwork.delta.updated)}</strong>
                    </span>
                    <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                      Duplicados (no paste): <strong>{formatIntPT(analysisNetwork.delta.duplicates)}</strong>
                    </span>
                  </>
                ) : (
                  <span style={{ color: "#666" }}>Cole mais JSONs e clique em “Analisar JSONs” para importar incrementalmente.</span>
                )}
              </div>

              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>Filtro por módulo:</strong>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {networkModuleOptions.map((opt) => (
                    <label key={opt.key} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(networkModules[opt.key])}
                        onChange={(e) => setNetworkModules((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>Integridade:</strong>{" "}
                {analysisNetwork.validation ? (
                  <>
                    Críticos:{" "}
                    <strong style={{ color: analysisNetwork.validation.criticalCount ? "#b00020" : "#1a7f37" }}>
                      {formatIntPT(analysisNetwork.validation.criticalCount)}
                    </strong>{" "}
                    • Avisos: <strong>{formatIntPT(analysisNetwork.validation.warningsCount)}</strong>
                  </>
                ) : (
                  <span style={{ color: "#666" }}>clique em “Validar Integridade” para liberar o apply</span>
                )}
              </div>
              {analysisNetwork.validation?.criticalCount ? (
                <div style={{ marginTop: 10, fontSize: 13, color: "#333" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <input type="checkbox" checked={networkAck} onChange={(e) => setNetworkAck(e.target.checked)} />
                    <span>Estou ciente e desejo importar mesmo assim</span>
                  </label>
                </div>
              ) : null}

              {networkTab === "resumo" ? (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Módulo", "Fonte", "Planejado", "Criar", "Atualizar", "Ignorar", "Erro"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {networkSummary.map((r) => (
                        <tr key={r.moduleKey}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.label}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(r.sourceRows)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(r.plannedRows)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#1a7f37", fontWeight: 700 }}>
                            {formatIntPT(r.wouldCreate)}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#0b57d0", fontWeight: 700 }}>
                            {formatIntPT(r.wouldUpdate)}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(r.wouldIgnore)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: r.errors ? "#b00020" : "#666" }}>
                            {formatIntPT(r.errors)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {networkTab === "integridade" ? (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  {analysisNetwork.validation ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Check", "Crítico", "Qtd", "Amostra"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysisNetwork.validation.checks.map((c) => (
                          <tr key={c.key}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{c.label}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{c.critical ? "Sim" : "Não"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: c.count ? "#b00020" : "#666" }}>
                              {formatIntPT(c.count)}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>
                              {c.samples?.length ? JSON.stringify(c.samples[0]) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: "#666", fontSize: 13 }}>Clique em “Validar Integridade” para gerar o relatório.</div>
                  )}
                </div>
              ) : null}

              {networkTab === "preview" ? (
                <>
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ color: "#666" }}>JSONs parseados</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisNetwork.parsed.ok)}</div>
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ color: "#666" }}>Registros detectados</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisNetwork.totals.recordsDetected)}</div>
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ color: "#666" }}>Sem _id</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisNetwork.totals.missingBubbleId)}</div>
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ color: "#666" }}>Sem _type</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisNetwork.totals.missingBubbleType)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                    <div>
                      <div style={{ color: "#666" }}>Duplicados (_type + _id)</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(analysisNetwork.totals.duplicateKeys)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#666" }}>Relações (refs)</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        Total: <strong>{formatIntPT(analysisNetwork.relations.total)}</strong> • Resolvidas:{" "}
                        <strong style={{ color: "#1a7f37" }}>{formatIntPT(analysisNetwork.relations.resolved)}</strong> • Quebradas:{" "}
                        <strong style={{ color: "#b00020" }}>{formatIntPT(analysisNetwork.relations.broken)}</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, fontSize: 13 }}>
                    <strong>Total por Data Type:</strong>
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {analysisNetwork.byType.slice(0, 30).map((t) => (
                        <span key={t.type} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #e7e7e7", background: "#fafafa" }}>
                          {t.type}: {formatIntPT(t.count)}
                        </span>
                      ))}
                      {analysisNetwork.byType.length > 30 ? <span style={{ color: "#777" }}>+ {formatIntPT(analysisNetwork.byType.length - 30)} outros</span> : null}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Tabelas destino (preview)</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                      <thead>
                        <tr>
                          {["Tabela", "Base types", "Fonte", "Planejado", "Criar", "Atualizar", "Ignorar", "Sem _id", "Duplicados"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysisNetwork.plan.byTable
                          .filter((t) => {
                            const mk = moduleKeyForTable(t.table);
                            return mk ? Boolean(networkModules[mk]) : false;
                          })
                          .map((t) => (
                            <tr key={t.table}>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{t.table}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{t.baseTypes.join(", ")}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.sourceRows)}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.plannedRows)}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#1a7f37", fontWeight: 700 }}>
                                {formatIntPT(t.wouldCreate)}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#0b57d0", fontWeight: 700 }}>
                                {formatIntPT(t.wouldUpdate)}
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.wouldIgnore)}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.missingBubbleId)}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(t.duplicatesInSource)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Registros detectados</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                      <thead>
                        <tr>
                          {["_type", "_id", "Tabela destino", "Status", "Motivo"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysisNetwork.detectedRecords.slice(0, 250).map((r) => (
                          <tr key={`${r.bubble_type ?? "-"}::${r.bubble_id ?? "-"}`}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_type ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_id ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.table ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: r.status === "ready" ? "#1a7f37" : "#b00020", fontWeight: 700 }}>
                              {r.status === "ready" ? "OK" : "Ignorado"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{r.ignoreReason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {analysisNetwork.detectedRecords.length > 250 ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>+ {formatIntPT(analysisNetwork.detectedRecords.length - 250)} outros</div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {networkTab === "preview" ? (
                <>
                  {analysisNetwork.duplicates.length ? (
                    <div style={{ marginTop: 12, fontSize: 13 }}>
                      <strong>Duplicados (amostra):</strong>
                      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                        {analysisNetwork.duplicates.slice(0, 20).map((d) => (
                          <div key={d.key} style={{ color: "#7a4b00" }}>
                            {d.key} ({formatIntPT(d.count)})
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, overflowX: "auto" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Campos sem destino (top)</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                      <thead>
                        <tr>
                          {["Type", "Chaves (top 8)"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(analysisNetwork.unmapped.topUnmappedKeysByType)
                          .slice(0, 25)
                          .map(([type, keys]) => (
                            <tr key={type}>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{type}</td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>
                                {keys
                                  .slice(0, 8)
                                  .map((k) => `${k.key} (${formatIntPT(k.count)})`)
                                  .join(" • ")}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {mode === "bubble_network_json" && applyNetworkError ? <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>{applyNetworkError}</div> : null}

          {mode === "bubble_network_json" && applyNetworkResult?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Resultado (JSON de rede)</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: "#666" }}>Processados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyNetworkResult.totals.processed)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Criados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyNetworkResult.totals.created)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Atualizados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyNetworkResult.totals.updated)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Ignorados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyNetworkResult.totals.ignored)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Erros</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyNetworkResult.totals.errors)}</div>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
                Relações quebradas: <strong style={{ color: applyNetworkResult.totals.brokenRelations ? "#b00020" : "#1a7f37" }}>{formatIntPT(applyNetworkResult.totals.brokenRelations)}</strong>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["Tabela", "Tentativas", "Criados", "Atualizados", "Ignorados", "Erros", "Relações quebradas"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(applyNetworkResult.perTable).map(([table, st]) => (
                      <tr key={table}>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{table}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(st.attempted)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#1a7f37", fontWeight: 700 }}>{formatIntPT(st.created)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#0b57d0", fontWeight: 700 }}>{formatIntPT(st.updated)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(st.ignored)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.errors.length ? "#b00020" : "#666" }}>{formatIntPT(st.errors.length)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.brokenRelations ? "#b00020" : "#666" }}>{formatIntPT(st.brokenRelations)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {applyNetworkResult.ignoredRecords?.length ? (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Ignorados (detalhado)</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                    <thead>
                      <tr>
                        {["_type", "_id", "Tabela destino", "Motivo", "Coluna", "Bubble ID esperado"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {applyNetworkResult.ignoredRecords.slice(0, 250).map((r) => {
                        const broken = Array.isArray((r as any).broken) ? ((r as any).broken as any[]) : [];
                        const column = broken.length ? broken.map((b) => String(b?.column ?? "")).filter(Boolean).join("; ") : "-";
                        const expected = broken.length ? broken.map((b) => String(b?.expected ?? "")).filter(Boolean).join("; ") : "-";
                        return (
                          <tr key={`${r.base_type}:${r.bubble_id}:${r.reason}`}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_type ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_id ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.table ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{r.reason}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{column}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{expected}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {applyNetworkResult.ignoredRecords.length > 250 ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>+ {formatIntPT(applyNetworkResult.ignoredRecords.length - 250)} outros</div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>Auditoria:</strong> {applyNetworkResult.audit.bucket}/{applyNetworkResult.audit.path}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
                {applyNetworkResult.links.map((l) => (
                  <a key={l.href} href={l.href} style={{ color: "#0b57d0", textDecoration: "underline" }}>
                    Abrir {l.label}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {applyCsvError ? <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>{applyCsvError}</div> : null}

          {applyCsvResult?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Resultado (CSV do Bubble)</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: "#666" }}>Processados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyCsvResult.totals.processed)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Criados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyCsvResult.totals.created)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Atualizados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyCsvResult.totals.updated)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Ignorados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyCsvResult.totals.ignored)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Erros</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyCsvResult.totals.errors)}</div>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
                Relações quebradas: <strong style={{ color: applyCsvResult.totals.brokenRelations ? "#b00020" : "#1a7f37" }}>{formatIntPT(applyCsvResult.totals.brokenRelations)}</strong>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["Tabela", "Tentativas", "Criados", "Atualizados", "Ignorados", "Erros", "Relações quebradas"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(applyCsvResult.perTable).map(([table, st]) => (
                      <tr key={table}>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{table}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(st.attempted)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#1a7f37", fontWeight: 700 }}>{formatIntPT(st.created)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#0b57d0", fontWeight: 700 }}>{formatIntPT(st.updated)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(st.ignored)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.errors.length ? "#b00020" : "#666" }}>{formatIntPT(st.errors.length)}</td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.brokenRelations ? "#b00020" : "#666" }}>{formatIntPT(st.brokenRelations)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {applyCsvResult.ignoredRecords?.length ? (
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Ignorados (detalhado)</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                    <thead>
                      <tr>
                        {["_type", "_id", "Tabela destino", "Motivo", "Coluna", "Bubble ID esperado"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {applyCsvResult.ignoredRecords.slice(0, 250).map((r) => {
                        const broken = Array.isArray((r as any).broken) ? ((r as any).broken as any[]) : [];
                        const column = broken.length ? broken.map((b) => String(b?.column ?? "")).filter(Boolean).join("; ") : "-";
                        const expected = broken.length ? broken.map((b) => String(b?.expected ?? "")).filter(Boolean).join("; ") : "-";
                        return (
                          <tr key={`${r.base_type}:${r.bubble_id}:${r.reason}`}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_type ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.bubble_id ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{r.table ?? "-"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{r.reason}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{column}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{expected}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {applyCsvResult.ignoredRecords.length > 250 ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>+ {formatIntPT(applyCsvResult.ignoredRecords.length - 250)} outros</div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>Auditoria (Supabase):</strong>{" "}
                {csvAudit?.ok ? (
                  <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
                    <div style={{ color: "#333" }}>
                      {Object.entries(csvAudit.counts)
                        .map(([k, v]) => `${k} (${formatIntPT(v)})`)
                        .join(" • ")}
                    </div>
                    {csvAudit.perTable ? (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              {["Tabela", "CSV", "Banco", "Diferença", "Bubble ID faltando", "Duplicados", "Último"].map((h) => (
                                <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(csvAudit.perTable).map(([table, st]) => {
                              const expected = st.expected;
                              const diff = typeof expected === "number" ? st.count - expected : null;
                              const last = st.recent?.[0]?.bubble_id ? String(st.recent[0].bubble_id) : "";
                              return (
                                <tr key={table}>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{table}</td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{typeof expected === "number" ? formatIntPT(expected) : "-"}</td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0" }}>{formatIntPT(st.count)}</td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.mismatch ? "#b00020" : "#666", fontWeight: st.mismatch ? 700 : 400 }}>
                                    {diff != null ? formatIntPT(diff) : "-"}
                                  </td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.missingBubbleIds ? "#b00020" : "#666" }}>
                                    {formatIntPT(st.missingBubbleIds)}
                                  </td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: st.duplicateBubbleIds?.length ? "#b00020" : "#666" }}>
                                    {formatIntPT(st.duplicateBubbleIds?.length ?? 0)}
                                    {st.truncated ? " (parcial)" : ""}
                                  </td>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f0f0f0", color: "#666" }}>{last ? last : ""}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : csvAuditError ? (
                  <span style={{ color: "#b00020" }}>{csvAuditError}</span>
                ) : (
                  <span style={{ color: "#666" }}>Aguardando auditoria…</span>
                )}
              </div>

              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>Auditoria:</strong> {applyCsvResult.audit.bucket}/{applyCsvResult.audit.path}
              </div>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
                {applyCsvResult.links.map((l) => (
                  <a key={l.href} href={l.href} style={{ color: "#0b57d0", textDecoration: "underline" }}>
                    Abrir {l.label}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {applyError ? <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>{applyError}</div> : null}

          {applyResult?.ok ? (
            <section style={{ marginTop: 12, padding: 14, border: "1px solid #e7e7e7", borderRadius: 12, background: "#fff" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Resultado</div>
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: "#666" }}>Criados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyResult.created)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Atualizados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyResult.updated)}</div>
                </div>
                <div>
                  <div style={{ color: "#666" }}>Ignorados</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIntPT(applyResult.ignored)}</div>
                </div>
              </div>
              {typeof applyResult.deleted === "number" ? (
                <div style={{ marginTop: 10, fontSize: 13, color: "#333" }}>
                  <strong>Apagados:</strong> {formatIntPT(applyResult.deleted)}
                </div>
              ) : null}
              {applyResult.tables?.length ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                  <strong>Tabelas afetadas:</strong> {applyResult.tables.join(", ")}
                </div>
              ) : null}
              {applyResult.errors.length ? (
                <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>
                  <strong>Erros:</strong>
                  <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                    {applyResult.errors.slice(0, 40).map((e) => (
                      <div key={`${e.rowId}:${e.message}`}>
                        {e.rowId}: {e.message}
                      </div>
                    ))}
                    {applyResult.errors.length > 40 ? <div style={{ color: "#777" }}>+ {formatIntPT(applyResult.errors.length - 40)} outros</div> : null}
                  </div>
                </div>
              ) : null}
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <a href={`/${applyResult.module}?source=compat`} style={{ color: "#0b57d0", textDecoration: "underline" }}>
                  Abrir tela do módulo (modo compat)
                </a>
              </div>
            </section>
          ) : null}

          <section style={{ marginTop: 12, padding: 14, border: "1px solid #ffe1a3", borderRadius: 12, background: "#fff9e8" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#7a4b00" }}>Apagar todos os dados antigos deste usuário</div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#7a4b00" }}>
              Confirmação forte obrigatória. Limpa somente dados da empresa selecionada (banco compatível).
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={wipeConfirm}
                onChange={(e) => setWipeConfirm(e.target.value)}
                placeholder="Digite: APAGAR DADOS"
                style={{ border: "1px solid #ffe1a3", borderRadius: 10, padding: "10px 12px", minWidth: 320 }}
              />
              <button
                onClick={() => void wipeAllUserData()}
                disabled={!resolved?.companyId || isWipingUser}
                style={{
                  border: "1px solid #b00020",
                  background: "#b00020",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: resolved?.companyId ? "pointer" : "default",
                  opacity: resolved?.companyId ? 1 : 0.6,
                }}
              >
                {isWipingUser ? "Apagando..." : "Apagar todos os dados antigos deste usuário"}
              </button>
            </div>
            {wipeError ? <div style={{ marginTop: 10, color: "#b00020", fontSize: 13 }}>{wipeError}</div> : null}
            {wipeResult ? (
              <div style={{ marginTop: 10, fontSize: 13, color: "#333", background: "#fff", border: "1px solid #ffe1a3", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 700 }}>{wipeResult.ok ? "OK" : "Falhou"}</div>
                <div style={{ marginTop: 6, color: "#666" }}>
                  Tabelas limpas: {Array.isArray(wipeResult.tables) ? wipeResult.tables.join(", ") : "(não informado)"}
                </div>
                {Array.isArray(wipeResult.steps) && wipeResult.steps.length ? (
                  <div style={{ marginTop: 10, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Tabela", "OK", "Qtd", "Erro"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wipeResult.steps.map((s: any) => (
                          <tr key={String(s.table ?? "")}>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{String(s.table ?? "")}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{s.ok ? "sim" : "não"}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>
                              {typeof s.count === "number" ? formatIntPT(s.count) : "-"}
                            </td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", color: s.ok ? "#666" : "#b00020" }}>
                              {String(s.error ?? "")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
      </div>
    </main>
  );
}
