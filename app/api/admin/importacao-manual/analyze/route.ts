import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

function normalizeSpace(s: string) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s: string) {
  return normalizeSpace(s).toLowerCase();
}

function pickDelimiter(text: string) {
  const sample = text.split(/\r?\n/g).slice(0, 10);
  const count = (ch: string) => sample.reduce((acc, line) => acc + (String(line).split(ch).length - 1), 0);
  const tabs = count("\t");
  if (tabs >= 1) return "\t";
  const semi = count(";");
  if (semi >= 3) return ";";
  return "SPACES";
}

function looksLikeHeaderCell(cell: string) {
  const k = normKey(cell);
  if (!k) return false;
  const hits = ["item", "insumo", "nome", "medida", "unidade", "categoria", "classe", "custo", "cmv", "especific", "descri", "ocultar", "bubble", "id"];
  return hits.some((h) => k.includes(h));
}

type ColKey = "bubbleId" | "item" | "medida" | "custoMedio" | "categoria" | "especificacao" | "ocultar";

function mapHeaderToKey(cell: string): ColKey | null {
  const k = normKey(cell)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!k) return null;
  if (k === "id" || k.includes("bubble") || k.includes("unique") || k.includes("_id")) return "bubbleId";
  if (k.includes("item") || k.includes("insumo") || k.includes("produto") || k === "nome") return "item";
  if (k.includes("medida") || k.includes("unidade") || k.includes("und") || k.includes("unid")) return "medida";
  if (k.includes("custo") || k.includes("cmv") || k.includes("preco") || k.includes("valor")) return "custoMedio";
  if (k.includes("categoria") || k.includes("classe") || k.includes("grupo")) return "categoria";
  if (k.includes("especific") || k.includes("descricao") || k.includes("detalhe") || k.includes("obs")) return "especificacao";
  if (k.includes("ocultar") || k.includes("esconder")) return "ocultar";
  return null;
}

function parseBooleanLoose(v: string) {
  const k = normKey(v);
  if (!k) return false;
  if (k === "1" || k === "true" || k === "sim" || k === "s" || k === "yes") return true;
  if (k === "0" || k === "false" || k === "nao" || k === "não" || k === "n" || k === "no") return false;
  return false;
}

function detectUnitLoose(v: string) {
  const k = normKey(v);
  const units = ["kg", "g", "gr", "mg", "l", "ml", "und", "un", "unid", "unidade", "pct", "pc", "cx", "fardo", "lt"];
  if (units.some((u) => k === u || k.includes(` ${u}`) || k.includes(`${u} `))) return v;
  return "";
}

function splitCells(line: string, delim: string) {
  const s = String(line ?? "");
  if (delim === "SPACES") return s.split(/\s{2,}/g).map((c) => normalizeSpace(c));
  return s.split(delim).map((c) => normalizeSpace(c));
}

type ModuleKey = "insumos" | "fornecedores" | "entradas" | "inventario" | "desperdicios" | "fichas-tecnicas" | "pre-preparo";

function normalizeHeaderToken(raw: string) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseSimpleSemicolonFormat(inputRaw: string) {
  const raw = String(inputRaw ?? "").replace(/\r\n/g, "\n");
  const all = raw
    .split("\n")
    .map((l) => String(l ?? ""))
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => normalizeHeaderToken(l) !== "FIM");
  if (all.length < 2) return null;
  let idx = 0;
  let moduleRaw = "";
  const first = String(all[0] ?? "").trim();
  const m = /^MODULO\s*=\s*(.+)$/i.exec(first);
  if (m?.[1]) {
    moduleRaw = String(m[1]).trim();
    idx = 1;
  }
  const headerLine = String(all[idx] ?? "").trim();
  if (!headerLine.includes(";")) return null;
  const headerTokens = headerLine.split(";").map((c) => String(c ?? "").trim());
  if (headerTokens.length < 2) return null;
  const normalized = headerTokens.map((h) => normalizeHeaderToken(h));
  const looksLikeExpected = normalized.includes("ITEM") && (normalized.includes("BUBBLE_ID") || normalized.includes("ID") || normalized.includes("UNIQUE_ID"));
  if (!looksLikeExpected) return null;
  const dataLines = all.slice(idx + 1).filter((l) => normalizeHeaderToken(l) !== "FIM");
  const rows = dataLines.map((l) => l.split(";").map((c) => String(c ?? "").trim()));
  return { moduleRaw, headerTokens, headerNormalized: normalized, rows };
}

