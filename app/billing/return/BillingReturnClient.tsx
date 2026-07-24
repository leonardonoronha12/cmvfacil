"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingSpinner from "../../components/LoadingSpinner";

type Origin = "signup" | "settings";
type CheckoutResult = "success" | "cancel" | null;

function parseOrigin(value: string | null): Origin {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "signup") return "signup";
  return "settings";
}

function parseCheckout(value: string | null): CheckoutResult {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "success") return "success";
  if (v === "cancel") return "cancel";
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildLoginUrl(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export default function BillingReturnClient() {
  const params = useSearchParams();
  const didRunRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [effectiveOrigin, setEffectiveOrigin] = useState<Origin | null>(null);

  const originParam = useMemo(() => parseOrigin(params.get("origin")), [params]);
  const checkout = useMemo(() => parseCheckout(params.get("checkout")), [params]);

  const origin = effectiveOrigin ?? originParam;
  const successTarget = origin === "signup" ? "/cadastro-empresa?onboarding=1&checkout=success" : "/ajustes?tab=planos&checkout=success";
  const processingTarget = origin === "signup" ? "/cadastro-empresa?onboarding=1&checkout=processing" : "/ajustes?tab=planos&checkout=processing";
  const cancelTarget = origin === "signup" ? "/cadastro-empresa?onboarding=1&checkout=cancel" : "/ajustes?tab=planos&checkout=cancel";

  useEffect(() => {
    if (effectiveOrigin !== null) return;
    try {
      const pending = sessionStorage.getItem("cmv_onboarding_checkout_pending");
      if (pending === "1") {
        setEffectiveOrigin("signup");
        return;
      }
    } catch {}
    setEffectiveOrigin(originParam);
  }, [effectiveOrigin, originParam]);

  useEffect(() => {
    if (effectiveOrigin === null) return;
    if (didRunRef.current) return;
    didRunRef.current = true;

    void (async () => {
      const target = checkout === "cancel" ? cancelTarget : successTarget;
      if (!checkout) {
        window.location.replace(target);
        return;
      }

      setStatus("loading");
      setError("");

      if (checkout === "cancel") {
        if (origin === "signup") {
          try {
            sessionStorage.removeItem("cmv_onboarding_checkout_pending");
          } catch {}
          try {
            void fetch("/api/billing/access", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "checkout_cancel" }),
              keepalive: true,
            }).catch(() => {});
          } catch {}
          window.location.replace(target);
          return;
        }
        try {
          const me = await fetch("/api/billing/access", { method: "GET" });
          if (me.status === 401) {
            window.location.replace(buildLoginUrl(target));
            return;
          }
          if (me.ok) {
            await fetch("/api/billing/access", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "checkout_cancel" }),
            }).catch(() => {});
          }
        } catch {}
        window.location.replace(target);
        return;
      }

      const delays = [0, 1000, 2000, 3000, 5000, 4000];
      for (const d of delays) {
        if (d) await sleep(d);
        try {
          const res = await fetch("/api/billing/access", { method: "GET" });
          if (res.status === 401) {
            window.location.replace(buildLoginUrl(target));
            return;
          }
          const j = (await res.json().catch(() => null)) as any;
          const subStatus = String(j?.access?.subscription?.status ?? "").trim().toLowerCase();
          if (res.ok && j?.ok && subStatus === "active") {
            window.location.replace(successTarget);
            return;
          }
        } catch {}
      }

      window.location.replace(processingTarget);
    })().catch((err) => {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [cancelTarget, checkout, effectiveOrigin, processingTarget, successTarget]);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        {status === "loading" ? (
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <LoadingSpinner size={18} />
            <span>Processando…</span>
          </div>
        ) : null}
        {status === "error" ? (
          <div style={{ marginTop: 12, color: "#b91c1c" }}>{error || "Falha ao processar retorno do pagamento."}</div>
        ) : null}
      </div>
    </main>
  );
}

