"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppSidebar from "../../components/AppSidebar";
import SystemToast from "../../components/SystemToast";
import dash from "../../dashboard/dashboard.module.css";

type TemplateKind = "csv" | "xlsx";

type TemplateMeta = {
  name: string;
  mime: string;
  dataBase64: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("failed_to_read_file"));
    reader.readAsDataURL(file);
  });
}

export default function ModelosImportacaoClient() {
  const toastTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);

  const [loading, setLoading] = useState(true);
  const [csvMeta, setCsvMeta] = useState<TemplateMeta | null>(null);
  const [xlsxMeta, setXlsxMeta] = useState<TemplateMeta | null>(null);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);

  const [savingKind, setSavingKind] = useState<TemplateKind | null>(null);

  function showToast(message: string, tone: "success" | "error", durationMs = 6000) {
    setToast({ title: tone === "success" ? "Sucesso" : "Erro", message, tone });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/insumos-templates", { method: "GET" });
      const json = (await res.json().catch(() => null)) as { csv?: TemplateMeta | null; xlsx?: TemplateMeta | null } | null;
      if (!res.ok || !json) throw new Error("failed_to_load");
      setCsvMeta(json.csv ?? null);
      setXlsxMeta(json.xlsx ?? null);
    } catch (err) {
      showToast("Não foi possível carregar os modelos.", "error");
      setCsvMeta(null);
      setXlsxMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function upload(kind: TemplateKind, file: File) {
    setSavingKind(kind);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dataBase64 = (dataUrl.split(",")[1] ?? "").trim();
      if (!dataBase64) throw new Error("invalid_file_data");
      const mime =
        file.type ||
        (kind === "csv" ? "text/csv;charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const payload = { kind, file: { name: file.name, mime, dataBase64 } };
      const res = await fetch("/api/insumos-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
      showToast("Modelo salvo.", "success");
      if (kind === "csv") setCsvFile(null);
      else setXlsxFile(null);
      await refresh();
    } catch (err) {
      showToast(`Não foi possível salvar o modelo. (${err instanceof Error ? err.message : String(err)})`, "error", 8000);
    } finally {
      setSavingKind(null);
    }
  }

  async function download(kind: TemplateKind) {
    try {
      const res = await fetch(`/api/insumos-templates?kind=${encodeURIComponent(kind)}&download=1`, { method: "GET" });
      if (!res.ok) throw new Error("not_found");
      const blob = await res.blob();
      const name = res.headers.get("x-template-filename")?.trim() || (kind === "csv" ? "modelo-planilha-insumos.csv" : "modelo-planilha-insumos.xlsx");
      downloadBlob(blob, name);
    } catch {
      showToast("Não há modelo salvo para baixar.", "error");
    }
  }

  async function remove(kind: TemplateKind) {
    setSavingKind(kind);
    try {
      const res = await fetch(`/api/insumos-templates?kind=${encodeURIComponent(kind)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_delete");
      showToast("Modelo removido. Os botões voltam a usar o modelo padrão.", "success");
      await refresh();
    } catch (err) {
      showToast(`Não foi possível remover. (${err instanceof Error ? err.message : String(err)})`, "error", 8000);
    } finally {
      setSavingKind(null);
    }
  }

  const csvStatus = useMemo(() => (csvMeta ? csvMeta.name : "Nenhum modelo salvo (usa o padrão)."), [csvMeta]);
  const xlsxStatus = useMemo(() => (xlsxMeta ? xlsxMeta.name : "Nenhum modelo salvo (usa o padrão)."), [xlsxMeta]);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      {toast ? <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}

      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <section style={{ background: "#ffffff", borderRadius: 16, padding: 24, border: "1px solid #e4e8e7" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#101214" }}>Modelos de Importação</h1>
                <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: "22px", color: "#6f7c7a", maxWidth: 820 }}>
                  Envie o modelo (.xlsx e/ou .csv) que será baixado pelos botões de “Baixar planilha modelo” dentro do modal de importação de Insumos.
                </p>
              </div>
              <button type="button" className="cmv-button" onClick={() => void refresh()} disabled={loading}>
                {loading ? "Carregando..." : "Recarregar"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 18 }}>
              <div style={{ border: "1px solid #e4e8e7", borderRadius: 14, padding: 16 }}>
                <div style={{ fontWeight: 900 }}>Insumos (CSV)</div>
                <div style={{ marginTop: 8, color: "#6f7c7a", fontSize: 13 }}>{loading ? "Carregando..." : csvStatus}</div>
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <input type="file" accept=".csv,text/csv" onChange={(e) => setCsvFile(e.currentTarget.files?.[0] ?? null)} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" className="cmv-button cmv-button-primary" disabled={!csvFile || savingKind !== null} onClick={() => csvFile && void upload("csv", csvFile)}>
                      {savingKind === "csv" ? "Salvando..." : "Salvar CSV"}
                    </button>
                    <button type="button" className="cmv-button" disabled={savingKind !== null} onClick={() => void download("csv")}>
                      Baixar atual
                    </button>
                    <button type="button" className="cmv-button" disabled={savingKind !== null} onClick={() => void remove("csv")}>
                      Remover
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid #e4e8e7", borderRadius: 14, padding: 16 }}>
                <div style={{ fontWeight: 900 }}>Insumos (XLSX)</div>
                <div style={{ marginTop: 8, color: "#6f7c7a", fontSize: 13 }}>{loading ? "Carregando..." : xlsxStatus}</div>
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setXlsxFile(e.currentTarget.files?.[0] ?? null)} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="cmv-button cmv-button-primary"
                      disabled={!xlsxFile || savingKind !== null}
                      onClick={() => xlsxFile && void upload("xlsx", xlsxFile)}
                    >
                      {savingKind === "xlsx" ? "Salvando..." : "Salvar XLSX"}
                    </button>
                    <button type="button" className="cmv-button" disabled={savingKind !== null} onClick={() => void download("xlsx")}>
                      Baixar atual
                    </button>
                    <button type="button" className="cmv-button" disabled={savingKind !== null} onClick={() => void remove("xlsx")}>
                      Remover
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
