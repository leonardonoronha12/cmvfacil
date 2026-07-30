"use client";

import { useEffect, useState } from "react";

function readSessionFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    accessToken: (params.get("access_token") ?? "").trim(),
    refreshToken: (params.get("refresh_token") ?? "").trim(),
  };
}

export default function ImpersonateClient() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function activateSession() {
      try {
        const { accessToken, refreshToken } = readSessionFromHash();
        if (!accessToken) throw new Error("Link de acesso inválido ou expirado.");

        const response = await fetch("/api/auth/supabase-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
          }),
        });
        const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error ?? "Não foi possível iniciar a sessão do usuário.");
        }

        window.history.replaceState(null, "", "/auth/impersonate");
        window.location.replace("/dashboard");
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a sessão do usuário.");
        }
      }
    }

    void activateSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f4f7f5",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(440px, 100%)",
          border: "1px solid #dfe7e2",
          borderRadius: 18,
          background: "#fff",
          padding: 32,
          textAlign: "center",
          boxShadow: "0 18px 45px rgba(3, 65, 48, 0.10)",
        }}
      >
        <img src="/brand/logo-preto.svg" alt="CMV Fácil" style={{ width: 150, height: "auto", marginBottom: 24 }} />
        <h1 style={{ margin: "0 0 10px", fontSize: 24, color: "#063f36" }}>
          {error ? "Acesso não concluído" : "Entrando como usuário"}
        </h1>
        <p style={{ margin: 0, color: error ? "#b42318" : "#5c6f68", lineHeight: 1.55 }}>
          {error || "Preparando o ambiente com segurança. Aguarde um instante…"}
        </p>
      </section>
    </main>
  );
}