function tryReconstructInsumosFromFlatLines(lines: string[]) {
  const only = (lines ?? []).map((l) => normalizeSpace(l)).filter(Boolean);
  if (only.length < 8) return null;
  const headerCells: string[] = [];
  for (let i = 0; i < Math.min(only.length, 20); i++) {
    const cell = only[i] ?? "";
    const k = normKey(cell);
    const isActions = k.includes("acao") || k.includes("ações") || k === "acoes" || k === "ações";
    const mapped = mapHeaderToKey(cell);
    if (mapped || isActions) {
      headerCells.push(cell);
      continue;
    }
    if (headerCells.length >= 4) break;
    return null;
  }
  if (headerCells.length < 4) return null;
  const mappedCols = headerCells.map((c) => mapHeaderToKey(c));
  const keys = new Set(mappedCols.filter(Boolean));
  if (!keys.has("item") || !keys.has("categoria")) return null;

  const data = only.slice(headerCells.length);
  if (data.length < headerCells.length) return null;

  const hasLetters = (s: string) => /[A-Za-zÀ-ÿ]/.test(String(s ?? ""));
  const isUnitLine = (line: string) => Boolean(detectUnitLoose(line));
  const isMoneyLine = (line: string) => {
    if (!/[\d]/.test(line)) return false;
    const parsed = parsePtNumberLooseToString(line);
    return Boolean(parsed);
  };
  const isTextLine = (line: string) => hasLetters(line) && !isUnitLine(line) && !isMoneyLine(line);

  const idxItem = mappedCols.indexOf("item");
  const idxMedida = mappedCols.indexOf("medida");
  const idxCusto = mappedCols.indexOf("custoMedio");
  const idxCategoria = mappedCols.indexOf("categoria");
  if (idxItem >= 0) {
    const probe = String(data[idxItem] ?? "");
    if (!isTextLine(probe)) return null;
  }
  if (idxMedida >= 0) {
    const probe = String(data[idxMedida] ?? "");
    if (probe && !isUnitLine(probe)) return null;
  }
  if (idxCusto >= 0) {
    const probe = String(data[idxCusto] ?? "");
    if (probe && !isMoneyLine(probe)) return null;
  }
  if (idxCategoria >= 0) {
    const probe = String(data[idxCategoria] ?? "");
    if (probe && !hasLetters(probe)) return null;
  }
  const rows: string[][] = [];
  for (let i = 0; i < data.length; i += headerCells.length) {
    const chunk = data.slice(i, i + headerCells.length);
    if (chunk.length < headerCells.length) break;
    const isRepeatedHeader = chunk.some((c) => Boolean(mapHeaderToKey(c)));
    if (isRepeatedHeader) continue;
    rows.push(chunk);
  }
  if (!rows.length) return null;
  return { headerCells, rows };
}


function parseInsumosVerticalBlocks(rawText: string) {
  const raw = String(rawText ?? "").replace(/\r\n/g, "\n");
  const lines = raw
    .split("\n")
    .map((l) => normalizeSpace(l))
    .filter((l) => l.trim().length)
    .filter((l) => normalizeHeaderToken(l) !== "FIM");

  const noise = new Set(
    [
      "ocultar",
      "item",
      "insumo",
      "medida",
      "unidade",
      "custo medio",
      "custo médio",
      "custo",
      "categoria",
      "especificacao",
      "especificação",
      "acoes",
      "ações",
    ].map((x) => stripDiacriticsLower(x)),
  );

  const filtered = lines
    .map((l) => l.trim())
    .filter((l) => l && l !== "-" && l !== "—")
    .filter((l) => !noise.has(stripDiacriticsLower(l)));

  if (filtered.length < 4) return null;

  const isUnitLine = (line: string) => Boolean(detectUnitLoose(line));
  const isMoneyLine = (line: string) => {
    if (!/[\d]/.test(line)) return false;
    const parsed = parsePtNumberLooseToString(line);
    return Boolean(parsed);
  };
  const isTextLine = (line: string) => /[A-Za-zÀ-ÿ]/.test(line);

  const skip = (idx: number) => {
    let i = idx;
    while (i < filtered.length) {
      const s = String(filtered[i] ?? "").trim();
      if (!s || s === "-" || s === "—") {
        i += 1;
        continue;
      }
      return i;
    }
    return filtered.length;
  };

  const peek = (idx: number) => (idx >= 0 && idx < filtered.length ? String(filtered[idx] ?? "").trim() : "");

  let categoryContext = "";
  const rows: any[] = [];
  let rowSeq = 0;

  for (let i = 0; i < filtered.length; i++) {
    const a = peek(i);
    if (!a) continue;

    const iItem = i;
    const iUnit = skip(iItem + 1);
    const iCost = skip(iUnit + 1);
    const iCat = skip(iCost + 1);

    const itemCandidate = a;
    const unitCandidate = peek(iUnit);
    const costCandidate = peek(iCost);
    const catCandidate = peek(iCat);

    const looksLikeRecord =
      isTextLine(itemCandidate) &&
      !isUnitLine(itemCandidate) &&
      !isMoneyLine(itemCandidate) &&
      isUnitLine(unitCandidate) &&
      isMoneyLine(costCandidate);

    const looksLikeHeading = isTextLine(itemCandidate) && !isUnitLine(itemCandidate) && !isMoneyLine(itemCandidate) && isTextLine(peek(skip(iItem + 1))) && isUnitLine(peek(skip(skip(iItem + 1) + 1))) && isMoneyLine(peek(skip(skip(skip(iItem + 1) + 1) + 1)));
    if (!looksLikeRecord && looksLikeHeading) {
      categoryContext = itemCandidate;
      continue;
    }
    if (!looksLikeRecord) continue;

    rowSeq += 1;
    const rowId = `L${rowSeq}`;
    const item = normalizeSpace(itemCandidate);
    const medida = normalizeSpace(detectUnitLoose(unitCandidate)) || "Und";
    const custoMedio = normalizeSpace(costCandidate);
    const categoria = isTextLine(catCandidate) && !isUnitLine(catCandidate) && !isMoneyLine(catCandidate) ? normalizeSpace(catCandidate) : normalizeSpace(categoryContext) || "Pendente de classificação";

    const missingKeys: string[] = [];
    if (!item) missingKeys.push("item");
    if (!medida) missingKeys.push("medida");
    if (!custoMedio) missingKeys.push("custoMedio");
    if (!categoria) missingKeys.push("categoria");

    rows.push({
      rowId,
      item,
      medida,
      custoMedio,
      categoria,
      especificacao: "",
      ocultar: false,
      warnings: [] as string[],
      invalid: missingKeys.length > 0,
      missingKeys,
    });

    if (isTextLine(catCandidate) && !isUnitLine(catCandidate) && !isMoneyLine(catCandidate)) categoryContext = categoria;
    i = Math.max(i, iCat);
  }

  const clean = rows.filter((r) => String(r?.item ?? "").trim().length);
  return clean.length ? clean : null;
}

