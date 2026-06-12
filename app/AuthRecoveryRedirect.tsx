"use client";

import { useEffect } from "react";

export default function AuthRecoveryRedirect() {
  useEffect(() => {
    const path = window.location.pathname || "";
    if (path.startsWith("/restaurar-senha")) return;
    if (path === "/login" || path.startsWith("/login/")) return;
    if (path === "/cadastro-usuario" || path.startsWith("/cadastro-usuario/")) return;
    if (path === "/cadastro-empresa" || path.startsWith("/cadastro-empresa/")) return;
    if (path === "/resetar-senha" || path.startsWith("/resetar-senha/")) return;

    const hash = window.location.hash || "";
    if (hash) {
      const hp = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const type = (hp.get("type") ?? "").trim();
      const at = (hp.get("access_token") ?? "").trim();
      const rt = (hp.get("refresh_token") ?? "").trim();
      if (type === "recovery" && at && rt) {
        window.location.replace(`/restaurar-senha${hash}`);
        return;
      }
    }

    const sp = new URLSearchParams(window.location.search || "");
    const typeQ = (sp.get("type") ?? "").trim();
    const atQ = (sp.get("access_token") ?? "").trim();
    const rtQ = (sp.get("refresh_token") ?? "").trim();
    if (typeQ === "recovery" && atQ && rtQ) {
      window.location.replace(`/restaurar-senha${window.location.search}`);
    }
  }, []);

  return null;
}
