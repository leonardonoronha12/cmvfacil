"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function sanitizeNextPath(raw: string) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (!v.startsWith("/")) return "";
  if (v.startsWith("//")) return "";
  if (v.includes("://")) return "";
  if (v.toLowerCase().startsWith("/javascript:")) return "";
  if (v.toLowerCase().startsWith("/data:")) return "";
  return v;
}

function isRecoveryHash(hash: string) {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const p = new URLSearchParams(h);
  return (p.get("type") ?? "").trim() === "recovery";
}

export default function AuthCallbackPage() {
  const search = useSearchParams();
  const nextRaw = useMemo(() => (search.get("next") ?? "").trim(), [search]);

  useEffect(() => {
    const hash = window.location.hash || "";
    const safeNext =
      sanitizeNextPath(nextRaw) || (isRecoveryHash(hash) ? "/restaurar-senha" : "/dashboard");
    window.location.replace(`${safeNext}${hash}`);
  }, [nextRaw]);

  return null;
}
