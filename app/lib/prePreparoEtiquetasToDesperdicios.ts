"use client";

import type { DesperdicioRow } from "./desperdiciosStore";
import type { PrePreparoEtiquetaRow } from "./prePreparoEtiquetasStore";

const ETIQUETA_WASTE_PREFIX = "etiqueta-vencida:";

function parsePtNumber(value: string) {
  const s = value.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "");
  const num = Number.parseFloat(`${intPart}.${decPart}`);
  return neg ? -num : num;
}

function parseDateLabelLoose(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\s*([A-Za-zÀ-ÿ]{3,})[,\s]+(\d{4})$/);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const monRaw = m[2].toLowerCase().replace(".", "");
  const year = Number.parseInt(m[3], 10);
  const monthMap: Record<string, number> = {
    jan: 0,
    janeiro: 0,
    feb: 1,
    fev: 1,
    fevereiro: 1,
    mar: 2,
    março: 2,
    marco: 2,
    apr: 3,
    abr: 3,
    abril: 3,
    may: 4,
    mai: 4,
    maio: 4,
    jun: 5,
    junho: 5,
    jul: 6,
    julho: 6,
    aug: 7,
    ago: 7,
    agosto: 7,
    sep: 8,
    set: 8,
    setembro: 8,
    oct: 9,
    out: 9,
    outubro: 9,
    nov: 10,
    novembro: 10,
    dec: 11,
    dez: 11,
    dezembro: 11,
  };
  const month = monthMap[monRaw];
  if (month === undefined) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function formatDateLabelLowerPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()];
  return `${day} ${month}, ${year}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isPrePreparoEtiquetaWasteId(id: string) {
  return String(id ?? "").startsWith(ETIQUETA_WASTE_PREFIX);
}

function desperdicioRowsEqual(a: DesperdicioRow, b: DesperdicioRow) {
  return a.id === b.id && a.data === b.data && a.item === b.item && a.quantidade === b.quantidade && a.custo === b.custo && a.motivo === b.motivo;
}

export function buildExpiredPrePreparoEtiquetaDesperdicios(labels: PrePreparoEtiquetaRow[], referenceDate = new Date()): DesperdicioRow[] {
  const today = startOfDay(referenceDate).getTime();
  const out: Array<DesperdicioRow & { t: number }> = [];
  for (const label of labels) {
    const validade = parseDateLabelLoose(label.dataValidade);
    if (!validade) continue;
    const validadeTime = startOfDay(validade).getTime();
    if (validadeTime >= today) continue;
    const quantidadeValor = parsePtNumber(label.quantidade);
    const quantidade = `${quantidadeValor > 0 ? label.quantidade : "0,000"} ${label.unidade}`.trim();
    out.push({
      id: `${ETIQUETA_WASTE_PREFIX}${label.id}`,
      data: formatDateLabelLowerPT(validade),
      item: label.receita,
      quantidade,
      custo: String(label.custo ?? "").trim() || "R$0,00",
      motivo: "Validade Vencida",
      t: validadeTime,
    });
  }
  out.sort((a, b) => b.t - a.t);
  return out.map(({ t: _t, ...row }) => row);
}

export function getExpiredPrePreparoEtiquetaDesperdicioSync(rows: DesperdicioRow[], labels: PrePreparoEtiquetaRow[], referenceDate = new Date()) {
  const generated = buildExpiredPrePreparoEtiquetaDesperdicios(labels, referenceDate);
  const generatedMap = new Map(generated.map((row) => [row.id, row]));
  const currentGenerated = rows.filter((row) => isPrePreparoEtiquetaWasteId(row.id));
  const currentGeneratedMap = new Map(currentGenerated.map((row) => [row.id, row]));
  const manualRows = rows.filter((row) => !isPrePreparoEtiquetaWasteId(row.id));

  const upserts = generated.filter((row) => {
    const existing = currentGeneratedMap.get(row.id);
    return !existing || !desperdicioRowsEqual(existing, row);
  });

  const deletes = currentGenerated.filter((row) => !generatedMap.has(row.id));
  const merged = [...generated, ...manualRows];

  return { generated, merged, upserts, deletes };
}
