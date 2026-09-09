"use client";

import { useMemo, useState } from "react";

type ExtractedItem = { description: string; quantity: string; unit: string; value: string };
type ExtractedInvoice = {
  supplier: string;
  date: string;
  document: string;
  total: string;
  items: ExtractedItem[];
  rawText: string;
  confidence: number;
};

function normalizeDate(value: string) {
  const match = value.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!match) return "";
  const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
  return `${match[1]!.padStart(2, "0")}/${match[2]!.padStart(2, "0")}/${year}`;
}

function parseInvoice(rawText: string, ocrConfidence: number): ExtractedInvoice {
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const document = rawText.match(/\b\d{2}\.?\d{3}\.?\d{3}[\/]\d{4}-?\d{2}\b/)?.[0] ?? "";
  const dateLine = lines.find((line) => /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(line)) ?? "";
  const totalLine = [...lines].reverse().find((line) => /\b(total|valor a pagar|vl\.? total)\b/i.test(line)) ?? "";
  const total = totalLine.match(/(?:total|valor a pagar|vl\.? total)\s*:?[\s\S]*?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i)?.[1] ?? "";
  const ignored = /danfe|nota fiscal|documento auxiliar|cnpj|cpf|chave|protocolo|total|tribut|imposto|emitente/i;
  const supplierLine = lines.find((line) => /^(?:fornecedor|raz[aã]o social)\s*:/i.test(line));
  const supplier = supplierLine?.replace(/^(?:fornecedor|raz[aã]o social)\s*:\s*/i, "")
    ?? lines.find((line) => line.length >= 4 && line.length <= 80 && !ignored.test(line) && !/^\d+$/.test(line))
    ?? "";
  const items: ExtractedItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(.{3,}?)\s+(\d+(?:[.,]\d{1,3})?)\s*(UN|UND|KG|G|L|ML|CX|PCT)\s+(?:R\$\s*)?(\d+(?:\.\d{3})*[.,]\d{2})(?:\s+(?:R\$\s*)?\d+(?:\.\d{3})*[.,]\d{2})?$/i);
    if (!match || ignored.test(line)) continue;
    items.push({ description: match[1]!.trim(), quantity: match[2]!, unit: (match[3] ?? "Und").toUpperCase(), value: match[4]! });
    if (items.length >= 100) break;
  }
  const found = [supplier, normalizeDate(dateLine), document, total].filter(Boolean).length;
  const confidence = Math.max(0, Math.min(100, Math.round(ocrConfidence * 0.65 + found * 7 + Math.min(items.length, 3) * 2)));
  return { supplier, date: normalizeDate(dateLine), document, total, items, rawText, confidence };
}

function pdfTextLines(items: Array<Record<string, unknown>>) {
  const positioned = items.flatMap((item) => {
    const text = typeof item.str === "string" ? item.str.trim() : "";
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    return text && Number.isFinite(x) && Number.isFinite(y) ? [{ text, x, y }] : [];
  });
  const rows: Array<{ y: number; parts: Array<{ text: string; x: number }> }> = [];
  for (const item of positioned.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (!row) { row = { y: item.y, parts: [] }; rows.push(row); }
    row.parts.push({ text: item.text, x: item.x });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" "))
    .join("\n");
}

async function imageToText(source: File | HTMLCanvasElement, onProgress: (value: number) => void) {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(source, "por", { logger: (message) => {
    if (message.status === "recognizing text" && typeof message.progress === "number") onProgress(message.progress);
  } });
  return { text: result.data.text, confidence: Number(result.data.confidence || 0) };
}

async function readLocally(file: File, onProgress: (value: number) => void) {
  if (file.type.startsWith("image/")) return imageToText(file, onProgress);
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Use uma imagem ou um arquivo PDF.");
  const pdfjs = await import("pdfjs-dist");
  // Only the public PDF.js worker is fetched. The selected document stays in
  // this browser and is passed directly as an ArrayBuffer to PDF.js.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const texts: string[] = [];
  let confidence = 0;
  const pages = Math.min(pdf.numPages, 5);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const embedded = pdfTextLines(content.items as Array<Record<string, unknown>>).trim();
    if (embedded.length > 40) {
      texts.push(embedded);
      confidence += 96;
    } else {
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await imageToText(canvas, (value) => onProgress((pageNumber - 1 + value) / pages));
      texts.push(result.text);
      confidence += result.confidence;
    }
    onProgress(pageNumber / pages);
  }
  return { text: texts.join("\n"), confidence: pages ? confidence / pages : 0 };
}

