import DesperdiciosClient from "./DesperdiciosClient";

export default function DesperdiciosPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const srcRaw = searchParams?.source;
  const src = String(Array.isArray(srcRaw) ? srcRaw[0] : srcRaw ?? "")
    .trim()
    .toLowerCase();
  const initialSource = src === "compat" ? "compat" : "legacy";
  const initialReadOnly = initialSource === "compat";
  return <DesperdiciosClient initialSourceMeta={{ source: initialSource, readOnly: initialReadOnly }} />;
}
