import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DEFAULT_IN = path.join(ROOT, "tools", "bubble-obj", "in", "bubble_app_dump.bubble.txt");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");

const PRIORITY_TYPES = [
  "itens",
  "categorias",
  "notas_fiscais",
  "itens_notas",
  "fornecedores",
  "inventarios",
  "itens_inventarios",
  "desperdicio",
  "custo_medio_item",
  "empresas",
  "user",
];

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { input: "", out: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.input = String(argv[i + 1] ?? "");
    if (a === "--out") args.out = String(argv[i + 1] ?? "");
  }
  args.input = String(args.input || DEFAULT_IN).trim();
  args.out = String(args.out || path.join(OUT_DIR, "bubble_field_matrix.json")).trim();
  return args;
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const trimmed = raw.trim();
  return JSON.parse(trimmed);
}

function extractElementIndex(bubble) {
  const out = new Map();
  const add = (scope, id, el) => {
    if (!id || !el || typeof el !== "object") return;
    const name = String(el.name ?? el.default_name ?? "").trim();
    const type = String(el.type ?? "").trim();
    if (!name && !type) return;
    out.set(String(id), { id: String(id), scope, name, type });
  };
  for (const p of Object.values(bubble.pages ?? {})) {
    const pageName = String(p?.name ?? "").trim() || "page";
    for (const [id, el] of Object.entries(p?.elements ?? {})) add(`page:${pageName}`, id, el);
  }
  for (const d of Object.values(bubble.element_definitions ?? {})) {
    const defName = String(d?.name ?? "").trim() || "definition";
    for (const [id, el] of Object.entries(d?.elements ?? {})) add(`def:${defName}`, id, el);
  }
  return out;
}

function buildSchema(bubble) {
  const schema = {};
  for (const [typeName, typeDef] of Object.entries(bubble.user_types ?? {})) {
    const fields = typeDef?.fields && typeof typeDef.fields === "object" ? typeDef.fields : {};
    const fieldMap = {};
    for (const [fieldKey, fieldDef] of Object.entries(fields)) {
      const v = String(fieldDef?.value ?? "").trim();
      const display = String(fieldDef?.display ?? "").trim();
      const isList = v.startsWith("list.");
      const base = isList ? v.slice("list.".length) : v;
      const refType = base.startsWith("custom.") ? base.slice("custom.".length) : null;
      const optionSet = base.startsWith("option.") ? base.slice("option.".length) : null;
      const primitive = refType || optionSet ? null : base || null;
      fieldMap[fieldKey] = { fieldKey, display, value: v, isList, refType, optionSet, primitive };
    }
    const display = String(typeDef?.display ?? "").trim();
    schema[typeName] = { typeName, display, fields: fieldMap };
  }
  return schema;
}

function normalizeTypeName(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "user") return "user";
  if (lower.startsWith("custom.")) return lower.slice("custom.".length);
  return lower;
}

function scanAnyObjectForSearchesAndChanges(root) {
  const searches = [];
  const changes = [];
  const stack = [{ obj: root, path: "root" }];
  while (stack.length) {
    const { obj, path } = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) {
      const nextPath = `${path}.${k}`;
      if (!v || typeof v !== "object") continue;
      const type = String(v.type ?? "").trim();
      if (type === "Search") {
        const typeToFind = String(v?.properties?.type_to_find ?? "").trim();
        const constraints = v?.properties?.constraints && typeof v.properties.constraints === "object" ? v.properties.constraints : {};
        const constraintKeys = Object.values(constraints)
          .map((c) => String(c?.key ?? "").trim())
          .filter(Boolean);
        searches.push({ path: nextPath, typeToFind, constraintKeys });
      }
      if (type === "ChangeThing" || type === "ChangeListOfThings" || type === "MakeChangeCurrentUser") {
        const changesObj = v?.properties?.changes && typeof v.properties.changes === "object" ? v.properties.changes : {};
        const changeKeys = Object.values(changesObj)
          .map((c) => String(c?.key ?? "").trim())
          .filter(Boolean);
        changes.push({ path: nextPath, actionType: type, changeKeys, action: v });
      }
      if (type === "NewThing") {
        const thingType = String(v?.properties?.thing_type ?? "").trim();
        const changesObj = v?.properties?.changes && typeof v.properties.changes === "object" ? v.properties.changes : {};
        const initialObj = v?.properties?.initial_values && typeof v.properties.initial_values === "object" ? v.properties.initial_values : {};
        const changeKeys = [
          ...Object.values(changesObj).map((c) => String(c?.key ?? "").trim()),
          ...Object.values(initialObj).map((c) => String(c?.key ?? "").trim()),
        ].filter(Boolean);
        changes.push({ path: nextPath, actionType: type, thingType, changeKeys, action: v });
      }
      stack.push({ obj: v, path: nextPath });
    }
  }
  return { searches, changes };
}