export default function InvoiceLocalReader({ onClose, onUse }: { onClose: () => void; onUse: (invoice: ExtractedInvoice) => void }) {
  const [invoice, setInvoice] = useState<ExtractedInvoice | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const confidenceTone = useMemo(() => !invoice ? "#64748b" : invoice.confidence >= 80 ? "#07845e" : invoice.confidence >= 55 ? "#9a6700" : "#b42318", [invoice]);

  async function selectFile(file?: File) {
    if (!file) return;
    setWorking(true); setProgress(0); setError(""); setInvoice(null); setReviewed(false);
    try {
      const result = await readLocally(file, setProgress);
      setInvoice(parseInvoice(result.text, result.confidence));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler este arquivo.");
    } finally { setWorking(false); }
  }

  return <div className="cmv-local-reader-backdrop" role="presentation" onClick={onClose}>
    <section className="cmv-local-reader" role="dialog" aria-modal="true" aria-label="Leitura local de nota" onClick={(event) => event.stopPropagation()}>
      <header><div><strong>Ler nota por foto ou PDF</strong><small>O arquivo é processado neste navegador e não é enviado a terceiros.</small></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header>
      <div className="cmv-local-reader-body">
        <label className="cmv-local-reader-upload"><input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => void selectFile(event.target.files?.[0])} disabled={working}/><b>{working ? `Lendo… ${Math.round(progress * 100)}%` : "Selecionar foto ou PDF"}</b><span>PNG, JPG, WebP ou PDF — até 5 páginas</span></label>
        {error ? <p className="cmv-local-reader-error" role="alert">{error}</p> : null}
        {invoice ? <>
          <div className="cmv-local-reader-confidence" style={{ color: confidenceTone }}><b>Confiança da leitura: {invoice.confidence}%</b><span>Confira os campos antes de usar.</span></div>
          <div className="cmv-local-reader-grid">
            <label>Fornecedor<input value={invoice.supplier} onChange={(e) => setInvoice({ ...invoice, supplier: e.target.value })}/></label>
            <label>Data<input value={invoice.date} onChange={(e) => setInvoice({ ...invoice, date: e.target.value })}/></label>
            <label>CNPJ<input value={invoice.document} onChange={(e) => setInvoice({ ...invoice, document: e.target.value })}/></label>
            <label>Total<input value={invoice.total} onChange={(e) => setInvoice({ ...invoice, total: e.target.value })}/></label>
          </div>
          <div className="cmv-local-reader-items"><b>Itens encontrados ({invoice.items.length})</b>{invoice.items.length ? invoice.items.map((item, index) => <div key={`${item.description}-${index}`}><input aria-label={`Descrição do item ${index + 1}`} value={item.description} onChange={(e) => { const items=[...invoice.items]; items[index]={...item,description:e.target.value}; setInvoice({...invoice,items}); }}/><input aria-label={`Quantidade do item ${index + 1}`} value={item.quantity} readOnly/><input aria-label={`Unidade do item ${index + 1}`} value={item.unit} readOnly/><input aria-label={`Valor do item ${index + 1}`} value={item.value} readOnly/></div>) : <p>Nenhuma linha foi reconhecida automaticamente. Você ainda pode usar fornecedor e data e incluir os itens manualmente.</p>}</div>
          <details><summary>Texto reconhecido</summary><textarea value={invoice.rawText} onChange={(e) => setInvoice(parseInvoice(e.target.value, invoice.confidence))}/></details>
          <label className="cmv-local-reader-review"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}/>Revisei os dados e confirmo que serão conferidos novamente antes de salvar a nota.</label>
        </> : null}
      </div>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" disabled={!invoice || !reviewed || working} onClick={() => invoice && onUse(invoice)}>Usar na nova nota</button></footer>
    </section>
  </div>;
}
