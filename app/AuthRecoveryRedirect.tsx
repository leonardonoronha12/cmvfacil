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

  useEffect(() => {
    let alive = true;

    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

    const shouldReloadAfterImport = () => {
      try {
        const k = "cmvfacil:autoImport:reloadedMs";
        const raw = (window.sessionStorage.getItem(k) ?? "").trim();
        const last = raw ? Number.parseInt(raw, 10) : 0;
        if (last && Number.isFinite(last) && Date.now() - last < 60_000) return false;
        window.sessionStorage.setItem(k, String(Date.now()));
      } catch {}
      return true;
    };

    const getThrottleOk = () => {
      try {
        const raw = window.sessionStorage.getItem("cmvfacil:autoImport:lastMs") || "";
        const last = raw ? Number.parseInt(raw, 10) : 0;
        if (last && Number.isFinite(last) && Date.now() - last < 10_000) return false;
        window.sessionStorage.setItem("cmvfacil:autoImport:lastMs", String(Date.now()));
      } catch {}
      return true;
    };

    const getBubbleCreds = () => {
      try {
        const baseUrl = (window.localStorage.getItem("cmvfacil:bubbleBaseUrl") ?? "").trim();
        const token = (window.localStorage.getItem("cmvfacil:bubbleToken") ?? "").trim();
        return { baseUrl, token };
      } catch {
        return { baseUrl: "", token: "" };
      }
    };

    const run = async () => {
      const path = window.location.pathname || "";
      if (path.startsWith("/ajustes")) return;
      const creds = getBubbleCreds();
      if (!creds.baseUrl || !creds.token) {
        if (!path.startsWith("/ajustes")) {
          window.location.assign(`/ajustes/importar-bubble-api?next=${encodeURIComponent(path)}`);
        }
        return;
      }
      if (!getThrottleOk()) return;
      const meRes = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
      const meJson = (await meRes.json().catch(() => null)) as any;
      const userId = String(meJson?.userId ?? "").trim();
      if (!meRes.ok || !userId) return;

      const ensureRes = await fetch("/api/bubble-import/ensure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: creds.baseUrl || undefined, token: creds.token || undefined }),
        cache: "no-store",
      });
      const ensureJson = (await ensureRes.json().catch(() => null)) as any;
      if (!ensureRes.ok || !ensureJson?.ok) {
        if (!path.startsWith("/ajustes")) window.location.assign(`/ajustes/importar-bubble-api?next=${encodeURIComponent(path)}`);
        return;
      }
      const status = String(ensureJson?.status ?? "");
      if (status === "ready") return;
      if (status === "needs_setup") {
        const reason = String(ensureJson?.reason ?? "").trim().toLowerCase();
        const missingCreds = reason.includes("missing_bubble_credentials") || reason.includes("missing_base_url") || reason.includes("missing_token");
        if (missingCreds && !path.startsWith("/ajustes")) {
          window.location.assign(`/ajustes/importar-bubble-api?next=${encodeURIComponent(path)}`);
        }
        return;
      }

      const statePath = String(ensureJson?.state?.statePath ?? "").trim();
      const mode = String(ensureJson?.mode ?? "").trim();
      if (!statePath || mode !== "sync") return;

      for (let i = 0; i < 2000; i++) {
        if (!alive) return;
        await sleep(1200);
        const tickRes = await fetch("/api/bubble-import/sync/tick", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            statePath,
            resume: true,
            maxOps: 12,
            baseUrl: creds.baseUrl || undefined,
            token: creds.token || undefined,
            importAsUserId: userId,
          }),
          cache: "no-store",
        });
        const tickJson = (await tickRes.json().catch(() => null)) as any;
        if (!tickRes.ok || !tickJson?.ok) {
          if (!path.startsWith("/ajustes")) window.location.assign(`/ajustes/importar-bubble-api?next=${encodeURIComponent(path)}`);
          return;
        }
        const phase = String(tickJson?.state?.phase ?? "");
        if (phase === "done") {
          if (shouldReloadAfterImport()) window.location.reload();
          return;
        }
        if (phase === "error") {
          if (!path.startsWith("/ajustes")) window.location.assign(`/ajustes/importar-bubble-api?next=${encodeURIComponent(path)}`);
          return;
        }
      }
    };

    void run().catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  return null;
}