function parsePtNumberLooseToString(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/^R\$\s*/i, "")
    .replace(/%/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return "";
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const num = Number(normalized);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(2).replace(/\.00$/, ".00");
}

function parsePtPercentLooseToString(value: string) {
  const raw = parsePtNumberLooseToString(value);
  if (!raw) return "";
  const num = Number(raw);
  if (!Number.isFinite(num)) return "";
  const isInt = Math.abs(num - Math.round(num)) < 1e-9;
  if (isInt) return String(Math.round(num));
  const s = String(num);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function normalizeBcgQuadrant(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const k = stripDiacriticsLower(raw);
  if (raw.includes("⭐") || k.includes("estrela")) return "ESTRELA";
  if (raw.includes("🐎") || k.includes("cavalo")) return "CAVALO";
  if (raw.includes("🧩") || k.includes("quebra") || k.includes("cabeca")) return "QUEBRA_CABECA";
  if (raw.includes("🍍") || k.includes("abacaxi")) return "ABACAXI";
  return "";
}

function isFichasUiNoiseLine(line: string) {
  const s = stripDiacriticsLower(line);
  if (!s) return true;
  const hits = [
    "novo",
    "nova ficha tecnica",
    "nova ficha técnica",
    "entenda os status da matriz bcg",
    "matriz bcg",
    "acoes",
    "ações",
    "editar",
    "excluir",
    "duplicar",
    "salvar",
    "cancelar",
    "voltar",
    "ver",
  ];
  if (hits.some((h) => s === h || s.startsWith(`${h} `) || s.includes(h))) {
    const hasNumber = /[\d]/.test(s);
    const hasCurrency = s.includes("r$");
    const hasPct = s.includes("%");
    if (!hasNumber && !hasCurrency && !hasPct) return true;
  }
  return false;
}

function parseFichasTecnicasBubbleTable(rawText: string) {
  const raw = String(rawText ?? "").replace(/\r\n/g, "\n");
  const lines = raw
    .split("\n")
    .map((l) => String(l ?? ""))
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => normalizeHeaderToken(l) !== "FIM");
  if (!lines.length) return null;

  const headerCandidates = lines
    .map((line, idx) => ({ line, idx }))
    .filter((x) => x.line.includes("\t") || x.line.includes("Receita") || x.line.toLowerCase().includes("cmv"));

  const normCell = (v: string) => normalizeHeaderToken(v);
  const required = ["RECEITA", "PRECO", "VENDA", "CUSTO", "CMV", "MATRIZ", "BCG"];

  let headerIdx = -1;
  let headerCells: string[] = [];
  let delim: "tab" | "spaces" = "tab";
  for (const cand of headerCandidates.slice(0, 80)) {
    const parts = cand.line.includes("\t")
      ? cand.line.split("\t").map((c) => String(c ?? "").trim()).filter(Boolean)
      : cand.line.split(/\s{2,}/g).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (parts.length < 4) continue;
    const joined = parts.map(normCell).join(" ");
    const score = required.filter((r) => joined.includes(r)).length;
    const hasReceita = joined.includes("RECEITA");
    const hasCmv = joined.includes("CMV");
    const hasBcg = joined.includes("BCG") || joined.includes("MATRIZ");
    if (score >= 5 && hasReceita && hasCmv && hasBcg) {
      headerIdx = cand.idx;
      headerCells = parts;
      delim = cand.line.includes("\t") ? "tab" : "spaces";
      break;
    }
  }
  if (headerIdx < 0 || !headerCells.length) return null;

  const headerNorm = headerCells.map((c) => normalizeHeaderToken(c));
  const idxReceita = headerNorm.findIndex((h) => h === "RECEITA" || h.includes("RECEITA"));
  const idxPreco = headerNorm.findIndex((h) => h.includes("PRECO") && h.includes("VENDA"));
  const idxCusto = headerNorm.findIndex((h) => h.includes("CUSTO") && (h.includes("UNITARIO") || h.includes("UNIT")));
  const idxCmvMeta = headerNorm.findIndex((h) => h.includes("CMV") && h.includes("META"));
  const idxCmvAtual = headerNorm.findIndex((h) => h.includes("CMV") && h.includes("ATUAL"));
  const idxBcg = headerNorm.findIndex((h) => h.includes("BCG") || (h.includes("MATRIZ") && h.includes("BCG")));

  const requiredIdx = [
    { key: "receita", idx: idxReceita },
    { key: "precoVenda", idx: idxPreco },
    { key: "custoUnitario", idx: idxCusto },
    { key: "cmvMeta", idx: idxCmvMeta },
    { key: "cmvAtual", idx: idxCmvAtual },
    { key: "bcg", idx: idxBcg },
  ];
  if (requiredIdx.some((x) => x.idx < 0)) {
    return {
      headerCells,
      headerNorm,
      rows: [] as any[],
      missingHeaderKeys: requiredIdx.filter((x) => x.idx < 0).map((x) => x.key),
    };
  }

  const parseLine = (line: string) => {
    const parts =
      delim === "tab"
        ? line.split("\t").map((c) => String(c ?? "").trim())
        : line.split(/\s{2,}/g).map((c) => String(c ?? "").trim());
    return parts.filter((c) => c.length);
  };

  const dataLines = lines.slice(headerIdx + 1);
  const rows: any[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i] ?? "";
    if (!line) continue;
    if (isFichasUiNoiseLine(line)) continue;
    const parts = parseLine(line);
    const joined = parts.map(normCell).join(" ");
    if (joined.includes("RECEITA") && joined.includes("CMV") && joined.includes("BCG")) continue;
    if (parts.length < 3) continue;

    const rowId = `L${headerIdx + 2 + i}`;
    const receita = String(parts[idxReceita] ?? "").trim();
    const precoVenda = parsePtNumberLooseToString(String(parts[idxPreco] ?? ""));
    const custoUnitario = parsePtNumberLooseToString(String(parts[idxCusto] ?? ""));
    const cmvMeta = parsePtPercentLooseToString(String(parts[idxCmvMeta] ?? ""));
    const cmvAtual = parsePtPercentLooseToString(String(parts[idxCmvAtual] ?? ""));
    const bcg = normalizeBcgQuadrant(String(parts[idxBcg] ?? ""));

    const missingKeys: string[] = [];
    if (!receita) missingKeys.push("receita");
    if (!precoVenda) missingKeys.push("precoVenda");
    if (!custoUnitario) missingKeys.push("custoUnitario");
    if (!cmvMeta) missingKeys.push("cmvMeta");
    if (!cmvAtual) missingKeys.push("cmvAtual");
    if (!bcg) missingKeys.push("bcg");

    rows.push({
      rowId,
      receita,
      precoVenda,
      custoUnitario,
      cmvMeta,
      cmvAtual,
      bcg,
      warnings: [] as string[],
      invalid: missingKeys.length > 0,
      missingKeys,
    });
  }

  return { headerCells, headerNorm, rows, missingHeaderKeys: [] as string[] };
}

