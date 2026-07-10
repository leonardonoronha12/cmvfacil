import FichasTecnicasClient from "./FichasTecnicasClient";

export const dynamic = "force-dynamic";

export default function FichasTecnicasPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const srcRaw = searchParams?.source;
  const src = String(Array.isArray(srcRaw) ? srcRaw[0] : srcRaw ?? "")
    .trim()
    .toLowerCase();
  const source = src === "compat" ? "compat" : "legacy";
  const readOnly = source === "compat";
  return <FichasTecnicasClient initialSourceMeta={{ source, readOnly }} />;
}