function collectWorkflows(bubble, elementIndex) {
  const out = [];
  const addFrom = (scope, workflows) => {
    for (const [wid, w] of Object.entries(workflows ?? {})) {
      const elementId = String(w?.properties?.element_id ?? "").trim();
      const el = elementId ? elementIndex.get(elementId) ?? null : null;
      const elementName = String(el?.name ?? "").trim();
      const scanned = scanAnyObjectForSearchesAndChanges(w?.actions ?? {});
      out.push({
        scope,
        workflowId: wid,
        eventType: String(w?.type ?? "").trim(),
        elementId,
        elementName,
        searches: scanned.searches,
        changes: scanned.changes,
      });
    }
  };
  for (const p of Object.values(bubble.pages ?? {})) {
    const pageName = String(p?.name ?? "").trim() || "page";
    addFrom(`page:${pageName}`, p?.workflows);
  }
  for (const d of Object.values(bubble.element_definitions ?? {})) {
    const defName = String(d?.name ?? "").trim() || "definition";
    addFrom(`def:${defName}`, d?.workflows);
  }
  for (const [aid, a] of Object.entries(bubble.api ?? {})) addFrom(`api:${aid}`, { [aid]: a });
  return out;
}

function collectElementSearches(bubble) {
  const out = [];
  const scanElements = (scope, elements) => {
    for (const [elementId, el] of Object.entries(elements ?? {})) {
      const elementName = String(el?.name ?? el?.default_name ?? "").trim();
      const scanned = scanAnyObjectForSearchesAndChanges(el);
      for (const s of scanned.searches) out.push({ scope, elementId, elementName, ...s });
    }
  };
  for (const p of Object.values(bubble.pages ?? {})) {
    const pageName = String(p?.name ?? "").trim() || "page";
    scanElements(`page:${pageName}`, p?.elements);
  }
  for (const d of Object.values(bubble.element_definitions ?? {})) {
    const defName = String(d?.name ?? "").trim() || "definition";
    scanElements(`def:${defName}`, d?.elements);
  }
  return out;
}

function inferSinglePriorityTypeFromJson(obj, priorityTypes) {
  try {
    const s = JSON.stringify(obj ?? {});
    const hits = [];
    for (const t of priorityTypes) {
      const needle = `custom.${t}`;
      if (s.includes(needle)) hits.push(t);
    }
    return hits.length === 1 ? hits[0] : "";
  } catch {
    return "";
  }
}