function parseFichasTecnicasVerticalBlocks(rawText: string) {
  const raw = String(rawText ?? "").replace(/\r\n/g, "\n");
  const evidence = stripDiacriticsLower(raw);
  const hasBcgEvidence =
    evidence.includes("cmv") ||
    evidence.includes("bcg") ||
    raw.includes("⭐") ||
    raw.includes("🐎") ||
    raw.includes("🧩") ||
    raw.includes("🍍") ||
    evidence.includes("estrela") ||
    evidence.includes("cavalo") ||
    evidence.includes("quebra") ||
    evidence.includes("abacaxi");
  if (!hasBcgEvidence) return null;
  const lines = raw
    .split("\n")
    .map((l) => String(l ?? "").trim())
    .filter(Boolean)
    .filter((l) => normalizeHeaderToken(l) !== "FIM")
    .filter((l) => !isFichasUiNoiseLine(l));

  if (!lines.length) return null;

  const looksLikeLabelLine = (line: string) => {
    const k = normalizeHeaderToken(line);
    const labels = new Set([
      "RECEITA",
      "PRECO_DE_VENDA",
      "PRECO_VENDA",
      "PRECO",
      "CUSTO_UNITARIO",
      "CUSTO",
      "CMV_META",
      "CMV_ATUAL",
      "CMV",
      "MATRIZ_BCG",
      "BCG",
      "ACOES",
      "AÇÕES",
    ]);
    return labels.has(k);
  };

  const hasLetters = (s: string) => /[A-Za-zÀ-ÿ]/.test(String(s ?? ""));
  const isPercentLine = (line: string) => line.includes("%");
  const isCurrencyLine = (line: string) => /r\$\s*\d/i.test(line) || /^[\d.\s]+[,.]\d{1,2}$/.test(line);
  const isDeltaLine = (line: string) => {
    const s = stripDiacriticsLower(line);
    return s.includes("maior") || s.includes("menor") || s.includes("delta") || s.includes("diferenca") || s.includes("diferença");
  };

  type Draft = {
    rowId: string;
    receita: string;
    monies: string[];
    percs: string[];
    bcg: string;
  };

  const rows: any[] = [];
  let current: Draft | null = null;
  let seq = 0;

  const flush = () => {
    if (!current) return;
    const precoVenda = current.monies[0] ?? "";
    const custoUnitario = current.monies.length > 1 ? (current.monies[current.monies.length - 1] ?? "") : "";
    const cmvMeta = current.percs[0] ?? "";
    const cmvAtual = current.percs[1] ?? "";
    const bcg = current.bcg || "";

    const missingKeys: string[] = [];
    if (!current.receita) missingKeys.push("receita");
    if (!precoVenda) missingKeys.push("precoVenda");
    if (!custoUnitario) missingKeys.push("custoUnitario");
    if (!cmvMeta) missingKeys.push("cmvMeta");
    if (!cmvAtual) missingKeys.push("cmvAtual");
    if (!bcg) missingKeys.push("bcg");

    rows.push({
      rowId: current.rowId,
      receita: current.receita,
      precoVenda,
      custoUnitario,
      cmvMeta,
      cmvAtual,
      bcg,
      warnings: [] as string[],
      invalid: missingKeys.length > 0,
      missingKeys,
    });
    current = null;
  };

  for (const line of lines) {
    if (looksLikeLabelLine(line)) continue;
    if (isDeltaLine(line) && isPercentLine(line)) continue;

    const bcg = normalizeBcgQuadrant(line);
    if (bcg) {
      if (current) current.bcg = bcg;
      continue;
    }

    if (current && isPercentLine(line)) {
      const p = parsePtPercentLooseToString(line);
      if (p) current.percs.push(p);
      continue;
    }

    if (current && isCurrencyLine(line) && !isPercentLine(line)) {
      const m = parsePtNumberLooseToString(line);
      if (m) current.monies.push(m);
      continue;
    }

    const candidateRecipe = hasLetters(line) && !isPercentLine(line) && !isCurrencyLine(line) && !looksLikeLabelLine(line) && !normalizeBcgQuadrant(line);
    if (candidateRecipe) {
      if (current) flush();
      seq += 1;
      current = { rowId: `L${seq}`, receita: line, monies: [], percs: [], bcg: "" };
      continue;
    }

    if (current) {
      const m = !isPercentLine(line) ? parsePtNumberLooseToString(line) : "";
      if (m) current.monies.push(m);
      const p = isPercentLine(line) ? parsePtPercentLooseToString(line) : "";
      if (p) current.percs.push(p);
    }
  }

  flush();

  const clean = rows.filter((r) => String(r?.receita ?? "").trim().length);
  const valid = clean.filter((r) => !r?.invalid);
  if (!valid.length) return null;
  return { rows: clean, missingHeaderKeys: [] as string[] };
}

