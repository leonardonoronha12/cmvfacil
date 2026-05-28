function normalizeKey(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function detectDelimiter(headerLine: string) {
  const comma = (headerLine.match(/,/g) ?? []).length;
  const semicolon = (headerLine.match(/;/g) ?? []).length;
  const tab = (headerLine.match(/\t/g) ?? []).length;
  if (semicolon > comma && semicolon > tab) return ";";
  if (tab > comma && tab > semicolon) return "\t";
  return ",";
}

function parseCsv(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      pushField();
      continue;
    }

    if (ch === "\r") continue;
    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }
    field += ch;
  }

  pushField();
  if (row.length > 1 || row[0] !== "") pushRow();
  return rows;
}

export type CsvObjectRow = Record<string, string>;

export function parseBubbleCsvToObjects(text: string) {
  const firstLine = (text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "").trim();
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return { header: [] as string[], rows: [] as CsvObjectRow[] };

  const headerRaw = rows[0] ?? [];
  const headerNorm = headerRaw.map(normalizeKey);
  const header: string[] = headerNorm.map((k, i) => k || `col_${i + 1}`);

  const out: CsvObjectRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!r.length) continue;
    const obj: CsvObjectRow = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = String(r[c] ?? "").trim();
    }
    out.push(obj);
  }
  return { header, rows: out };
}

export function pickFirst(row: CsvObjectRow, keys: string[]) {
  for (const k of keys) {
    const v = (row[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function parsePtNumber(input: string) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

export function formatMoneyBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateLabelPT(d: Date) {
  const day = d.getDate();
  const year = d.getFullYear();
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const month = months[d.getMonth()] ?? "";
  return `${day} ${month}, ${year}`;
}

export function parseDateLoose(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const dmY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmY) {
    const d = new Date(Number(dmY[3]), Number(dmY[2]) - 1, Number(dmY[1]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return new Date(ts);
  return null;
}