function buildFieldUsageIndex(workflows) {
  const byTypeField = new Map();
  const add = (typeName, fieldKey, usage) => {
    const t = normalizeTypeName(typeName);
    if (!t || !fieldKey) return;
    const k = `${t}::${fieldKey}`;
    const cur = byTypeField.get(k) ?? [];
    cur.push(usage);
    byTypeField.set(k, cur);
  };
  for (const w of workflows) {
    const scope = w.scope || null;
    for (const s of w.searches ?? []) {
      const typeToFind = normalizeTypeName(s.typeToFind);
      for (const fieldKey of s.constraintKeys ?? []) {
        add(typeToFind, fieldKey, {
          kind: "workflow_search_constraint",
          scope,
          elementName: w.elementName || "",
          workflowId: w.workflowId,
          path: s.path,
        });
      }
    }
    for (const c of w.changes ?? []) {
      const inferred =
        c.actionType === "MakeChangeCurrentUser"
          ? "user"
          : c.thingType
            ? normalizeTypeName(c.thingType)
            : inferSinglePriorityTypeFromJson(c.action, PRIORITY_TYPES);
      for (const fieldKey of c.changeKeys ?? []) {
        add(inferred || "unknown", fieldKey, {
          kind: "workflow_change",
          actionType: c.actionType,
          scope,
          elementName: w.elementName || "",
          workflowId: w.workflowId,
          path: c.path,
        });
      }
    }
  }
  return byTypeField;
}