function scoreContainsAny(text: string, needles: string[]) {
  const t = normKey(text);
  let score = 0;
  for (const n of needles) if (t.includes(n)) score += 1;
  return score;
}

function stripDiacriticsLower(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeadingLine(s: string) {
  return stripDiacriticsLower(s)
    .replace(/[:\-–—|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isListaDeComprasHeaderLine(line: string) {
  const h = normalizeHeadingLine(line);
  if (!h) return false;
  return h === "lista de compras" || h.startsWith("lista de compras ") || h === "lista-de-compras" || h.startsWith("lista-de-compras ");
}

function parseSectionHeaderKey(line: string): ModuleKey | null {
  const h = normalizeHeadingLine(line);
  if (!h) return null;
  const isExact = (needle: string) => h === needle || h.startsWith(`${needle} `);
  if (isExact("insumos")) return "insumos";
  if (isExact("fornecedores")) return "fornecedores";
  if (isExact("entradas")) return "entradas";
  if (isExact("inventario")) return "inventario";
  if (isExact("desperdicios")) return "desperdicios";
  if (isExact("fichas tecnicas") || isExact("fichas-tecnicas") || isExact("ficha tecnica") || isExact("fichas tecnica")) return "fichas-tecnicas";
  if (isExact("pre preparo") || isExact("pre-preparo") || isExact("prepreparo") || isExact("pre preparo")) return "pre-preparo";
  return null;
}

function splitByModuleSections(rawText: string) {
  const lines = String(rawText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => String(l ?? ""));

  const sections: Record<ModuleKey, string[]> = {
    insumos: [],
    fornecedores: [],
    entradas: [],
    inventario: [],
    desperdicios: [],
    "fichas-tecnicas": [],
    "pre-preparo": [],
  };

  const order: string[] = [];
  let current: ModuleKey | null = null;

  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (isListaDeComprasHeaderLine(trimmed)) {
      current = null;
      if (!order.includes("lista-de-compras")) order.push("lista-de-compras");
      continue;
    }
    const key = parseSectionHeaderKey(trimmed);
    if (key) {
      current = key;
      if (!order.includes(key)) order.push(key);
      continue;
    }
    if (!current) continue;
    sections[current].push(line);
  }

  const detected = order.filter((k) => {
    if (k === "lista-de-compras") return true;
    const mk = k as ModuleKey;
    return Boolean(sections[mk]?.some((l) => String(l ?? "").trim().length));
  });
  return { detected, sections };
}

function detectModuleFromText(args: { raw: string; headerRow: string[] | null }) {
  const header = args.headerRow ? args.headerRow.join(" ") : "";
  const corpus = `${args.raw}\n${header}`;

  const scores: Record<ModuleKey, number> = {
    insumos: 0,
    fornecedores: 0,
    entradas: 0,
    inventario: 0,
    desperdicios: 0,
    "fichas-tecnicas": 0,
    "pre-preparo": 0,
  };

  scores.fornecedores += scoreContainsAny(corpus, ["fornecedor", "cnpj", "telefone", "whatsapp", "endereco", "prazo", "frete"]);
  scores.entradas += scoreContainsAny(corpus, ["nota fiscal", "nf", "nfe", "entrada", "data", "numero", "fornecedor", "valor", "quantidade", "preco"]);
  scores.inventario += scoreContainsAny(corpus, ["invent", "contagem", "estoque", "estoque final", "estoque inicial", "quantidade contada", "diferenca", "diferença"]);
  scores.desperdicios += scoreContainsAny(corpus, ["desperd", "motivo", "perda", "quebra", "venc", "descartar"]);
  scores["fichas-tecnicas"] += scoreContainsAny(corpus, ["ficha", "receita", "ingrediente", "modo preparo", "modo de preparo", "rendimento", "preco venda", "preço venda", "cmv"]);
  scores["pre-preparo"] += scoreContainsAny(corpus, ["pre-preparo", "pré-preparo", "etiqueta", "validade", "data producao", "data produção", "data validade"]);
  scores.insumos += scoreContainsAny(corpus, ["insumo", "item", "categoria", "classe", "unidade", "medida", "custo", "ocultar"]);

  const ranked = (Object.entries(scores) as Array<[ModuleKey, number]>)
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? { key: "insumos" as ModuleKey, score: 0 };

  const detected = best.score > 0 ? best.key : ("insumos" as ModuleKey);
  return { detected, candidates: ranked.slice(0, 4) };
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const module = String(body?.module ?? "").trim().toLowerCase();
    const companyId = String(body?.companyId ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const text = String(body?.text ?? "");

    if (!email || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const raw = String(text ?? "").replace(/\r\n/g, "\n");
    const lines = raw
      .split("\n")
      .map((l) => String(l ?? ""))
      .filter((l) => l.trim().length)
      .filter((l) => normalizeHeaderToken(l) !== "FIM");
    if (!lines.length) return json({ ok: false, error: "empty_text" }, { status: 400 });

    const simple = parseSimpleSemicolonFormat(raw);
    if (simple) {
      const modTok = normalizeHeaderToken(simple.moduleRaw);
      const requested = normalizeHeaderToken(module);
      const forcedModule = requested && requested !== "AUTO" ? requested : modTok;
      const headerCols = simple.headerTokens;
      const headerKeys = simple.headerNormalized;

      const mapKey = (k: string): ColKey | "" => {
        if (k === "ITEM" || k === "NOME") return "item";
        if (k === "BUBBLE_ID" || k === "UNIQUE_ID" || k === "ID") return "bubbleId";
        if (k === "UNIDADE" || k === "MEDIDA") return "medida";
        if (k === "CUSTO_MEDIO" || k === "CUSTO" || k === "PRECO" || k === "VALOR") return "custoMedio";
        if (k === "CATEGORIA" || k === "CLASSE" || k === "GRUPO") return "categoria";
        if (k === "ESPECIFICACAO" || k === "DESCRICAO" || k === "OBS") return "especificacao";
        if (k === "OCULTAR") return "ocultar";
        return "";
      };

      const mappedCols = headerKeys.map((k) => mapKey(k));
      const recognizedColumns = Array.from(new Set(mappedCols.filter((x): x is ColKey => Boolean(x))));
      const requiredKeys: ColKey[] = ["item", "bubbleId", "medida", "custoMedio"];
      const missingColumns = requiredKeys.filter((rk) => !recognizedColumns.includes(rk));

      const rows: any[] = [];
      for (let i = 0; i < simple.rows.length; i++) {
        const cells = simple.rows[i] ?? [];
        const rowId = `L${i + 1}`;
        const draft: any = {
          rowId,
          item: "",
          medida: "Und",
          custoMedio: "",
          categoria: "Pendente de classificação",
          especificacao: "",
          ocultar: false,
          warnings: [] as string[],
          invalid: false,
          missingKeys: [] as string[],
          raw: {} as any,
          header: headerCols,
          module: forcedModule || modTok || "",
        };

        for (let c = 0; c < headerCols.length; c++) {
          const k = mappedCols[c] ?? "";
          const v = String(cells[c] ?? "").trim();
          if (!k) continue;
          (draft.raw as any)[k] = v;
          if (k === "bubbleId") {
            if (v) draft.bubbleId = normalizeSpace(v);
            continue;
          }
          if (k === "ocultar") {
            draft.ocultar = parseBooleanLoose(v);
            continue;
          }
          if (k === "medida") {
            draft.medida = normalizeSpace(v) || "Und";
            continue;
          }
          if (k === "item") {
            draft.item = normalizeSpace(v);
            continue;
          }
          if (k === "categoria") {
            draft.categoria = normalizeSpace(v) || "Pendente de classificação";
            continue;
          }
          if (k === "custoMedio") {
            draft.custoMedio = normalizeSpace(v);
            continue;
          }
          if (k === "especificacao") {
            draft.especificacao = normalizeSpace(v);
            continue;
          }
        }

        const missingBecauseShort = cells.length < headerCols.length ? mappedCols.slice(cells.length).filter(Boolean) : [];
        const missingRequiredValues = requiredKeys.filter((rk) => {
          const v = String((draft as any)[rk] ?? (draft.raw as any)?.[rk] ?? "").trim();
          return !v;
        });
        const missingKeys = Array.from(new Set([...missingColumns, ...missingBecauseShort, ...missingRequiredValues].filter(Boolean)));
        draft.missingKeys = missingKeys;
        if (missingKeys.length) draft.invalid = true;

        if (!draft.item) draft.warnings.push("Item vazio");
        if (!draft.categoria || draft.categoria === "Pendente de classificação") draft.warnings.push("Categoria pendente");
        rows.push(draft);
      }

      const cleanRows = rows.filter((r) => String(r.item ?? "").trim().length);
      const result = {
        ok: true,
        module: "insumos" as const,
        source: "pasted_text",
        sectionsDetected: [] as string[],
        recognizedColumns,
        missingColumns,
        totalRows: cleanRows.length,
        pendingClassificationCount: cleanRows.filter((r) => normalizeSpace(String(r.categoria ?? "")) === "Pendente de classificação").length,
        duplicates: [] as Array<{ key: string; rowIds: string[] }>,
        categoryCounts: [] as Array<{ categoria: string; count: number }>,
        rows: cleanRows,
        errors: [],
      };
      return json({ ok: true, result }, { status: 200 });
    }

    const requestedModule = (module && module !== "auto" ? module : "") as string;
    if (!requestedModule || requestedModule === "fichas-tecnicas") {
      const parsedFichas = parseFichasTecnicasBubbleTable(raw) ?? parseFichasTecnicasVerticalBlocks(raw);
      if (parsedFichas) {
        const missingColumns = parsedFichas.missingHeaderKeys ?? [];
        const rows = parsedFichas.rows ?? [];
        const result = {
          ok: true,
          module: "fichas-tecnicas" as const,
          source: "pasted_text",
          sectionsDetected: [] as string[],
          recognizedColumns: ["receita", "precoVenda", "custoUnitario", "cmvMeta", "cmvAtual", "bcg"],
          missingColumns,
          totalRows: rows.filter((r: any) => String(r?.receita ?? "").trim().length).length,
          pendingClassificationCount: 0,
          duplicates: [] as Array<{ key: string; rowIds: string[] }>,
          categoryCounts: [] as Array<{ categoria: string; count: number }>,
          rows,
          errors: missingColumns.length ? [`Cabeçalho incompleto: faltando ${missingColumns.join(", ")}`] : [],
        };
        return json({ ok: true, result }, { status: 200 });
      }
    }

    const split = splitByModuleSections(raw);
    const sectionsDetected = split.detected;
    const selectedRaw =
      module && module !== "auto"
        ? split.sections[module as ModuleKey]?.join("\n") ?? ""
        : split.sections.insumos.join("\n") || raw;

    const delim = pickDelimiter(selectedRaw);
    const tableLines = selectedRaw
      .split("\n")
      .map((l) => String(l ?? ""))
      .filter((l) => l.trim().length)
      .filter((l) => normalizeHeaderToken(l) !== "FIM")
      .filter((l) => {
        const t = String(l ?? "").trim();
        if (!t) return false;
        const onlyPipes = t.replace(/[|:\-\s]/g, "");
        if (!onlyPipes) return false;
        return true;
      });
    let table = tableLines.map((l) => splitCells(l, delim));
    const allSingleCell = table.length >= 8 && table.every((r) => (r ?? []).length <= 1);
    if (allSingleCell) {
      const flat = tryReconstructInsumosFromFlatLines(tableLines);
      if (flat) table = [flat.headerCells, ...flat.rows];
      else {
        const vertical = parseInsumosVerticalBlocks(selectedRaw);
        if (vertical) {
          const cleanRows = vertical;
          const recognizedColumns = ["item", "medida", "custoMedio", "categoria"];
          const missingColumns: string[] = [];
          const pendingClassificationCount = cleanRows.filter((r: any) => normalizeSpace(String(r?.categoria ?? "")) === "Pendente de classificação").length;
          const byKey = new Map<string, string[]>();
          for (const r of cleanRows) {
            const k = normKey(String(r.item ?? ""));
            if (!k) continue;
            const prev = byKey.get(k) ?? [];
            prev.push(String(r.rowId ?? ""));
            byKey.set(k, prev);
          }
          const duplicates = Array.from(byKey.entries())
            .filter(([, ids]) => ids.length >= 2)
            .map(([k, ids]) => ({ key: k, rowIds: ids }));
          const catCount = new Map<string, number>();
          for (const r of cleanRows) {
            const c = normalizeSpace(String(r.categoria ?? "")) || "Pendente de classificação";
            catCount.set(c, (catCount.get(c) ?? 0) + 1);
          }
          const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
          const categoryCounts = Array.from(catCount.entries())
            .map(([categoria, count]) => ({ categoria, count }))
            .sort((a, b) => collator.compare(a.categoria, b.categoria));
          const result = {
            ok: true,
            module: "insumos" as const,
            source: "pasted_text",
            sectionsDetected,
            recognizedColumns,
            missingColumns,
            totalRows: cleanRows.length,
            pendingClassificationCount,
            duplicates,
            categoryCounts,
            rows: cleanRows,
            errors: [] as string[],
          };
          return json({ ok: true, result }, { status: 200 });
        }
      }
    }

    let headerIndex = -1;
    for (let i = 0; i < Math.min(table.length, 5); i++) {
      const row = table[i] ?? [];
      const hits = row.filter((c) => looksLikeHeaderCell(c)).length;
      if (hits >= 2) {
        headerIndex = i;
        break;
      }
    }

    const headerRow = headerIndex >= 0 ? (table[headerIndex] ?? []) : null;
    const detectedModule =
      module && module !== "auto"
        ? (module as ModuleKey)
        : split.sections.insumos.join("\n").trim()
          ? ("insumos" as const)
          : detectModuleFromText({ raw, headerRow }).detected;

    if (detectedModule === "fichas-tecnicas") {
      const parsed = parseFichasTecnicasBubbleTable(selectedRaw || raw) ?? parseFichasTecnicasVerticalBlocks(selectedRaw || raw);
      const rows = parsed?.rows ?? [];
      const missingColumns = parsed?.missingHeaderKeys ?? ["receita", "precoVenda", "custoUnitario", "cmvMeta", "cmvAtual", "bcg"];
      const result = {
        ok: true,
        module: "fichas-tecnicas" as const,
        source: "pasted_text",
        sectionsDetected,
        recognizedColumns: ["receita", "precoVenda", "custoUnitario", "cmvMeta", "cmvAtual", "bcg"],
        missingColumns: missingColumns.length ? missingColumns : [],
        totalRows: rows.filter((r: any) => String(r?.receita ?? "").trim().length).length,
        pendingClassificationCount: 0,
        duplicates: [] as Array<{ key: string; rowIds: string[] }>,
        categoryCounts: [] as Array<{ categoria: string; count: number }>,
        rows,
        errors: missingColumns.length ? [`Cabeçalho incompleto: faltando ${missingColumns.join(", ")}`] : [],
      };
      return json({ ok: true, result }, { status: 200 });
    }

    if (detectedModule !== "insumos") {
      const result = {
        ok: true,
        module: detectedModule,
        source: "pasted_text",
        sectionsDetected,
        recognizedColumns: [],
        missingColumns: [],
        totalRows: 0,
        pendingClassificationCount: 0,
        duplicates: [] as Array<{ key: string; rowIds: string[] }>,
        categoryCounts: [] as Array<{ categoria: string; count: number }>,
        rows: [] as any[],
        errors: [`Módulo detectado: ${detectedModule}. Importação ainda não implementada para este módulo.`],
      };
      return json({ ok: true, result }, { status: 200 });
    }

    const columnMap = new Map<number, ColKey>();
    const recognized = new Set<string>();
    const errors: string[] = [];
    const missingColumns: string[] = [];

    if (headerRow) {
      headerRow.forEach((cell, idx) => {
        const key = mapHeaderToKey(cell);
        if (!key) return;
        if (Array.from(columnMap.values()).includes(key)) return;
        columnMap.set(idx, key);
        recognized.add(key);
      });
    } else {
      columnMap.set(0, "item");
      recognized.add("item");
      if ((table[0] ?? []).length >= 2) {
        const sampleSecond = detectUnitLoose(String((table[0] ?? [])[1] ?? "")) || detectUnitLoose(String((table[1] ?? [])[1] ?? "")) || "";
        if (sampleSecond) {
          columnMap.set(1, "medida");
          recognized.add("medida");
        } else {
          columnMap.set(1, "categoria");
          recognized.add("categoria");
        }
      }
      if ((table[0] ?? []).length >= 3) {
        columnMap.set(2, "custoMedio");
        recognized.add("custoMedio");
      }
    }

    const required: ColKey[] = ["item", "categoria"];
    for (const r of required) {
      if (!recognized.has(r)) missingColumns.push(r);
    }

    const startRow = headerIndex >= 0 ? headerIndex + 1 : 0;
    const rows: any[] = [];
    for (let i = startRow; i < table.length; i++) {
      const cells = table[i] ?? [];
      const rowId = `L${i + 1}`;
      const draft: any = {
        rowId,
        item: "",
        medida: "Und",
        custoMedio: "",
        categoria: "Pendente de classificação",
        especificacao: "",
        ocultar: false,
        warnings: [] as string[],
        invalid: false,
        missingKeys: [] as string[],
      };

      for (let c = 0; c < cells.length; c++) {
        const key = columnMap.get(c);
        if (!key) continue;
        const v = String(cells[c] ?? "");
        if (key === "bubbleId") {
          const b = normalizeSpace(v);
          if (b) draft.bubbleId = b;
          continue;
        }
        if (key === "ocultar") {
          draft.ocultar = parseBooleanLoose(v);
          continue;
        }
        if (key === "medida") {
          draft.medida = normalizeSpace(v) || "Und";
          continue;
        }
        if (key === "item") {
          draft.item = normalizeSpace(v);
          continue;
        }
        if (key === "categoria") {
          draft.categoria = normalizeSpace(v) || "Pendente de classificação";
          continue;
        }
        if (key === "custoMedio") {
          draft.custoMedio = normalizeSpace(v);
          continue;
        }
        if (key === "especificacao") {
          draft.especificacao = normalizeSpace(v);
          continue;
        }
      }

      if (!draft.item) {
        draft.warnings.push("Item vazio");
      }
      if (!draft.categoria || draft.categoria === "Pendente de classificação") {
        draft.warnings.push("Categoria pendente");
      }
      if (draft.custoMedio) {
        const hasNumber = /[\d]/.test(String(draft.custoMedio));
        if (!hasNumber) draft.warnings.push("Custo médio inválido");
      }
      const missingRequiredValues = required.filter((rk) => {
        const v = String((draft as any)[rk] ?? "").trim();
        return !v;
      });
      const missingKeys = Array.from(new Set([...missingColumns, ...missingRequiredValues].filter(Boolean)));
      draft.missingKeys = missingKeys;
      if (missingKeys.length) draft.invalid = true;
      rows.push(draft);
    }

    const cleanRows = rows.filter((r) => String(r.item ?? "").trim().length);

    const byKey = new Map<string, string[]>();
    for (const r of cleanRows) {
      const k = normKey(String(r.item ?? ""));
      if (!k) continue;
      const prev = byKey.get(k) ?? [];
      prev.push(String(r.rowId ?? ""));
      byKey.set(k, prev);
    }
    const duplicates = Array.from(byKey.entries())
      .filter(([, ids]) => ids.length >= 2)
      .map(([k, ids]) => ({ key: k, rowIds: ids }));

    const catCount = new Map<string, number>();
    for (const r of cleanRows) {
      const c = normalizeSpace(String(r.categoria ?? "")) || "Pendente de classificação";
      catCount.set(c, (catCount.get(c) ?? 0) + 1);
    }
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    const categoryCounts = Array.from(catCount.entries())
      .map(([categoria, count]) => ({ categoria, count }))
      .sort((a, b) => collator.compare(a.categoria, b.categoria));

    const pendingClassificationCount = cleanRows.filter((r) => normalizeSpace(String(r.categoria ?? "")) === "Pendente de classificação").length;

    const result = {
      ok: true,
      module: "insumos" as const,
      source: "pasted_text",
      sectionsDetected,
      recognizedColumns: Array.from(recognized.values()),
      missingColumns,
      totalRows: cleanRows.length,
      pendingClassificationCount,
      duplicates,
      categoryCounts,
      rows: cleanRows,
      errors,
    };

    return json({ ok: true, result }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
