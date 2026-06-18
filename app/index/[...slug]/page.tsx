import { redirect } from "next/navigation";

function buildQueryString(searchParams: Record<string, string | string[] | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") {
      if (v) qs.set(k, v);
      continue;
    }
    if (Array.isArray(v)) {
      for (const it of v) if (it) qs.append(k, it);
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default function LegacyIndexRedirectPage(props: { params: { slug?: string[] }; searchParams: Record<string, string | string[] | undefined> }) {
  const slug = Array.isArray(props.params?.slug) ? props.params.slug : [];
  const first = String(slug[0] ?? "").trim().toLowerCase();
  const qs = buildQueryString(props.searchParams);

  if (first === "pre_preparo" || first === "pre-preparo") redirect(`/pre-preparo${qs}`);
  if (first === "insumos") redirect(`/insumos${qs}`);
  if (first === "fornecedores") redirect(`/fornecedores${qs}`);
  if (first === "inventario") redirect(`/inventario${qs}`);
  if (first === "desperdicios") redirect(`/desperdicios${qs}`);
  if (first === "entradas") redirect(`/entradas${qs}`);
  if (first === "ficha_tecnica" || first === "ficha-tecnica" || first === "fichas_tecnicas" || first === "fichas-tecnicas") redirect(`/fichas-tecnicas${qs}`);
  if (first === "ajustes") redirect(`/ajustes${qs}`);

  redirect(`/dashboard${qs}`);
}

