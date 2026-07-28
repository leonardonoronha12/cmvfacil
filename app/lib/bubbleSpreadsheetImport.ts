"use client";

export type BubbleImportRow = {
  get: (...keys: string[]) => string;
};

export function normalizeBubbleHeader(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeBubbleName(value: string) {
  return repairBubbleText(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function repairBubbleText(value: string) {
  const text = String(value ?? "").trim();
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    return decodeURIComponent(
      Array.from(text)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  } catch {
    return text;
  }
}

export function parseBubbleDecimal(value: string) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma > dot) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) normalized = raw.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function splitBubbleList(value: string) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatBubbleDate(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numeric = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) return `${numeric[1].padStart(2, "0")}/${numeric[2].padStart(2, "0")}/${numeric[3]}`;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export async function readBubbleSpreadsheetFiles(files: File[]): Promise<BubbleImportRow[]> {
  const XLSX = await import("xlsx");
  const rows: BubbleImportRow[] = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const workbook = isCsv
      ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", raw: true })
      : XLSX.read(buffer, { type: "array", raw: true });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      for (const raw of rawRows) {
        const values = new Map(Object.entries(raw).map(([key, value]) => [normalizeBubbleHeader(key), String(value ?? "").trim()]));
        rows.push({
          get: (...keys: string[]) => {
            for (const key of keys) {
              const found = values.get(normalizeBubbleHeader(key));
              if (found !== undefined) return found;
            }
            return "";
          },
        });
      }
    }
  }
  return rows;
}
