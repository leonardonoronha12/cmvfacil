import fs from "fs";

function readDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function classifyLikeApp(objectType) {
  const t = String(objectType ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("empresa")) return "empresa";
  if (t.includes("cliente") || t.includes("customer")) return "cliente";
  if (t.includes("veiculo") || t.includes("vehicle")) return "veiculo";
  if (t.includes("ordem") || t.includes("servico") || t.includes("service") || t === "os" || /(^|[_\\-\\s])os($|[_\\-\\s])/.test(t)) return "ordem_servico";
  if (t.includes("finance") || t.includes("lanc")) return "financeiro";
  if (t.includes("anex") || t.includes("attach")) return "anexo";
  return null;
}

async function fetchMetaTypes({ baseUrl, token }) {
  const metaUrl = String(baseUrl).replace(/\/obj\/?$/i, "/meta");
  const res = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const err = typeof json === "object" && json ? json : { raw: text.slice(0, 500) };
    throw new Error(`bubble_meta_http_${res.status}:${JSON.stringify(err)}`);
  }
  const root = json?.response ?? json;
  const types = root?.types ?? root?.data_types ?? root?.dataTypes ?? root?.datatypes ?? null;
  if (!types) {
    return { metaUrl, types: null, rawKeys: Object.keys(root ?? {}), raw: root };
  }
  const names = Array.isArray(types)
    ? types
        .map((t) => (typeof t === "string" ? t : t?.name ?? t?.type ?? ""))
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : Object.keys(types);
  names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { metaUrl, types: names, rawKeys: Object.keys(root ?? {}) };
}

async function main() {
  const env = {
    ...readDotenv(".env.local"),
    ...readDotenv(".bubble.env.local"),
  };

  const baseUrl = String(env.BUBBLE_BASE_URL ?? "").trim();
  const token = String(env.BUBBLE_API_TOKEN ?? "").trim();
  if (!baseUrl || !token) {
    console.error(JSON.stringify({ ok: false, error: "missing_BUBBLE_BASE_URL_or_BUBBLE_API_TOKEN" }, null, 2));
    process.exit(1);
  }

  const meta = await fetchMetaTypes({ baseUrl, token });
  if (!meta.types) {
    console.log(JSON.stringify({ ok: false, error: "bubble_meta_missing_types", meta }, null, 2));
    process.exit(2);
  }

  const bubbleTypes = meta.types;
  const bubbleSet = new Set(bubbleTypes.map((x) => String(x).trim().toLowerCase()));

  const importerDefaultObjectTypes = [
    "empresa",
    "empresas",
    "cliente",
    "clientes",
    "veiculo",
    "veiculos",
    "ordem_servico",
    "ordens_servico",
    "financeiro",
    "lancamentos",
    "anexos",
    "attachments",
  ];

  const rows = [];
  const bubbleNotMapped = [];

  for (const bubbleType of bubbleTypes) {
    const importKey = classifyLikeApp(bubbleType);
    const status = importKey ? "OK (mapeado)" : "Existe no Bubble, mas não está mapeado";
    rows.push({ bubbleType, importerName: importKey ?? "", status });
    if (!importKey) bubbleNotMapped.push(bubbleType);
  }

  const importerNotInBubble = [];
  for (const importerName of importerDefaultObjectTypes) {
    if (!bubbleSet.has(String(importerName).toLowerCase())) importerNotInBubble.push(importerName);
  }
  for (const importerName of importerNotInBubble) {
    rows.push({ bubbleType: "", importerName, status: "Não existe no Bubble" });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        metaUrl: meta.metaUrl,
        bubbleTypesCount: bubbleTypes.length,
        importerDefaultObjectTypes,
        bubbleNotMapped,
        importerNotInBubble,
        rows,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
});

