import {
  mapBubbleAnexo,
  mapBubbleCliente,
  mapBubbleEmpresa,
  mapBubbleFinanceiro,
  mapBubbleOrdemServico,
  mapBubbleVeiculo,
  type BubbleObjMapped,
} from "./bubbleObjMappers";

export type BubbleObjFinalTable =
  | "bubble_obj_empresa"
  | "bubble_obj_cliente"
  | "bubble_obj_veiculo"
  | "bubble_obj_ordem_servico"
  | "bubble_obj_financeiro"
  | "bubble_obj_anexo";

export function classifyBubbleObjType(objectType: string): { key: string; table: BubbleObjFinalTable; map: (raw: any) => BubbleObjMapped<any> } | null {
  const t = String(objectType ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("empresa")) return { key: "empresa", table: "bubble_obj_empresa", map: mapBubbleEmpresa };
  if (t.includes("cliente") || t.includes("customer")) return { key: "cliente", table: "bubble_obj_cliente", map: mapBubbleCliente };
  if (t.includes("veiculo") || t.includes("vehicle")) return { key: "veiculo", table: "bubble_obj_veiculo", map: mapBubbleVeiculo };
  if (t.includes("ordem") || t.includes("servico") || t.includes("service") || t === "os" || /(^|[_\-\s])os($|[_\-\s])/.test(t))
    return { key: "ordem_servico", table: "bubble_obj_ordem_servico", map: mapBubbleOrdemServico };
  if (t.includes("finance") || t.includes("lanc")) return { key: "financeiro", table: "bubble_obj_financeiro", map: mapBubbleFinanceiro };
  if (t.includes("anex") || t.includes("attach")) return { key: "anexo", table: "bubble_obj_anexo", map: mapBubbleAnexo };
  return null;
}
