"use client";

import { useEffect, useMemo, useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import styles from "./consumo-interno.module.css";

type Item = { id: string; item: string; medida: string; custoMedio: string; operationalImageUrl?: string };
type Reason = { id: string; name: string };
type Row = { id: string; item_name: string; quantity: number; unit: string; total_cost: number; reason_text: string; occurred_on: string; notes?: string | null };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function parseCost(value: string) { const n = Number(value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; }
function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export default function ConsumoInternoClient() {
  const [rows, setRows] = useState<Row[]>([]); const [reasons, setReasons] = useState<Reason[]>([]); const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [uploadingPhoto, setUploadingPhoto] = useState(false); const [error, setError] = useState("");
  const [itemId, setItemId] = useState(""); const [quantity, setQuantity] = useState(""); const [reasonId, setReasonId] = useState(""); const [customReason, setCustomReason] = useState(""); const [notes, setNotes] = useState(""); const [date, setDate] = useState(() => localDateValue());
  const selected = useMemo(() => items.find((item) => item.id === itemId) ?? null, [items, itemId]);

  async function load() {
    setLoading(true); setError("");
    try {
      const [consumptionResponse, itemsResponse] = await Promise.all([fetch("/api/consumo-interno", { cache: "no-store" }), fetch("/api/insumos", { cache: "no-store" })]);
      const consumption = await consumptionResponse.json(); const itemPayload = await itemsResponse.json();
      if (!consumptionResponse.ok) throw new Error(consumption.error || "Não foi possível carregar os consumos.");
      setRows(consumption.rows ?? []); setReasons(consumption.reasons ?? []); setItems((itemPayload.rows ?? []).map((item: any) => ({ id: String(item.id ?? ""), item: String(item.item ?? item.name ?? ""), medida: String(item.medida ?? item.unidade_medida ?? "Und"), custoMedio: String(item.custoMedio ?? item.custo_medio ?? "0"), operationalImageUrl: String(item.operationalImageUrl ?? "") || undefined })).filter((item: Item) => item.item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar."); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!selected || saving) return;
    const reason = reasons.find((entry) => entry.id === reasonId)?.name || customReason.trim();
    if (!reason) { setError("Escolha ou informe o motivo."); return; }
    setSaving(true); setError("");
    try {
      const rawId = selected.id.startsWith("db:") ? selected.id.slice(3) : selected.id;
      const response = await fetch("/api/consumo-interno", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: rawId, itemName: selected.item, quantity, unit: selected.medida, unitCost: parseCost(selected.custoMedio), reasonId: reasonId || null, reasonText: reason, occurredOn: date, notes }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Não foi possível registrar.");
      setQuantity(""); setNotes(""); setCustomReason(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar."); } finally { setSaving(false); }
  }

  async function remove(id: string) { if (!window.confirm("Excluir este registro de consumo interno?")) return; const response = await fetch(`/api/consumo-interno?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (response.ok) setRows((current) => current.filter((row) => row.id !== id)); else setError("Não foi possível excluir o registro."); }

  async function uploadPhoto(file?: File) {
    if (!file || !selected || uploadingPhoto) return;
    setUploadingPhoto(true); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("itemId", selected.id);
      const response = await fetch("/api/insumos/photo", { method: "POST", body: form }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a foto.");
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, operationalImageUrl: payload.publicUrl } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar foto."); } finally { setUploadingPhoto(false); }
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
  return <main className={dash.content}><div className={`${dash.pageFrame} ${styles.page}`}>
    <header className={styles.header}><div><span>USO OPERACIONAL</span><h1>Consumo interno</h1><p>Registre refeições da equipe, testes, cortesias e outros usos que reduzem o estoque sem serem vendas.</p></div><div className={styles.summary}><b>{rows.length}</b><small>registros</small><strong>{money.format(total)}</strong></div></header>
    <form className={styles.form} onSubmit={submit}>
      <label>Insumo<select required value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Selecione…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.item} — {item.medida}</option>)}</select></label>
      <label className={styles.photoField}>Foto operacional<div className={styles.photoControl}>{selected?.operationalImageUrl ? <img src={selected.operationalImageUrl} alt={selected.item}/> : <span>Sem foto</span>}<label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!selected || uploadingPhoto} onChange={(e) => void uploadPhoto(e.target.files?.[0])}/>{uploadingPhoto ? "Enviando…" : "Adicionar foto"}</label></div></label>
      <label>Quantidade<input required inputMode={selected?.medida === "Und" ? "numeric" : "decimal"} value={quantity} onChange={(e) => setQuantity(selected?.medida === "Und" ? e.target.value.replace(/\D/g, "") : e.target.value.replace(/[^\d,]/g, ""))} placeholder={selected?.medida === "Und" ? "1" : "0,100"}/><small>{selected?.medida || "Unidade do insumo"}</small></label>
      <label>Data<input required type="date" value={date} onChange={(e) => setDate(e.target.value)}/></label>
      <label>Motivo<select value={reasonId} onChange={(e) => setReasonId(e.target.value)}><option value="">Outro motivo…</option>{reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label>
      {!reasonId ? <label className={styles.wide}>Descreva o motivo<input required value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Ex.: degustação da equipe"/></label> : null}
      <label className={styles.wide}>Observação opcional<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Informação útil para o histórico"/></label>
      <button type="submit" disabled={saving || !selected}>{saving ? "Registrando…" : "Registrar consumo"}</button>
    </form>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <section className={styles.card} aria-busy={loading}><div className={styles.tableHead}><b>Data</b><b>Item</b><b>Quantidade</b><b>Motivo</b><b>Custo</b><span>Ação</span></div>{loading ? <div className={styles.empty}>Carregando histórico…</div> : rows.length ? rows.map((row) => <div className={styles.row} key={row.id}><span data-label="Data">{new Date(`${row.occurred_on}T12:00:00`).toLocaleDateString("pt-BR")}</span><strong data-label="Item">{row.item_name}</strong><span data-label="Quantidade">{Number(row.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {row.unit}</span><span data-label="Motivo">{row.reason_text}</span><span data-label="Custo">{money.format(Number(row.total_cost || 0))}</span><button type="button" onClick={() => void remove(row.id)}>Excluir</button></div>) : <div className={styles.empty}>Nenhum consumo interno registrado.</div>}</section>
    <p className={styles.note}>Esses registros explicam saídas operacionais. Eles não são contabilizados como vendas e não são somados novamente ao CMV calculado entre inventários.</p>
  </div></main>;
}
