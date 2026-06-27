export type BubbleObjMapperStatus = "ready" | "pending_review" | "error";

export type BubbleObjMapped<T = any> = {
  status: BubbleObjMapperStatus;
  normalized: T | null;
  errorMessage: string;
  pendingReasons: string[];
  relations: Record<string, string>;
};

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function extractAnyBubbleId(input: unknown) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function baseResult(): BubbleObjMapped<any> {
  return { status: "ready", normalized: null, errorMessage: "", pendingReasons: [], relations: {} };
}

export function mapBubbleUsuario(input: any): BubbleObjMapped<{ bubble_user_id: string; email: string; nome: string }> {
  const out = baseResult();
  const bubbleUserId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id", "user_id", "usuario_id"]));
  const email = normalizeText(pickAny(input, ["email", "user_email", "usuario_email", "login", "username"])).toLowerCase();
  const nome =
    normalizeText(pickAny(input, ["nome", "name", "nome_completo", "full_name", "fullname"])) ||
    normalizeText([pickAny(input, ["first_name", "firstname"]), pickAny(input, ["last_name", "lastname"])].filter(Boolean).join(" "));
  if (!bubbleUserId) out.pendingReasons.push("missing_bubble_user_id");
  if (!email) out.pendingReasons.push("missing_email");
  if (!nome) out.pendingReasons.push("missing_name");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.normalized = { bubble_user_id: bubbleUserId, email, nome };
  return out;
}

export function mapBubbleEmpresa(input: any): BubbleObjMapped<{ bubble_unique_id: string; nome: string; bubble_user_id: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const nome = normalizeText(pickAny(input, ["nome", "name", "razao_social", "titulo", "title"]));
  const bubbleUserId = extractAnyBubbleId(pickAny(input, ["bubble_user_id", "user_id", "usuario_id", "owner", "created_by", "criado_por"])) || extractAnyBubbleId(JSON.stringify(input ?? {}));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!nome) out.pendingReasons.push("missing_name");
  if (!bubbleUserId) out.pendingReasons.push("missing_bubble_user_id");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { bubble_user_id: bubbleUserId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, nome, bubble_user_id: bubbleUserId };
  return out;
}

export function mapBubbleCliente(input: any): BubbleObjMapped<{ bubble_unique_id: string; nome: string; empresa_id: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const nome = normalizeText(pickAny(input, ["nome", "name", "cliente", "razao_social", "titulo", "title"]));
  const empresaId = extractAnyBubbleId(pickAny(input, ["empresa_id", "empresa", "company_id", "company"])) || extractAnyBubbleId(pickAny(input, ["empresa_ref", "company_ref"]));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!nome) out.pendingReasons.push("missing_name");
  if (!empresaId) out.pendingReasons.push("missing_empresa_id");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { empresa_id: empresaId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, nome, empresa_id: empresaId };
  return out;
}

export function mapBubbleVeiculo(input: any): BubbleObjMapped<{ bubble_unique_id: string; placa: string; cliente_id: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const placa = normalizeText(pickAny(input, ["placa", "plate", "vehicle_plate"])).toUpperCase();
  const clienteId = extractAnyBubbleId(pickAny(input, ["cliente_id", "cliente", "customer_id", "customer"])) || extractAnyBubbleId(pickAny(input, ["cliente_ref", "customer_ref"]));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!placa) out.pendingReasons.push("missing_placa");
  if (!clienteId) out.pendingReasons.push("missing_cliente_id");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { cliente_id: clienteId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, placa, cliente_id: clienteId };
  return out;
}

export function mapBubbleOrdemServico(input: any): BubbleObjMapped<{ bubble_unique_id: string; veiculo_id: string; cliente_id: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const veiculoId = extractAnyBubbleId(pickAny(input, ["veiculo_id", "veiculo", "vehicle_id", "vehicle"])) || extractAnyBubbleId(pickAny(input, ["veiculo_ref", "vehicle_ref"]));
  const clienteId = extractAnyBubbleId(pickAny(input, ["cliente_id", "cliente", "customer_id", "customer"])) || extractAnyBubbleId(pickAny(input, ["cliente_ref", "customer_ref"]));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!veiculoId) out.pendingReasons.push("missing_veiculo_id");
  if (!clienteId) out.pendingReasons.push("missing_cliente_id");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { veiculo_id: veiculoId, cliente_id: clienteId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, veiculo_id: veiculoId, cliente_id: clienteId };
  return out;
}

export function mapBubbleFinanceiro(input: any): BubbleObjMapped<{ bubble_unique_id: string; ordem_servico_id: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const osId = extractAnyBubbleId(pickAny(input, ["ordem_servico_id", "ordem_id", "os_id", "servico_id"])) || extractAnyBubbleId(pickAny(input, ["ordem_servico_ref", "os_ref", "servico_ref"]));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!osId) out.pendingReasons.push("missing_ordem_servico_id");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { ordem_servico_id: osId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, ordem_servico_id: osId };
  return out;
}

export function mapBubbleAnexo(input: any): BubbleObjMapped<{ bubble_unique_id: string; parent_id: string; url: string }> {
  const out = baseResult();
  const bubbleUniqueId = normalizeText(pickAny(input, ["unique_id", "_id", "id", "bubble_id"]));
  const parentId = extractAnyBubbleId(pickAny(input, ["parent_id", "ordem_servico_id", "os_id", "cliente_id", "veiculo_id"])) || extractAnyBubbleId(pickAny(input, ["parent_ref", "ordem_servico_ref", "os_ref"]));
  const url = normalizeText(pickAny(input, ["url", "file", "arquivo", "anexo", "attachment"]));
  if (!bubbleUniqueId) out.pendingReasons.push("missing_unique_id");
  if (!parentId) out.pendingReasons.push("missing_parent_id");
  if (!url) out.pendingReasons.push("missing_url");
  if (out.pendingReasons.length) out.status = "pending_review";
  out.relations = { parent_id: parentId };
  out.normalized = { bubble_unique_id: bubbleUniqueId, parent_id: parentId, url };
  return out;
}

