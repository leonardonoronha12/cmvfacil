"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import styles from "../importar-bubble/importar-bubble.module.css";

export default function ConexaoMigracaoClient() {
  const [email, setEmail] = useState("");
  const [pasted, setPasted] = useState("");

  const [resolved, setResolved] = useState<null | { userId: string; email: string; companyId: string; companyName: string | null }>(null);
  const [resolveError, setResolveError] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  const [existing, setExisting] = useState<any[]>([]);
  const [existingError, setExistingError] = useState("");
  const [loadingExisting, setLoadingExisting] = useState(false);

  const [analysis, setAnalysis] = useState<any | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [showFullPreview, setShowFullPreview] = useState(false);

  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [applyError, setApplyError] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  const [wipeError, setWipeError] = useState("");
  const [isWiping, setIsWiping] = useState(false);

  const resolveSeqRef = useRef(0);
  const analyzeSeqRef = useRef(0);

  const moduleLabel = useMemo(() => String(analysis?.module ?? "").trim() || "—", [analysis]);

  const draftRows = useMemo<any[]>(() => {
    const rows = Array.isArray(analysis?.rows) ? (analysis.rows as any[]) : [];
    return rows;
  }, [analysis]);

  const validDraftRows = useMemo<any[]>(() => {
    return draftRows.filter((r: any) => !r?.invalid);
  }, [draftRows]);

  const canSaveValid = Boolean(resolved?.companyId && analysis?.ok && validDraftRows.length && !isApplying);

  function recomputeInvalidRow(row: any, mod: string) {
    const module = String(mod ?? "").trim().toLowerCase();
    const missing: string[] = [];
    if (module === "fichas-tecnicas") {
      if (!String(row?.receita ?? "").trim()) missing.push("receita");
      if (!String(row?.precoVenda ?? "").trim()) missing.push("precoVenda");
      if (!String(row?.custoUnitario ?? "").trim()) missing.push("custoUnitario");
      if (!String(row?.cmvMeta ?? "").trim()) missing.push("cmvMeta");
      if (!String(row?.cmvAtual ?? "").trim()) missing.push("cmvAtual");
      if (!String(row?.bcg ?? "").trim()) missing.push("bcg");
    } else {
      if (!String(row?.item ?? "").trim()) missing.push("item");
      if (!String(row?.medida ?? "").trim()) missing.push("medida");
      if (!String(row?.custoMedio ?? "").trim()) missing.push("custoMedio");
      if (!String(row?.categoria ?? "").trim()) missing.push("categoria");
    }
    return { ...row, missingKeys: missing, invalid: missing.length > 0 };
  }

  function updateDraftRow(rowId: string, patch: Record<string, unknown>) {
    const id = String(rowId ?? "").trim();
    if (!id) return;
    setAnalysis((prev: any) => {
      if (!prev || typeof prev !== "object") return prev;
      const rows = Array.isArray((prev as any).rows) ? ((prev as any).rows as any[]) : null;
      if (!rows) return prev;
      const mod = String((prev as any).module ?? "").trim();
      const nextRows = rows.map((r) => {
        if (String(r?.rowId ?? "") !== id) return r;
        return recomputeInvalidRow({ ...r, ...patch }, mod);
      });
      return { ...(prev as any), rows: nextRows };
    });
  }

  async function resolveUserByEmail(targetEmail: string) {
    const em = String(targetEmail ?? "").trim().toLowerCase();
    if (!em || !em.includes("@")) return;
    const seq = ++resolveSeqRef.current;
    setIsResolving(true);
    setResolveError("");
    setResolved(null);
    setExisting([]);
    setExistingError("");
    setAnalysis(null);
    setAnalysisError("");
    setApplyResult(null);
    setApplyError("");
    try {
      const res = await fetch("/api/admin/importacao-manual/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: em }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (seq !== resolveSeqRef.current) return;
      if (!res?.ok || !json?.ok) {
        setResolveError(String(json?.error ?? "Falha ao resolver usuário."));
        return;
      }
      const u = json.user as any;
      setResolved({
        userId: String(u?.userId ?? "").trim(),
        email: String(u?.email ?? "").trim(),
        companyId: String(u?.companyId ?? "").trim(),
        companyName: u?.companyName ? String(u.companyName).trim() : null,
      });
    } finally {
      if (seq === resolveSeqRef.current) setIsResolving(false);
    }
  }

  async function loadExistingInsumos(targetUserId: string) {
    const uid = String(targetUserId ?? "").trim();
    if (!uid) return;
    setLoadingExisting(true);
    setExistingError("");
    try {
      const res = await fetch(`/api/insumos?userId=${encodeURIComponent(uid)}&source=compat`, { cache: "no-store" }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok) {
        setExistingError(String(json?.error ?? "Falha ao carregar insumos do sistema."));
        setExisting([]);
        return;
      }
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      setExisting(rows);
    } finally {
      setLoadingExisting(false);
    }
  }

  async function loadExistingFichasTecnicas(targetUserId: string) {
    const uid = String(targetUserId ?? "").trim();
    if (!uid) return;
    setLoadingExisting(true);
    setExistingError("");
    try {
      const res = await fetch(`/api/fichas-tecnicas?userId=${encodeURIComponent(uid)}`, { cache: "no-store" }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok) {
        setExistingError(String(json?.error ?? "Falha ao carregar fichas técnicas do sistema."));
        setExisting([]);
        return;
      }
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      setExisting(rows);
    } finally {
      setLoadingExisting(false);
    }
  }

  async function loadExistingForDetectedModule(targetUserId: string, mod: string) {
    const m = String(mod ?? "").trim().toLowerCase();
    if (m === "fichas-tecnicas") return loadExistingFichasTecnicas(targetUserId);
    return loadExistingInsumos(targetUserId);
  }

  async function analyzePasted() {
    setAnalysisError("");
    setAnalysis(null);
    setApplyResult(null);
    setApplyError("");
    setShowFullPreview(false);
    if (!resolved?.companyId) return;
    if (!pasted.trim()) return;
    const seq = ++analyzeSeqRef.current;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: "auto", text: pasted }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (seq !== analyzeSeqRef.current) return;
      if (!res?.ok || !json?.ok) {
        setAnalysisError(String(json?.error ?? "Falha ao analisar os registros."));
        return;
      }
      setAnalysis(json.result ?? null);
    } finally {
      if (seq === analyzeSeqRef.current) setIsAnalyzing(false);
    }
  }

  async function apply() {
    setApplyError("");
    setApplyResult(null);
    if (!resolved?.companyId) return;
    if (!analysis?.ok) {
      setApplyError("Cole os registros para preparar antes de salvar.");
      return;
    }
    const mod = String(analysis?.module ?? "").trim();
    if (mod !== "insumos" && mod !== "fichas-tecnicas") {
      setApplyError(`Módulo detectado: ${mod || "—"}. Importação manual ainda não habilitada.`);
      return;
    }
    const safeRows = Array.isArray(analysis?.rows) ? (analysis.rows as any[]).filter((r) => !r?.invalid) : [];
    if (!safeRows.length) {
      setApplyError("Nenhuma linha válida para salvar. Corrija as linhas marcadas em vermelho.");
      return;
    }
    const typed = window.prompt("Digite SALVAR para confirmar:") ?? "";
    if (String(typed).trim().toUpperCase() !== "SALVAR") {
      setApplyError("Confirmação cancelada.");
      return;
    }

    setIsApplying(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, module: analysis.module, rows: safeRows }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        setApplyError(String(json?.error ?? "Falha ao salvar registros."));
        return;
      }
      setApplyResult(json.result ?? null);
      await loadExistingForDetectedModule(resolved.userId, mod);
    } finally {
      setIsApplying(false);
    }
  }

  async function wipe() {
    setWipeError("");
    if (!resolved?.companyId || !resolved.email) return;
    const required = `APAGAR DADOS DE ${resolved.email.toUpperCase()}`;
    const typed = window.prompt("Digite exatamente:", required) ?? "";
    if (String(typed).trim().toUpperCase().replace(/\s+/g, " ") !== required) {
      setWipeError("Confirmação inválida.");
      return;
    }
    setIsWiping(true);
    try {
      const res = await fetch("/api/admin/importacao-manual/clear-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resolved.email, companyId: resolved.companyId, confirm: typed }),
      }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json?.ok) {
        setWipeError(String(json?.error ?? "Falha ao apagar dados."));
        return;
      }
      setExisting([]);
      setAnalysis(null);
      setApplyResult(null);
      await loadExistingForDetectedModule(resolved.userId, moduleLabel);
    } finally {
      setIsWiping(false);
    }
  }

  useEffect(() => {
    const em = String(email ?? "").trim().toLowerCase();
    if (!em || !em.includes("@")) return;
    setResolveError("");
    const t = window.setTimeout(() => {
      void resolveUserByEmail(em);
    }, 450);
    return () => window.clearTimeout(t);
  }, [email]);

  useEffect(() => {
    if (!resolved?.userId) return;
    void loadExistingForDetectedModule(resolved.userId, moduleLabel);
  }, [resolved?.userId, moduleLabel]);

  useEffect(() => {
    if (!resolved?.companyId) return;
    if (!pasted.trim()) return;
    setAnalysisError("");
    const t = window.setTimeout(() => {
      void analyzePasted();
    }, 500);
    return () => window.clearTimeout(t);
  }, [pasted, resolved?.companyId]);

  function renderTable(args: { title: string; rows: any[]; kind: "existing" | "draft" }) {
    const rows = Array.isArray(args.rows) ? args.rows : [];
    const isFichas = moduleLabel === "fichas-tecnicas";
    const showSampleOnly = args.kind === "draft" && rows.length > 1 && !showFullPreview;
    const rowsToRender = args.kind === "draft" ? (showFullPreview ? rows.slice(0, 200) : rows.slice(0, 1)) : rows.slice(0, 200);
    return (
      <div style={{ flex: 1, minWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div className={styles.fileName}>{args.title}</div>
          {args.kind === "draft" && rows.length > 1 ? (
            <button type="button" className={styles.btn} onClick={() => setShowFullPreview((v) => !v)}>
              {showFullPreview ? "Mostrar só 1" : `Mostrar todos (${rows.length.toLocaleString("pt-BR")})`}
            </button>
          ) : null}
        </div>
        <div className={styles.pathsBox} style={{ marginTop: 8, maxHeight: 520, overflow: "auto" }}>
          {!rows.length ? <div className={styles.fileMeta}>—</div> : null}
          {showSampleOnly ? <div className={styles.fileMeta}>Prévia mostrando 1 item. Os demais seguem o mesmo formato.</div> : null}
          {rows.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  {isFichas ? (
                    <>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Receita</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>Preço Venda</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>Custo Unit.</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>CMV Meta</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>CMV Atual</th>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>BCG</th>
                    </>
                  ) : (
                    <>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Item</th>
                      <th style={{ textAlign: "left", padding: "8px 6px" }}>Categoria</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>Medida</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", whiteSpace: "nowrap" }}>Custo</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rowsToRender.map((r, idx) => {
                  const key = String(r?.id ?? r?.rowId ?? idx);
                  const missing = new Set(Array.isArray(r?.missingKeys) ? (r.missingKeys as any[]).map((x) => String(x ?? "")) : []);
                  const invalid = Boolean(args.kind === "draft" && (r as any)?.invalid);
                  const cellStyle = (k: string) =>
                    invalid && missing.has(k)
                      ? { background: "#fff3f5", color: "#b1002c", fontWeight: 800 }
                      : invalid
                        ? { background: "#fff9fb" }
                        : null;
                  if (isFichas) {
                    const receita = String(r?.receita ?? r?.recipeName ?? "");
                    const precoVenda = String(r?.precoVenda ?? "");
                    const custoUnitario = String(r?.custoUnitario ?? "");
                    const cmvMeta = String(r?.cmvMeta ?? "");
                    const cmvAtual = String(r?.cmvAtual ?? "");
                    const bcg = String(r?.bcg ?? r?.quadrante ?? "");
                    const isDraft = args.kind === "draft";
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 6px", ...(cellStyle("receita") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={receita} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { receita: e.currentTarget.value })} />
                          ) : (
                            receita || "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("precoVenda") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={precoVenda} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { precoVenda: e.currentTarget.value })} />
                          ) : (
                            precoVenda || "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("custoUnitario") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={custoUnitario} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { custoUnitario: e.currentTarget.value })} />
                          ) : (
                            custoUnitario || "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("cmvMeta") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={cmvMeta} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { cmvMeta: e.currentTarget.value })} />
                          ) : (
                            cmvMeta || "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("cmvAtual") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={cmvAtual} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { cmvAtual: e.currentTarget.value })} />
                          ) : (
                            cmvAtual || "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 6px", ...(cellStyle("bcg") ?? {}) }}>
                          {isDraft ? (
                            <input className={styles.input} value={bcg} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { bcg: e.currentTarget.value })} />
                          ) : (
                            bcg || "—"
                          )}
                        </td>
                      </tr>
                    );
                  }

                  const item = String(r?.item ?? "");
                  const categoria = String(r?.categoria ?? "");
                  const medida = String(r?.medida ?? "");
                  const custo = String(r?.custoMedio ?? "");
                  const isDraft = args.kind === "draft";
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "8px 6px", ...(cellStyle("item") ?? {}) }}>
                        {isDraft ? (
                          <input className={styles.input} value={item} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { item: e.currentTarget.value })} />
                        ) : (
                          item || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 6px", ...(cellStyle("categoria") ?? {}) }}>
                        {isDraft ? (
                          <input className={styles.input} value={categoria} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { categoria: e.currentTarget.value })} />
                        ) : (
                          categoria || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("medida") ?? {}) }}>
                        {isDraft ? (
                          <input className={styles.input} value={medida} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { medida: e.currentTarget.value })} />
                        ) : (
                          medida || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 6px", whiteSpace: "nowrap", ...(cellStyle("custoMedio") ?? {}) }}>
                        {isDraft ? (
                          <input className={styles.input} value={custo} onChange={(e) => updateDraftRow(String(r?.rowId ?? ""), { custoMedio: e.currentTarget.value })} />
                        ) : (
                          custo || "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div>
                <h1 className={styles.title}>Migração manual</h1>
                <p className={styles.sub}>Cole o email e os registros do Bubble. A página mostra o que já existe e o que será salvo.</p>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.fileList}>
                <div className={styles.fileRow} style={{ alignItems: "stretch" }}>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className={styles.fileMeta}>Email do usuário</div>
                        <input className={styles.input} value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="ex: usuario@dominio.com" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className={styles.fileMeta}>Registros do Bubble (cole aqui)</div>
                        <textarea className={styles.textarea} value={pasted} onChange={(e) => setPasted(e.currentTarget.value)} rows={10} placeholder="Cole a exportação/planilha/texto do Bubble do usuário" />
                      </label>
                    </div>

                    {resolveError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{resolveError}</div> : null}
                    {resolved ? <div className={styles.fileMeta}>empresa: {resolved.companyName ?? "(sem nome)"} ({resolved.companyId})</div> : null}
                    {analysisError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{analysisError}</div> : null}
                    {applyError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{applyError}</div> : null}
                    {wipeError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{wipeError}</div> : null}

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void apply()} disabled={!canSaveValid}>
                        {isApplying ? "Salvando..." : "Salvar registros"}
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void wipe()} disabled={!resolved?.companyId || isWiping}>
                        {isWiping ? "Apagando..." : "Apagar dados do sistema"}
                      </button>
                      <div className={styles.fileMeta}>
                        {isResolving ? "resolvendo usuário..." : resolved?.userId ? `userId: ${resolved.userId.slice(0, 8)}…` : "—"}
                        {" • "}
                        {loadingExisting ? "carregando sistema..." : `no sistema: ${existing.length.toLocaleString("pt-BR")}`}
                        {" • "}
                        {isAnalyzing ? "preparando..." : `para salvar (${moduleLabel}): ${validDraftRows.length.toLocaleString("pt-BR")}/${draftRows.length.toLocaleString("pt-BR")}`}
                        {applyResult ? ` • salvo: +${Number(applyResult?.created ?? 0)}/~${Number(applyResult?.updated ?? 0)}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {existingError ? <div className={`${styles.fileMeta} ${styles.statusErr}`}>{existingError}</div> : null}

              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
                {renderTable({ title: moduleLabel === "fichas-tecnicas" ? "No sistema (Fichas Técnicas)" : "No sistema (Insumos)", rows: existing, kind: "existing" })}
                {renderTable({ title: "Para salvar (prévia)", rows: draftRows, kind: "draft" })}
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