function supabaseTargetFor(typeName, fieldKey) {
  const t = String(typeName ?? "").trim().toLowerCase();
  const f = String(fieldKey ?? "").trim();

  if (t === "categorias") {
    if (f === "nome_text") return { table: "insumos_state", field: "categories[]" };
    return { table: "", field: "" };
  }

  if (t === "itens") {
    if (f === "nome_text") return { table: "insumos_state", field: "rows[].item" };
    if (f === "unidade_medida_option_unidadesdemedida") return { table: "insumos_state", field: "rows[].medida" };
    if (f === "categoria_custom_categorias") return { table: "insumos_state", field: "rows[].categoria" };
    if (f === "descricao_text") return { table: "insumos_state", field: "rows[].especificacao" };
    if (f === "ocultar_cmv_boolean") return { table: "insumos_state", field: "rows[].ocultar" };
    if (f === "custo_medio_number") return { table: "insumos_state", field: "rows[].custoMedio" };
    return { table: "", field: "" };
  }

  if (t === "custo_medio_item") {
    if (f === "custo_medio_number") return { table: "insumos_state", field: "rows[].custoMedio (latest by item)" };
    if (f === "item_custom_itens") return { table: "insumos_state", field: "rows[].id (link by bubble item id)" };
    return { table: "", field: "" };
  }

  if (t === "fornecedores") {
    if (f === "nome_text") return { table: "fornecedores_state", field: "info[FORNECEDOR].fornecedor" };
    if (f === "vendedor_text") return { table: "fornecedores_state", field: "info[FORNECEDOR].vendedor" };
    if (f === "whatsapp_text") return { table: "fornecedores_state", field: "info[FORNECEDOR].whatsapp" };
    if (f === "endereco_text") return { table: "fornecedores_state", field: "info[FORNECEDOR].endereco" };
    return { table: "", field: "" };
  }

  if (t === "itens_fornecedores") {
    if (f === "fornecedor_id_custom_fornecedores") return { table: "fornecedores_state", field: "produtos[FORNECEDOR][]" };
    if (f === "item_id_custom_itens") return { table: "fornecedores_state", field: "produtos[FORNECEDOR][] (resolve nome)" };
    return { table: "", field: "" };
  }

  if (t === "inventarios") {
    if (f === "data_contagem_date") return { table: "inventario", field: "data" };
    if (f === "nome_text") return { table: "inventario", field: "categorias[].nome (label)" };
    return { table: "", field: "" };
  }

  if (t === "itens_inventarios") {
    if (f === "inventario_id_custom_inventarios") return { table: "inventario", field: "categorias[].itens[] (group)" };
    if (f === "item_id_custom_itens") return { table: "inventario", field: "categorias[].itens[].id (insumoId)" };
    if (f === "quantidade_contada_number") return { table: "inventario", field: "categorias[].itens[].estoqueFinal" };
    return { table: "", field: "" };
  }

  if (t === "notas_fiscais") {
    if (f === "codigo_text") return { table: "entradas", field: "numero" };
    if (f === "data_lancamento_date") return { table: "entradas", field: "data_lancamento" };
    if (f === "data_criacao_date") return { table: "entradas", field: "data_criacao" };
    if (f === "valor_nota_number") return { table: "entradas", field: "valor_nota" };
    if (f === "fornecedor_id_custom_fornecedores") return { table: "entradas", field: "fornecedor (resolve nome)" };
    if (f === "lista_itens_list_custom_itens") return { table: "entradas", field: "itens_nota[].insumoEquivalente (nome)" };
    return { table: "", field: "" };
  }

  if (t === "itens_notas") {
    if (f === "nota_id_custom_notas_fiscais") return { table: "entradas", field: "id (entradaId)" };
    if (f === "item_id_custom_itens") return { table: "entradas", field: "itens_nota[].insumoEquivalente (resolve nome)" };
    if (f === "quantidade_number") return { table: "entradas", field: "itens_nota[].equivalenteQuantidade" };
    if (f === "subtotal_number") return { table: "entradas", field: "itens_nota[].subtotal" };
    if (f === "custo_unitario_number") return { table: "entradas", field: "itens_nota[].custoUnitario" };
    return { table: "", field: "" };
  }

  if (t === "desperdicio") {
    if (f === "lancamento_date") return { table: "desperdicios", field: "data" };
    if (f === "item_id_custom_itens") return { table: "desperdicios", field: "item (insumoId)" };
    if (f === "quantidade_number") return { table: "desperdicios", field: "quantidade" };
    if (f === "custo_total_number") return { table: "desperdicios", field: "custo" };
    if (f === "motivo1_custom_motivos_desperdicios" || f === "motivo_custom_motivos_desperdicios") return { table: "desperdicios", field: "motivo (resolve título)" };
    if (f === "motivo_text_text") return { table: "desperdicios", field: "motivo (fallback text)" };
    return { table: "", field: "" };
  }

  if (t === "motivos_desperdicios") {
    if (f === "titulo_text") return { table: "desperdicio_motivos_store", field: "payload[]" };
    return { table: "", field: "" };
  }

  if (t === "empresas") {
    if (f === "nome_fantasia_text") return { table: "companies", field: "name" };
    if (f === "cnpj_text") return { table: "companies", field: "cnpj" };
    if (f === "meta_cmv_number") return { table: "companies", field: "target_cmv" };
    return { table: "", field: "" };
  }

  if (t === "user") {
    if (f === "nome_completo_text") return { table: "profiles", field: "first_name (derived)" };
    if (f === "sobrenome_text") return { table: "profiles", field: "last_name" };
    if (f === "whatsapp_text") return { table: "profiles", field: "whatsapp" };
    if (f === "empresa_id_custom_empresas") return { table: "bubble_obj_user_map", field: "company_id (bubble)" };
    return { table: "", field: "" };
  }

  return { table: "", field: "" };
}

