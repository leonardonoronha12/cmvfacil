"use client";

import { useMemo } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const details = useMemo(() => {
    const msg = String(error?.message ?? "Erro desconhecido");
    const digest = String((error as any)?.digest ?? "").trim();
    const stack = String(error?.stack ?? "").trim();
    return [`Mensagem: ${msg}`, digest ? `Digest: ${digest}` : "", stack ? `Stack:\n${stack}` : ""].filter(Boolean).join("\n\n");
  }, [error]);

  function clearLocalData() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("cmvfacil:")) keys.push(k);
      }
      for (const k of keys) window.localStorage.removeItem(k);
    } catch {}
    window.location.reload();
  }

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
    } catch {}
  }

  return (
    <html lang="pt-br">
      <body style={{ margin: 0 }}>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 18, background: "#f7f8f8" }}>
          <div style={{ width: "100%", maxWidth: 720, background: "#fff", border: "1px solid #e4e8e7", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>Ocorreu um erro</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#2f3537", fontWeight: 600 }}>
              Se isso persistir, use “Copiar detalhes” e envie para o suporte.
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  border: "1px solid #e4e8e7",
                  background: "#ffffff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={clearLocalData}
                style={{
                  border: "1px solid #e4e8e7",
                  background: "#ffffff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Limpar dados locais
              </button>
              <button
                type="button"
                onClick={copyDetails}
                style={{
                  border: "1px solid #e4e8e7",
                  background: "#ffffff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Copiar detalhes
              </button>
            </div>

            <pre
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e4e8e7",
                background: "#0f1414",
                color: "#e7eded",
                overflow: "auto",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {details}
            </pre>
          </div>
        </div>
      </body>
    </html>
  );
}