function main() {
  const args = parseArgs(process.argv);
  const bubble = safeReadJson(args.input);
  const elementIndex = extractElementIndex(bubble);
  const schema = buildSchema(bubble);
  const workflows = collectWorkflows(bubble, elementIndex);
  const elementSearches = collectElementSearches(bubble);
  const usageIndex = buildFieldUsageIndex(workflows);
  for (const s of elementSearches) {
    const typeToFind = normalizeTypeName(s.typeToFind);
    for (const fieldKey of s.constraintKeys ?? []) {
      const k = `${typeToFind}::${fieldKey}`;
      const cur = usageIndex.get(k) ?? [];
      cur.push({ kind: "element_search_constraint", scope: s.scope, elementName: s.elementName || "", path: s.path });
      usageIndex.set(k, cur);
    }
  }

  const rows = [];
  const prioritySet = new Set(PRIORITY_TYPES.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean));
  const priorityFieldKeysByType = new Map(
    PRIORITY_TYPES.map((t) => {
      const fields = schema[t]?.fields ?? {};
      return [String(t).toLowerCase(), new Set(Object.keys(fields))];
    }),
  );
  const schemaSummary = {};
  const relationships = [];
  for (const typeName of PRIORITY_TYPES) {
    const typeSchema = schema[typeName] ?? null;
    const fields = typeSchema?.fields ?? {};
    const apiDisplay = String(typeSchema?.display ?? "").trim();
    schemaSummary[typeName] = {
      bubbleType: typeName === "user" ? "user" : `custom.${typeName}`,
      apiType: apiDisplay ? (apiDisplay.toLowerCase() === "user" ? "user" : apiDisplay) : typeName,
      fields: Object.values(fields)
        .map((f) => ({
          fieldKey: String(f?.fieldKey ?? "").trim(),
          display: String(f?.display ?? "").trim(),
          value: String(f?.value ?? "").trim(),
          isList: Boolean(f?.isList),
          refType: String(f?.refType ?? "").trim() || "",
          optionSet: String(f?.optionSet ?? "").trim() || "",
        }))
        .filter((x) => x.fieldKey)
        .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)),
    };
    for (const f of Object.values(fields)) {
      const fieldKey = String(f?.fieldKey ?? "").trim();
      if (!fieldKey) continue;
      const refType = String(f?.refType ?? "").trim();
      const optionSet = String(f?.optionSet ?? "").trim();
      if (refType || optionSet) {
        relationships.push({
          fromType: typeName === "user" ? "user" : `custom.${typeName}`,
          fieldKey,
          fieldDisplay: String(f?.display ?? "").trim(),
          isList: Boolean(f?.isList),
          toType: refType ? `custom.${refType}` : optionSet ? `option.${optionSet}` : "",
        });
      }
    }
    for (const fieldKey of Object.keys(fields)) {
      const u = usageIndex.get(`${String(typeName).toLowerCase()}::${fieldKey}`) ?? [];
      const scopes = Array.from(new Set(u.map((x) => x.scope).filter(Boolean)));
      const target = supabaseTargetFor(typeName, fieldKey);
      rows.push({
        bubbleType: typeName === "user" ? "user" : `custom.${typeName}`,
        bubbleTypeSourceKey: typeName,
        bubbleApiType: apiDisplay ? (apiDisplay.toLowerCase() === "user" ? "user" : apiDisplay) : typeName,
        bubbleField: fieldKey,
        bubbleFieldDisplay: String(fields[fieldKey]?.display ?? "").trim(),
        bubbleFieldType: fields[fieldKey]?.value ?? "",
        telas: scopes,
        usedIn: u.slice(0, 12),
        supabaseTable: target.table,
        supabaseField: target.field,
      });
    }
  }

  const screens = {};
  const ensureScreen = (scope) => {
    const k = String(scope ?? "").trim();
    if (!k) return null;
    if (!screens[k]) screens[k] = { scope: k, searches: [], workflows: [], fields: {} };
    return screens[k];
  };

  for (const w of workflows) {
    const scr = ensureScreen(w.scope);
    if (!scr) continue;
    for (const s of w.searches ?? []) {
      const typeToFind = normalizeTypeName(s.typeToFind);
      if (!prioritySet.has(typeToFind)) continue;
      const allowedKeys = priorityFieldKeysByType.get(typeToFind) ?? null;
      const keys = (s.constraintKeys ?? []).filter((k) => (allowedKeys ? allowedKeys.has(k) : true));
      scr.searches.push({
        via: "workflow",
        workflowId: w.workflowId,
        eventType: w.eventType,
        elementName: w.elementName || "",
        typeToFind: typeToFind === "user" ? "user" : `custom.${typeToFind}`,
        constraintKeys: keys,
        path: s.path,
      });
      if (!scr.fields[typeToFind]) scr.fields[typeToFind] = { search: [], write: [] };
      scr.fields[typeToFind].search.push(...keys);
    }
    for (const c of w.changes ?? []) {
      const inferred =
        c.actionType === "MakeChangeCurrentUser"
          ? "user"
          : c.thingType
            ? normalizeTypeName(c.thingType)
            : inferSinglePriorityTypeFromJson(c.action, PRIORITY_TYPES);
      if (!prioritySet.has(inferred)) continue;
      const allowedKeys = priorityFieldKeysByType.get(inferred) ?? null;
      const keys = (c.changeKeys ?? []).filter((k) => (allowedKeys ? allowedKeys.has(k) : true));
      scr.workflows.push({
        workflowId: w.workflowId,
        eventType: w.eventType,
        elementName: w.elementName || "",
        actionType: c.actionType,
        thingType: inferred === "user" ? "user" : `custom.${inferred}`,
        changeKeys: keys,
        path: c.path,
      });
      if (!scr.fields[inferred]) scr.fields[inferred] = { search: [], write: [] };
      scr.fields[inferred].write.push(...keys);
    }
  }

  for (const s of elementSearches) {
    const scr = ensureScreen(s.scope);
    if (!scr) continue;
    const typeToFind = normalizeTypeName(s.typeToFind);
    if (!prioritySet.has(typeToFind)) continue;
    const allowedKeys = priorityFieldKeysByType.get(typeToFind) ?? null;
    const keys = (s.constraintKeys ?? []).filter((k) => (allowedKeys ? allowedKeys.has(k) : true));
    scr.searches.push({
      via: "element",
      elementId: s.elementId,
      elementName: s.elementName || "",
      typeToFind: typeToFind === "user" ? "user" : `custom.${typeToFind}`,
      constraintKeys: keys,
      path: s.path,
    });
    if (!scr.fields[typeToFind]) scr.fields[typeToFind] = { search: [], write: [] };
    scr.fields[typeToFind].search.push(...keys);
  }

  for (const scr of Object.values(screens)) {
    for (const [t, v] of Object.entries(scr.fields ?? {})) {
      const nextSearch = Array.from(new Set((v.search ?? []).filter(Boolean))).sort();
      const nextWrite = Array.from(new Set((v.write ?? []).filter(Boolean))).sort();
      scr.fields[t] = { search: nextSearch, write: nextWrite };
    }
    scr.searches = scr.searches.filter((x) => (x.constraintKeys ?? []).length > 0);
    scr.workflows = scr.workflows.filter((x) => (x.changeKeys ?? []).length > 0);
  }

  const out = {
    ok: true,
    ts: nowIso(),
    input: path.resolve(args.input),
    priorityTypes: PRIORITY_TYPES.map((t) => {
      const d = String(schema[t]?.display ?? "").trim();
      const api = d ? (d.toLowerCase() === "user" ? "user" : d) : t;
      return { sourceKey: t, bubbleType: t === "user" ? "user" : `custom.${t}`, apiType: api };
    }),
    pages: Object.values(bubble.pages ?? {}).map((p) => ({ id: String(p?.id ?? ""), name: String(p?.name ?? "") })),
    workflowsCount: workflows.length,
    searchesCount: workflows.reduce((acc, w) => acc + (w.searches?.length ?? 0), 0),
    matrixRowsCount: rows.length,
    elementSearchesCount: elementSearches.length,
    schema: schemaSummary,
    relationships,
    screens,
    rows,
    workflows: workflows
      .filter((w) => (w.searches?.length ?? 0) > 0 || (w.changes?.length ?? 0) > 0)
      .slice(0, 500),
  };

  if (!fs.existsSync(path.dirname(args.out))) fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ ok: true, out: path.resolve(args.out), matrixRowsCount: rows.length, workflowsCount: workflows.length, elementSearchesCount: elementSearches.length }) + "\n");
}

main();
