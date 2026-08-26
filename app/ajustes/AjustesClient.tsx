"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dash from "../dashboard/dashboard.module.css";
import styles from "./ajustes.module.css";
import { clearMeStore, loadMeFromApi, readMeFromStore, subscribeMe } from "../lib/meStore";
import { maskCnpj, maskPhoneBR } from "../lib/masks";

function IconGearSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M7.25 2.5H10.75L11.25 4.2C11.4 4.25 11.55 4.32 11.69 4.4L13.35 3.65L15.1 6.75L13.7 7.85C13.72 8.0 13.75 8.15 13.75 8.3C13.75 8.45 13.72 8.6 13.7 8.75L15.1 9.85L13.35 12.95L11.69 12.2C11.55 12.28 11.4 12.35 11.25 12.4L10.75 14.1H7.25L6.75 12.4C6.6 12.35 6.45 12.28 6.31 12.2L4.65 12.95L2.9 9.85L4.3 8.75C4.28 8.6 4.25 8.45 4.25 8.3C4.25 8.15 4.28 8.0 4.3 7.85L2.9 6.75L4.65 3.65L6.31 4.4C6.45 4.32 6.6 4.25 6.75 4.2L7.25 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 10.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSearchMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M16.7 16.7 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBurgerBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 10.5C5.7 7.63604 8.43351 5.5 12 5.5C15.5665 5.5 18.3 7.63604 18.75 10.5H5.25Z" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13.5H19.5" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 15.75H18" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 18H17.25" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.8 6.2L19.8 4.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M19.2 6.8H21.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconUserPlaceholder() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 12.25c2.071 0 3.75-1.679 3.75-3.75S14.071 4.75 12 4.75 8.25 6.429 8.25 8.5 9.929 12.25 12 12.25Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 19.25c1.42-3.05 3.9-4.75 6.5-4.75s5.08 1.7 6.5 4.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTrashSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 3H15L16 7H8L9 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6.5 7L7.4 20H16.6L17.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11V16M14 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

type TabKey = "minha-conta" | "alterar-senha" | "minha-empresa" | "usuarios" | "planos";

export default function AjustesClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabFromUrl = useMemo((): TabKey => {
    const raw = String(searchParams.get("tab") ?? "").trim().toLowerCase();
    if (raw === "alterar-senha") return "alterar-senha";
    if (raw === "minha-empresa") return "minha-empresa";
    if (raw === "usuarios") return "usuarios";
    if (raw === "planos") return "planos";
    return "minha-conta";
  }, [searchParams]);
  const [tab, setTab] = useState<TabKey>(tabFromUrl);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    const onPopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = String(params.get("tab") ?? "").trim().toLowerCase();
        if (raw === "alterar-senha") return setTab("alterar-senha");
        if (raw === "minha-empresa") return setTab("minha-empresa");
        if (raw === "usuarios") return setTab("usuarios");
        if (raw === "planos") return setTab("planos");
        return setTab("minha-conta");
      } catch {
        setTab("minha-conta");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [nome, setNome] = useState(() => String(readMeFromStore()?.nome ?? "").trim());
  const [sobrenome, setSobrenome] = useState(() => String(readMeFromStore()?.sobrenome ?? "").trim());
  const [email, setEmail] = useState(() => String(readMeFromStore()?.email ?? "").trim());
  const [whatsapp, setWhatsapp] = useState(() => String(readMeFromStore()?.whatsapp ?? "").trim());
  const [permissao, setPermissao] = useState<"Administrador" | "Colaborador">(() => readMeFromStore()?.role ?? "Colaborador");

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [repitaSenha, setRepitaSenha] = useState("");

  const [empresaNome, setEmpresaNome] = useState(() => String(readMeFromStore()?.companyName ?? "").trim());
  const [cnpj, setCnpj] = useState(() => String(readMeFromStore()?.companyCnpj ?? "").trim());
  const [emailCorp, setEmailCorp] = useState(() => String((readMeFromStore() as any)?.companyEmail ?? "").trim());
  const [empresaWhats, setEmpresaWhats] = useState(() => String(readMeFromStore()?.companyWhatsapp ?? "").trim());
  const [ramo, setRamo] = useState(() => String(readMeFromStore()?.companyIndustry ?? "").trim() || "Hamburgueria");

  const [planType, setPlanType] = useState<"PRO Mensal" | "PRO Anual">("PRO Mensal");
  const [cardLast4, setCardLast4] = useState("");
  const [planStatus, setPlanStatus] = useState("");
  const [billingAccess, setBillingAccess] = useState<any | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingAction, setBillingAction] = useState<"" | "portal" | "checkout_monthly" | "checkout_yearly" | "cancel_pending">("");
  const [members, setMembers] = useState(() => readMeFromStore()?.members ?? []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Administrador" | "Colaborador">("Colaborador");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<{ name: string; email: string } | null>(null);
  const [memberRemoveLoading, setMemberRemoveLoading] = useState(false);
  const [memberRemoveError, setMemberRemoveError] = useState("");

  const [loggingOut, setLoggingOut] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [accountSaveError, setAccountSaveError] = useState("");
  const [companySaveError, setCompanySaveError] = useState("");

  const canSaveAccount = Boolean(nome.trim() && sobrenome.trim() && email.trim() && permissao);
  const canSavePassword = Boolean(senhaAtual.trim() && novaSenha.trim() && repitaSenha.trim() && novaSenha === repitaSenha);
  const canSaveCompany = Boolean(empresaNome.trim());

  function tabClass(key: TabKey) {
    return key === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab;
  }

  function goTab(next: TabKey) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.pushState({}, "", url.toString());
    } catch {}
  }

  const [avatarUrl, setAvatarUrl] = useState(() => String(readMeFromStore()?.avatarUrl ?? "").trim());
  const [companyLogoUrl, setCompanyLogoUrl] = useState(() => String(readMeFromStore()?.companyLogoUrl ?? "").trim());

  useEffect(() => {
    const apply = () => {
      const me = readMeFromStore();
      if (!me) return;
      const whatsappLocal = String(me.whatsapp ?? "")
        .trim()
        .replace(/^\+?55/, "")
        .trim();
      const companyWhatsLocal = String((me as any).companyWhatsapp ?? "")
        .trim()
        .replace(/^\+?55/, "")
        .trim();
      setNome((prev) => (prev.trim() ? prev : String(me.nome ?? "").trim()));
      setSobrenome((prev) => (prev.trim() ? prev : String(me.sobrenome ?? "").trim()));
      setEmail((prev) => (prev.trim() ? prev : String(me.email ?? "").trim()));
      setWhatsapp((prev) => (prev.trim() ? prev : maskPhoneBR(whatsappLocal)));
      setPermissao((prev) => {
        const desired = String((me as any).role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador";
        return prev === "Colaborador" ? desired : prev;
      });
      setEmpresaNome((prev) => (prev.trim() ? prev : String(me.companyName ?? "").trim()));
      setCnpj((prev) => (prev.trim() ? prev : String((me as any).companyCnpj ?? "").trim()));
      setEmailCorp((prev) => (prev.trim() ? prev : String((me as any).companyEmail ?? "").trim()));
      setEmpresaWhats((prev) => (prev.trim() ? prev : maskPhoneBR(companyWhatsLocal)));
      setRamo((prev) => {
        const next = String((me as any).companyIndustry ?? "").trim();
        return prev === "Hamburgueria" && next ? next : prev.trim() ? prev : next;
      });
      setAvatarUrl(String(me.avatarUrl ?? "").trim());
      setCompanyLogoUrl(String((me as any).companyLogoUrl ?? "").trim());
      setMembers(Array.isArray(me.members) ? me.members : []);
      const planRaw = String(me.planType ?? "").trim();
      if (planRaw) {
        const up = planRaw.toUpperCase();
        if (up.includes("ANUAL")) setPlanType("PRO Anual");
        else setPlanType("PRO Mensal");
      }
      setPlanStatus(String(me.planStatus ?? "").trim());
      const last4 = String(me.cardLast4 ?? "").trim().replace(/[^\d]/g, "");
      if (last4.length >= 4) setCardLast4(last4.slice(-4));
    };
    apply();
    const unsub = subscribeMe(() => apply());
    void loadMeFromApi().then(() => apply());
    void (async () => {
      setBillingLoading(true);
      setBillingError("");
      try {
        const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
        const delays = [0, 800, 1500];
        let lastErr: unknown = null;
        for (const d of delays) {
          if (d) await sleep(d);
          try {
            const res = await fetch("/api/billing/access", { method: "GET" });
            const j = (await res.json().catch(() => null)) as any;
            if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "billing_access_failed"));
            setBillingAccess(j.access ?? null);
            const status = String(j?.access?.subscription?.status ?? "").trim();
            setPlanStatus(status);
            const last4 = String(j?.access?.cardLast4 ?? "")
              .trim()
              .replace(/[^\d]/g, "");
            if (last4.length === 4) setCardLast4(last4);
            const plan = String(j?.access?.subscription?.plan ?? "").trim();
            if (plan === "pro_yearly") setPlanType("PRO Anual");
            else if (plan === "pro_monthly") setPlanType("PRO Mensal");
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (lastErr) throw lastErr;
      } catch (err) {
        setBillingError(toFriendlyBillingError(err instanceof Error ? err.message : String(err)));
      } finally {
        setBillingLoading(false);
      }
    })();
    return () => unsub();
  }, []);

  useEffect(() => {
    const qp = String(searchParams.get("checkout") ?? "").trim().toLowerCase();
    const hasReturnParams = Boolean(qp || searchParams.get("session_id") || searchParams.get("origin"));
    if (!hasReturnParams) return;
    void (async () => {
      if (qp === "cancel") {
        try {
          await fetch("/api/billing/access", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "checkout_cancel" }),
          });
        } catch {}
      }

      try {
        const res = await fetch("/api/billing/access", { method: "GET" });
        const j = (await res.json().catch(() => null)) as any;
        if (res.ok && j?.ok) {
          setBillingAccess(j.access ?? null);
          const status = String(j?.access?.subscription?.status ?? "").trim();
          setPlanStatus(status);
          const last4 = String(j?.access?.cardLast4 ?? "")
            .trim()
            .replace(/[^\d]/g, "");
          if (last4.length === 4) setCardLast4(last4);
          const plan = String(j?.access?.subscription?.plan ?? "").trim();
          if (plan === "pro_yearly") setPlanType("PRO Anual");
          else if (plan === "pro_monthly") setPlanType("PRO Mensal");
        }
      } catch {}

      try {
        router.replace("/ajustes?tab=planos");
      } catch {}
    })();
  }, [router, searchParams]);

  async function uploadCompanyLogo(file: File) {
    if (savingCompany) return;
    setCompanySaveError("");
    setSavingCompany(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch("/api/companies/logo", { method: "POST", body: form });
      const upj = (await up.json().catch(() => null)) as any;
      if (!up.ok || !upj?.ok || !upj?.publicUrl) throw new Error(String(upj?.error ?? upj?.details ?? "upload_failed"));
      const publicUrl = String(upj.publicUrl).trim();
      setCompanyLogoUrl(publicUrl);
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyLogoUrl: publicUrl }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "failed_to_save"));
      await loadMeFromApi();
    } catch (err) {
      setCompanySaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCompany(false);
    }
  }

  const [blockedMeta] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return {
        blocked: String(p.get("blocked") ?? "").trim() === "1",
        from: String(p.get("from") ?? "").trim(),
        reason: String(p.get("reason") ?? "").trim().toLowerCase(),
      };
    } catch {
      return { blocked: false, from: "", reason: "" };
    }
  });
  const blockedParam = blockedMeta.blocked;
  const blockedFrom = blockedMeta.from;
  const blockedReasonParam = blockedMeta.reason;
  const accessAllowed = billingAccess ? Boolean(billingAccess.allowed) : true;
  const accessReason = String(billingAccess?.reason ?? "").trim();
  const subStatus = String(billingAccess?.subscription?.status ?? "").trim();
  const subPlan = String(billingAccess?.subscription?.plan ?? "").trim();
  const trialEndsAt = String(billingAccess?.trial?.endsAt ?? "").trim();
  const trialDays = typeof billingAccess?.trial?.daysRemaining === "number" ? billingAccess.trial.daysRemaining : null;
  const periodEnd = String(billingAccess?.subscription?.currentPeriodEnd ?? "").trim();
  const cancelAtPeriodEnd = Boolean(billingAccess?.subscription?.cancelAtPeriodEnd);
  const checkoutParam = String(searchParams.get("checkout") ?? "").trim().toLowerCase();
  const checkoutStatus = String(billingAccess?.checkout?.status ?? "").trim();
  const checkoutUrl = String(billingAccess?.checkout?.url ?? "").trim();
  const checkoutPlan = String(billingAccess?.checkout?.plan ?? "").trim();
  const checkoutOpenRaw = checkoutStatus.trim().toLowerCase() === "open";

  const showBlocked = !accessAllowed && (blockedParam || accessReason === "expired" || accessReason === "payment_required");

  useEffect(() => {
    if (!billingAccess) return;
    if (!blockedParam) return;
    if (!billingAccess.allowed) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("blocked");
      url.searchParams.delete("reason");
      url.searchParams.delete("from");
      router.replace(`${url.pathname}?${url.searchParams.toString()}`);
    } catch {}
  }, [billingAccess, blockedParam, router]);

  const subStatusLower = subStatus.trim().toLowerCase();
  const periodEndMs = periodEnd ? Date.parse(periodEnd) : NaN;
  const periodActive = periodEnd && Number.isFinite(periodEndMs) ? Date.now() < periodEndMs : false;
  const hasRecognizedSubscription =
    subStatusLower === "active" || subStatusLower === "trialing" || subStatusLower === "past_due" || (cancelAtPeriodEnd && periodActive);
  const checkoutOpen = checkoutOpenRaw && !hasRecognizedSubscription;
  const checkoutPlanLower = checkoutPlan.trim().toLowerCase();
  const checkoutMonthly = checkoutOpen && checkoutPlanLower === "pro_monthly";
  const checkoutYearly = checkoutOpen && checkoutPlanLower === "pro_yearly";
  const planMiniValue = hasRecognizedSubscription
    ? planLabel(subPlan) || "PRO"
    : checkoutOpen
      ? planLabel(checkoutPlan) || "Pagamento iniciado"
      : "Sem assinatura";

  function planLabel(key: string) {
    const s = key.trim().toLowerCase();
    if (s === "pro_yearly") return "PRO Anual";
    if (s === "pro_monthly") return "PRO Mensal";
    return "";
  }

  function blockedFromLabel(raw: string) {
    const p = raw.trim().toLowerCase();
    if (!p) return "";
    if (p === "/dashboard") return "CMV Real";
    if (p === "/lista-de-compras") return "Lista de Compras";
    if (p === "/fichas-tecnicas") return "Fichas Técnicas";
    if (p === "/insumos") return "Insumos";
    if (p === "/pre-preparo") return "Pré-Preparo";
    if (p === "/fornecedores") return "Fornecedores";
    if (p === "/entradas") return "Entradas";
    if (p === "/inventario") return "Inventário";
    if (p === "/desperdicios") return "Desperdícios";
    if (p === "/suporte") return "Suporte";
    return raw;
  }

  const blockedFromText = blockedFromLabel(blockedFrom);
  const blockedOverlayText =
    blockedReasonParam === "billing_check_failed"
      ? "Não foi possível verificar sua assinatura no momento. Tente novamente em alguns instantes."
      : "Seu período gratuito terminou. Assine o Plano PRO para continuar utilizando todas as funções do CMV Fácil.";

  function formatDateBR(value: string) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Date(ms).toLocaleDateString("pt-BR");
  }

  function toFriendlyBillingError(raw: string) {
    const v = String(raw ?? "").trim();
    const s = v.toLowerCase();
    if (!s) return "Não foi possível carregar as informações de assinatura.";
    if (s.includes("company_not_found")) return "Não conseguimos localizar sua empresa vinculada à conta. Tente sair e entrar novamente.";
    if (s.includes("unauthorized") || s.includes("forbidden")) return "Sua sessão expirou. Faça login novamente.";
    if (s.includes("supabase_not_configured") || s.includes("server_not_configured")) return "O sistema não está configurado corretamente. Fale com o suporte.";
    if (s.includes("stripe") && s.includes("not") && s.includes("configured")) return "O pagamento ainda não está configurado. Fale com o suporte.";
    if (s.includes("failed to fetch") || s.includes("networkerror") || s.includes("fetch failed")) return "Instabilidade de conexão. Tente novamente em alguns instantes.";
    if (s.includes("missing_plan_key") || s.includes("invalid_plan_key")) return "Plano inválido. Atualize a página e tente novamente.";
    if (s.includes("subscription_blocked")) return "Você já possui uma assinatura ativa para esta empresa.";
    if (s.includes("checkout_in_progress")) return "Já existe um pagamento pendente. Continue o pagamento ou cancele para escolher outro plano.";
    if (s.includes("stripe_expire_failed")) return "Não foi possível cancelar o pagamento no momento. Tente novamente.";
    if (s.includes("billing_access_failed")) return "Não foi possível verificar sua assinatura no momento. Tente novamente.";
    if (s.includes("portal_failed")) return "Não foi possível abrir a área de pagamento agora. Tente novamente.";
    if (s.includes("checkout_failed")) return "Não foi possível abrir o Stripe Checkout agora. Tente novamente.";
    if (v.length <= 140) return `Ocorreu um erro ao carregar os planos: ${v}`;
    return "Ocorreu um erro ao carregar os planos. Tente novamente.";
  }

  function statusLabel(raw: string) {
    const s = raw.trim().toLowerCase();
    if (!s) return "—";
    if (s === "trial_internal") return "Teste";
    if (s === "trialing") return "Trial";
    if (s === "active") return "Ativa";
    if (s === "past_due") return "Pagamento pendente";
    if (s === "canceled" || s === "cancelled") return "Cancelada";
    if (s === "incomplete") return "Incompleta";
    if (s === "incomplete_expired") return "Expirada";
    if (s === "unpaid") return "Inadimplente";
    return raw;
  }

  async function openPortal() {
    if (billingWorking) return;
    setBillingWorking(true);
    setBillingAction("portal");
    setBillingError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok || !j?.url) throw new Error(String(j?.error ?? "portal_failed"));
      window.location.assign(String(j.url));
    } catch (err) {
      setBillingError(toFriendlyBillingError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBillingWorking(false);
      setBillingAction("");
    }
  }

  async function reloadBillingAccess() {
    setBillingLoading(true);
    setBillingError("");
    try {
      const res = await fetch("/api/billing/access", { method: "GET" });
      const j = (await res.json().catch(() => null)) as any;
      if (res.ok && j?.ok) {
        setBillingAccess(j.access ?? null);
        const status = String(j?.access?.subscription?.status ?? "").trim();
        setPlanStatus(status);
        const last4 = String(j?.access?.cardLast4 ?? "")
          .trim()
          .replace(/[^\d]/g, "");
        if (last4.length === 4) setCardLast4(last4);
        const plan = String(j?.access?.subscription?.plan ?? "").trim();
        if (plan === "pro_yearly") setPlanType("PRO Anual");
        else if (plan === "pro_monthly") setPlanType("PRO Mensal");
      }
    } catch {}
    setBillingLoading(false);
  }

  async function startCheckout(planKey: "pro_monthly" | "pro_yearly") {
    if (billingWorking) return;
    setBillingWorking(true);
    setBillingAction(planKey === "pro_monthly" ? "checkout_monthly" : "checkout_yearly");
    setBillingError("");
    try {
      // Sempre passe pelo backend. Ele confirma na Stripe se a sessão salva
      // ainda está aberta antes de devolver ou substituir a URL de checkout.
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_key: planKey, origin: "settings" }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok || !j?.url) throw new Error(String(j?.error ?? "checkout_failed"));
      window.location.assign(String(j.url));
    } catch (err) {
      setBillingError(toFriendlyBillingError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBillingWorking(false);
      setBillingAction("");
    }
  }

  async function cancelPendingCheckout() {
    if (billingWorking) return;
    setBillingWorking(true);
    setBillingAction("cancel_pending");
    setBillingError("");
    try {
      const res = await fetch("/api/billing/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "checkout_cancel" }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "billing_access_failed"));
      setBillingAccess(j.access ?? null);
      const status = String(j?.access?.subscription?.status ?? "").trim();
      setPlanStatus(status);
      const last4 = String(j?.access?.cardLast4 ?? "")
        .trim()
        .replace(/[^\d]/g, "");
      if (last4.length === 4) setCardLast4(last4);
      const plan = String(j?.access?.subscription?.plan ?? "").trim();
      if (plan === "pro_yearly") setPlanType("PRO Anual");
      else if (plan === "pro_monthly") setPlanType("PRO Mensal");
    } catch (err) {
      setBillingError(toFriendlyBillingError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBillingWorking(false);
      setBillingAction("");
    }
  }

  async function doLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearMeStore();
      window.location.href = "/login";
    }
  }

  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div className={styles.headerIcon} aria-hidden>
                <IconGearSmall />
              </div>
              <h1 className={styles.title}>Ajustes da Conta</h1>
            </div>

            <div className={styles.tabs}>
              <a
                className={tabClass("minha-conta")}
                href="/ajustes?tab=minha-conta"
                onClick={(e) => {
                  e.preventDefault();
                  goTab("minha-conta");
                }}
              >
                Minha Conta
              </a>
              <a
                className={tabClass("alterar-senha")}
                href="/ajustes?tab=alterar-senha"
                onClick={(e) => {
                  e.preventDefault();
                  goTab("alterar-senha");
                }}
              >
                Alterar Senha
              </a>
              <a
                className={tabClass("minha-empresa")}
                href="/ajustes?tab=minha-empresa"
                onClick={(e) => {
                  e.preventDefault();
                  goTab("minha-empresa");
                }}
              >
                Minha Empresa
              </a>
              <a
                className={tabClass("usuarios")}
                href="/ajustes?tab=usuarios"
                onClick={(e) => {
                  e.preventDefault();
                  goTab("usuarios");
                }}
              >
                Usuários
              </a>
              <a
                className={tabClass("planos")}
                href="/ajustes?tab=planos"
                onClick={(e) => {
                  e.preventDefault();
                  goTab("planos");
                }}
              >
                Planos
              </a>
            </div>

            <section className={styles.panel}>
              {tab === "minha-conta" ? (
                <div className={styles.panelInner}>
                  <div className={styles.avatarRow}>
                    <div className={styles.avatarBox}>
                      <span className={styles.avatarIcon} aria-hidden>
                        {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} /> : <IconUserPlaceholder />}
                      </span>
                    </div>
                  </div>

                  <div className={styles.sectionTitle}>Informações da Conta</div>
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span className={styles.label}>Nome</span>
                      <input className={styles.input} value={nome} onChange={(e) => setNome(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Sobrenome</span>
                      <input className={styles.input} value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Email</span>
                      <input className={styles.input} value={email} disabled />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>WhatsApp</span>
                      <div className={styles.phoneRow}>
                        <div className={styles.phonePrefix}>+55</div>
                        <input className={styles.input} inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(maskPhoneBR(e.target.value))} />
                      </div>
                    </label>

                    <label className={styles.field} style={{ gridColumn: "span 2" }}>
                      <span className={styles.label}>Nível de Permissão</span>
                      <select className={styles.select} value={permissao} onChange={(e) => setPermissao(e.target.value as any)}>
                        <option value="Administrador">Administrador</option>
                        <option value="Colaborador">Colaborador</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      disabled={!canSaveAccount || savingAccount}
                      onClick={async () => {
                        if (savingAccount) return;
                        setAccountSaveError("");
                        setSavingAccount(true);
                        try {
                          const res = await fetch("/api/me", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              nome,
                              sobrenome,
                              nomeCompleto: `${nome} ${sobrenome}`.replace(/\s+/g, " ").trim(),
                              whatsapp,
                              permissao,
                            }),
                          });
                          const j = (await res.json().catch(() => null)) as any;
                          if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "failed_to_save"));
                          await loadMeFromApi();
                        } catch (err) {
                          setAccountSaveError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setSavingAccount(false);
                        }
                      }}
                    >
                      {savingAccount ? "Salvando…" : "Salvar"}
                    </button>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      disabled={loggingOut}
                      onClick={async () => {
                        await doLogout();
                      }}
                    >
                      {loggingOut ? "Saindo…" : "Logout"}
                    </button>
                  </div>
                  {accountSaveError ? (
                    <div style={{ marginTop: 10, color: "#b42318", fontSize: 13, fontWeight: 700 }}>{accountSaveError}</div>
                  ) : null}
                </div>
              ) : null}

              {tab === "alterar-senha" ? (
                <div className={styles.panelInner}>
                  <div className={styles.sectionTitle}>Senha Atual</div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
                  </label>
                  <a className={styles.hintLink} href="/resetar-senha">
                    Esqueci a senha
                  </a>

                  <div className={styles.sectionTitle} style={{ marginTop: 16 }}>
                    Nova Senha
                  </div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
                  </label>

                  <div className={styles.sectionTitle} style={{ marginTop: 12 }}>
                    Repita Nova Senha
                  </div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={repitaSenha} onChange={(e) => setRepitaSenha(e.target.value)} />
                  </label>

                  <div className={styles.actions}>
                    <button type="button" className={styles.btnPrimary} disabled={!canSavePassword}>
                      Salvar
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === "minha-empresa" ? (
                <div className={styles.panelInner}>
                  <div className={styles.avatarRow}>
                    <div
                      className={styles.avatarBox}
                      style={{
                        borderRadius: 999,
                        background: companyLogoUrl ? "#ffffff" : "#eef2f7",
                        color: "#01040e",
                        overflow: "hidden",
                      }}
                    >
                      {companyLogoUrl ? (
                        <img src={companyLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <IconUserPlaceholder />
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        id="cmv-company-logo-input"
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          void uploadCompanyLogo(f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className={styles.btnGhost}
                        disabled={savingCompany}
                        onClick={() => {
                          const el = document.getElementById("cmv-company-logo-input") as HTMLInputElement | null;
                          el?.click();
                        }}
                      >
                        {savingCompany ? "Enviando…" : "Enviar imagem"}
                      </button>
                      <div className={styles.avatarHint}>Imagem da empresa (PNG/JPG/WebP)</div>
                    </div>
                  </div>

                  <div className={styles.sectionTitle}>Informações da Empresa</div>
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span className={styles.label}>Nome da Empresa</span>
                      <input className={styles.input} value={empresaNome} onChange={(e) => setEmpresaNome(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>CNPJ</span>
                      <input className={styles.input} inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(maskCnpj(e.target.value))} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Email Corporativo</span>
                      <input className={styles.input} value={emailCorp} onChange={(e) => setEmailCorp(e.target.value)} placeholder="Seu email corporativo" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>WhatsApp Empresa</span>
                      <div className={styles.phoneRow}>
                        <div className={styles.phonePrefix}>+55</div>
                        <input className={styles.input} inputMode="tel" value={empresaWhats} onChange={(e) => setEmpresaWhats(maskPhoneBR(e.target.value))} />
                      </div>
                    </label>
                    <label className={styles.field} style={{ gridColumn: "span 1" }}>
                      <span className={styles.label}>Ramo de Atividade</span>
                      <select className={styles.select} value={ramo} onChange={(e) => setRamo(e.target.value)}>
                        <option value="Hamburgueria">Hamburgueria</option>
                        <option value="Restaurante">Restaurante</option>
                        <option value="Bar">Bar</option>
                        <option value="Pizzaria">Pizzaria</option>
                        <option value="Sushi / Japonês">Sushi / Japonês</option>
                        <option value="Cafeteria">Cafeteria</option>
                        <option value="Padaria">Padaria</option>
                        <option value="Confeitaria">Confeitaria</option>
                        <option value="Açaíteria">Açaíteria</option>
                        <option value="Sorveteria">Sorveteria</option>
                        <option value="Churrascaria">Churrascaria</option>
                        <option value="Steakhouse">Steakhouse</option>
                        <option value="Lanchonete">Lanchonete</option>
                        <option value="Fast Food">Fast Food</option>
                        <option value="Food Truck">Food Truck</option>
                        <option value="Marmitex">Marmitex</option>
                        <option value="Delivery / Dark Kitchen">Delivery / Dark Kitchen</option>
                        <option value="Self-service">Self-service</option>
                        <option value="Buffet">Buffet</option>
                        <option value="Pastelaria">Pastelaria</option>
                        <option value="Casa de Sucos">Casa de Sucos</option>
                        <option value="Poke">Poke</option>
                        <option value="Culinária Italiana">Culinária Italiana</option>
                        <option value="Culinária Mexicana">Culinária Mexicana</option>
                        <option value="Culinária Árabe">Culinária Árabe</option>
                        <option value="Culinária Brasileira">Culinária Brasileira</option>
                        <option value="Culinária Asiática">Culinária Asiática</option>
                        <option value="Culinária Vegana">Culinária Vegana</option>
                        <option value="Culinária Fitness">Culinária Fitness</option>
                        <option value="Bistrô">Bistrô</option>
                        <option value="Cozinha Industrial">Cozinha Industrial</option>
                        <option value="Outros">Outros</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      disabled={!canSaveCompany || savingCompany}
                      onClick={async () => {
                        if (savingCompany) return;
                        setCompanySaveError("");
                        setSavingCompany(true);
                        try {
                          const res = await fetch("/api/me", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              companyName: empresaNome,
                              companyCnpj: cnpj,
                              companyEmail: emailCorp,
                              companyWhatsapp: empresaWhats,
                              companyIndustry: ramo,
                              companyLogoUrl,
                            }),
                          });
                          const j = (await res.json().catch(() => null)) as any;
                          if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "failed_to_save"));
                          await loadMeFromApi();
                        } catch (err) {
                          setCompanySaveError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setSavingCompany(false);
                        }
                      }}
                    >
                      {savingCompany ? "Salvando…" : "Salvar"}
                    </button>
                  </div>
                  {companySaveError ? (
                    <div style={{ marginTop: 10, color: "#b42318", fontSize: 13, fontWeight: 700 }}>{companySaveError}</div>
                  ) : null}
                </div>
              ) : null}

              {tab === "usuarios" ? (
                <div>
                  <div className={styles.actions} style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={() => {
                        setInviteError("");
                        setInviteLink("");
                        setInviteEmail("");
                        setInviteRole("Colaborador");
                        setInviteOpen(true);
                      }}
                    >
                      Cadastrar novo usuário
                    </button>
                  </div>

                  {inviteOpen ? (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#ffffff" }}>
                      <div style={{ fontWeight: 900, color: "#111827" }}>Novo usuário</div>
                      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10, maxWidth: 520 }}>
                        <label style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>
                          Email
                          <input
                            className={styles.input}
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="email@exemplo.com"
                            inputMode="email"
                            autoComplete="off"
                            style={{ marginTop: 6 }}
                          />
                        </label>
                        <label style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>
                          Permissão
                          <select className={styles.input} value={inviteRole} onChange={(e) => setInviteRole(e.target.value === "Administrador" ? "Administrador" : "Colaborador")} style={{ marginTop: 6 }}>
                            <option value="Colaborador">Colaborador</option>
                            <option value="Administrador">Administrador</option>
                          </select>
                        </label>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            disabled={inviteLoading || !inviteEmail.trim()}
                            onClick={async () => {
                              if (inviteLoading) return;
                              setInviteLoading(true);
                              setInviteError("");
                              setInviteLink("");
                              try {
                                const res = await fetch("/api/company-members/invite", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
                                });
                                const j = (await res.json().catch(() => null)) as any;
                                if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? "invite_failed"));
                                const link = String(j?.actionLink ?? "").trim();
                                setInviteLink(link);
                                if (j?.emailSent === false) {
                                  const raw = String(j?.emailError ?? "").trim();
                                  setInviteError(raw ? `Convite gerado, mas o email não foi enviado: ${raw}` : "Convite gerado, mas o email não foi enviado.");
                                }
                                await loadMeFromApi();
                              } catch (err) {
                                setInviteError(err instanceof Error ? err.message : String(err));
                              } finally {
                                setInviteLoading(false);
                              }
                            }}
                          >
                            {inviteLoading ? "Gerando link…" : "Gerar convite"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnGhost}
                            disabled={inviteLoading}
                            onClick={() => {
                              setInviteOpen(false);
                              setInviteError("");
                              setInviteLink("");
                            }}
                          >
                            Fechar
                          </button>
                        </div>
                        {inviteError ? <div style={{ color: "#b42318", fontSize: 13, fontWeight: 800 }}>{inviteError}</div> : null}
                        {inviteLink ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>Link do convite</div>
                            <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              <input className={styles.input} value={inviteLink} readOnly style={{ flex: "1 1 380px" }} />
                              <button
                                type="button"
                                className={styles.btnPrimary}
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(inviteLink);
                                  } catch {}
                                }}
                              >
                                Copiar
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.table}>
                    <div className={styles.trHead}>
                      <div>Membro</div>
                      <div>Data de Admissão</div>
                      <div>Permissão</div>
                      <div className={styles.actionsHeader}>Ações</div>
                    </div>
                    {members.map((m) => (
                      <div key={`${m.email}:${m.name}`} className={styles.tr}>
                        <div className={styles.memberCell}>
                          <div className={styles.memberAvatar} aria-hidden>
                            {m.avatarUrl ? (
                              <img src={m.avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                                <path d="M20 20c0-4-3.2-6-8-6s-8 2-8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            )}
                          </div>
                          <div className={styles.memberMeta}>
                            <div className={styles.memberName}>{m.name}</div>
                            <div className={styles.memberEmail}>{m.email}</div>
                          </div>
                        </div>
                        <div>{m.joinedAt || "—"}</div>
                        <div className={m.role === "Administrador" ? styles.badgeAdmin : styles.badgeCollab}>{m.role}</div>
                        <div className={styles.memberActions}>
                          {permissao === "Administrador" && m.role !== "Administrador" ? (
                            <button
                              type="button"
                              className={styles.memberDeleteButton}
                              aria-label={`Excluir usuário ${m.name}`}
                              title="Excluir usuário"
                              onClick={() => {
                                setMemberRemoveError("");
                                setMemberToRemove({ name: m.name, email: m.email });
                              }}
                            >
                              <IconTrashSmall />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {memberToRemove ? (
                    <div className={styles.memberRemoveOverlay} role="presentation">
                      <div className={styles.memberRemoveDialog} role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
                        <div className={styles.memberRemoveTitle} id="remove-member-title">Excluir usuário?</div>
                        <p className={styles.memberRemoveText}>
                          O usuário <strong>{memberToRemove.name}</strong> ({memberToRemove.email}) perderá o acesso a esta empresa. A conta de login não será apagada.
                        </p>
                        {memberRemoveError ? <div className={styles.memberRemoveError}>{memberRemoveError}</div> : null}
                        <div className={styles.memberRemoveButtons}>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            disabled={memberRemoveLoading}
                            onClick={async () => {
                              if (memberRemoveLoading) return;
                              setMemberRemoveLoading(true);
                              setMemberRemoveError("");
                              try {
                                const res = await fetch("/api/company-members", {
                                  method: "DELETE",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ email: memberToRemove.email }),
                                });
                                const result = (await res.json().catch(() => null)) as any;
                                if (!res.ok || !result?.ok) throw new Error(String(result?.error ?? "remove_member_failed"));
                                setMembers((current) => current.filter((member) => member.email.toLowerCase() !== memberToRemove.email.toLowerCase()));
                                setMemberToRemove(null);
                                await loadMeFromApi();
                              } catch (error) {
                                const code = error instanceof Error ? error.message : String(error);
                                const message =
                                  code === "cannot_remove_admin"
                                    ? "O usuário administrador não pode ser excluído."
                                    : code === "cannot_remove_self"
                                      ? "Você não pode excluir o próprio usuário."
                                      : code === "forbidden"
                                        ? "Somente administradores podem excluir usuários."
                                        : "Não foi possível excluir o usuário. Tente novamente.";
                                setMemberRemoveError(message);
                              } finally {
                                setMemberRemoveLoading(false);
                              }
                            }}
                          >
                            {memberRemoveLoading ? "Excluindo…" : "Excluir"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnGhost}
                            disabled={memberRemoveLoading}
                            onClick={() => {
                              setMemberToRemove(null);
                              setMemberRemoveError("");
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "planos" ? (
                <div className={styles.plansWrap}>
                  <div className={styles.plansTopRow}>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Plano</div>
                      <div className={styles.planMiniValue}>{planMiniValue}</div>
                      {hasRecognizedSubscription ? (
                        <button
                          type="button"
                          className={styles.planMiniLink}
                          disabled={billingLoading || billingWorking}
                          onClick={async () => openPortal()}
                        >
                          {billingWorking && billingAction === "portal" ? "Abrindo…" : "Gerenciar"}
                        </button>
                      ) : null}
                    </div>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Status</div>
                      <div className={styles.planMiniValue}>
                        {trialEndsAt && (accessReason === "trial_internal" || subStatus.toLowerCase() === "trialing")
                          ? "Período de teste ativo"
                          : subStatus
                            ? statusLabel(subStatus)
                            : "Sem assinatura"}
                      </div>
                      <div className={styles.planMiniMuted}>
                        {trialEndsAt && (accessReason === "trial_internal" || subStatus.toLowerCase() === "trialing")
                          ? `Até ${formatDateBR(trialEndsAt)}${typeof trialDays === "number" ? ` (${trialDays} dias restantes)` : ""}`
                          : periodEnd
                            ? `Renova em ${formatDateBR(periodEnd)}${cancelAtPeriodEnd ? " (cancelamento agendado)" : ""}`
                            : subStatus
                              ? "Status da assinatura"
                              : "Você ainda não possui assinatura"}
                      </div>
                    </div>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Cartão</div>
                      <div className={styles.planMiniValue}>{cardLast4 ? `**** **** **** ${cardLast4}` : "—"}</div>
                      {hasRecognizedSubscription ? (
                        <button
                          type="button"
                          className={styles.planMiniLink}
                          disabled={billingLoading || billingWorking}
                          onClick={async () => openPortal()}
                        >
                          {billingWorking && billingAction === "portal" ? "Abrindo…" : "Alterar"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {blockedParam && (blockedFromText || blockedReasonParam) ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #f5c542",
                        background: "#fffbeb",
                        color: "#7a5200",
                        fontSize: 13,
                        fontWeight: 800,
                      }}
                    >
                      {blockedFromText ? `A tela ${blockedFromText} está bloqueada porque seu plano não está ativo.` : "Algumas telas estão bloqueadas porque seu plano não está ativo."}
                      {blockedReasonParam === "billing_check_failed" ? " Não foi possível verificar sua assinatura agora." : ""}
                    </div>
                  ) : null}

                  {billingLoading ? (
                    <div className={styles.planMiniMuted} style={{ marginTop: 10 }}>
                      Carregando assinatura…
                    </div>
                  ) : null}
                  {billingError ? (
                    <div style={{ marginTop: 10, color: "#b42318", fontSize: 13, fontWeight: 700 }}>{toFriendlyBillingError(billingError)}</div>
                  ) : null}
                  {checkoutParam === "cancel" ? (
                    <div style={{ marginTop: 10, color: "#111827", fontSize: 13, fontWeight: 700 }}>
                      Pagamento cancelado. Seu período de avaliação continua ativo.
                    </div>
                  ) : null}
                  {checkoutParam === "success" && subStatus.trim().toLowerCase() === "active" ? (
                    <div style={{ marginTop: 10, color: "#111827", fontSize: 13, fontWeight: 700 }}>Plano PRO ativado com sucesso.</div>
                  ) : null}
                  {checkoutParam === "processing" || (checkoutParam === "success" && subStatus.trim().toLowerCase() !== "active") ? (
                    <div style={{ marginTop: 10, color: "#111827", fontSize: 13, fontWeight: 700 }}>
                      Seu pagamento foi recebido. Estamos ativando sua assinatura.
                      <div style={{ marginTop: 8 }}>
                        <button type="button" className={styles.planMiniLink} disabled={billingLoading || billingWorking} onClick={() => void reloadBillingAccess()}>
                          Verificar novamente
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.plansGrid}>
                    <div className={styles.planCard}>
                      <div className={styles.planHeader}>
                        <div className={styles.planName}>PRO Mensal</div>
                        <div className={styles.planPriceRow}>
                          <span className={styles.planPrice}>R$ 97,00</span>
                          <span className={styles.planPriceMeta}>/ pago mensalmente</span>
                        </div>
                        <div className={styles.planSeat}>Até 3 usuários inclusos</div>
                      </div>
                      <button
                        type="button"
                        className={styles.planSelectBtn}
                        disabled={billingLoading || billingWorking || (!checkoutMonthly && checkoutOpen) || (subPlan === "pro_monthly" && hasRecognizedSubscription)}
                        onClick={async () => {
                          if (checkoutMonthly) {
                            if (checkoutUrl) window.location.assign(checkoutUrl);
                          } else if (hasRecognizedSubscription) await openPortal();
                          else await startCheckout("pro_monthly");
                        }}
                      >
                        {billingWorking && billingAction === "checkout_monthly"
                          ? "Abrindo Checkout…"
                          : checkoutMonthly
                            ? "Continuar pagamento"
                            : subPlan === "pro_monthly" && hasRecognizedSubscription
                              ? subStatus.trim().toLowerCase() === "active" || subStatus.trim().toLowerCase() === "trialing" || (cancelAtPeriodEnd && periodActive)
                                ? "Cancelar plano"
                                : "Plano Atual"
                              : hasRecognizedSubscription
                                ? "Alterar no Portal"
                                : checkoutOpen
                                  ? "Escolher após cancelar"
                                  : "Assinar Mensal"}
                      </button>
                      {checkoutMonthly ? (
                        <div style={{ marginTop: 10, color: "#111827", fontSize: 13, fontWeight: 700 }}>
                          {planLabel(checkoutPlan) ? `Plano escolhido: ${planLabel(checkoutPlan)}` : "Pagamento iniciado."}
                          <div style={{ marginTop: 4 }}>Pagamento pendente.</div>
                          <button
                            type="button"
                            className={styles.planMiniLink}
                            disabled={billingLoading || billingWorking}
                            onClick={() => void cancelPendingCheckout()}
                            style={{ marginTop: 8, color: "#b42318" }}
                          >
                            {billingWorking && billingAction === "cancel_pending" ? "Cancelando…" : "Cancelar pagamento pendente"}
                          </button>
                        </div>
                      ) : checkoutOpen ? (
                        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 13, fontWeight: 700 }}>
                          Existe um pagamento pendente em outro plano. Cancele para escolher este.
                        </div>
                      ) : null}
                      <div className={styles.planFootnote}>Pagamento seguro processado pela Stripe.</div>
                      <ul className={styles.planList}>
                        <li>Cadastro ilimitado de itens</li>
                        <li>Cadastro ilimitado de fornecedores</li>
                        <li>Cadastro ilimitado de compras</li>
                        <li>Contagem ilimitada de inventário</li>
                        <li>Suporte via WhatsApp</li>
                      </ul>
                    </div>

                    <div className={styles.planCard}>
                      <div className={styles.planHeader}>
                        <div className={styles.planNameRow}>
                          <div className={styles.planName}>PRO Anual</div>
                          <span className={styles.planBadge}>25% OFF</span>
                        </div>
                        <div className={styles.planPriceRow}>
                          <span className={styles.planPrice}>R$ 873,00</span>
                          <span className={styles.planPriceMeta}>/ pago anualmente</span>
                        </div>
                        <div className={styles.planSavings}>Economize R$ 291 por ano</div>
                        <div className={styles.planSeat}>Até 3 usuários inclusos</div>
                      </div>
                      <button
                        type="button"
                        className={styles.planSelectBtn}
                        disabled={billingLoading || billingWorking || (!checkoutYearly && checkoutOpen) || (subPlan === "pro_yearly" && hasRecognizedSubscription)}
                        onClick={async () => {
                          if (checkoutYearly) {
                            if (checkoutUrl) window.location.assign(checkoutUrl);
                          } else if (hasRecognizedSubscription) await openPortal();
                          else await startCheckout("pro_yearly");
                        }}
                      >
                        {billingWorking && billingAction === "checkout_yearly"
                          ? "Abrindo Checkout…"
                          : checkoutYearly
                            ? "Continuar pagamento"
                            : subPlan === "pro_yearly" && hasRecognizedSubscription
                              ? subStatus.trim().toLowerCase() === "active" || subStatus.trim().toLowerCase() === "trialing" || (cancelAtPeriodEnd && periodActive)
                                ? "Cancelar plano"
                                : "Plano Atual"
                              : hasRecognizedSubscription
                                ? "Alterar no Portal"
                                : checkoutOpen
                                  ? "Escolher após cancelar"
                                  : "Assinar Anual"}
                      </button>
                      {checkoutYearly ? (
                        <div style={{ marginTop: 10, color: "#111827", fontSize: 13, fontWeight: 700 }}>
                          {planLabel(checkoutPlan) ? `Plano escolhido: ${planLabel(checkoutPlan)}` : "Pagamento iniciado."}
                          <div style={{ marginTop: 4 }}>Pagamento pendente.</div>
                          <button
                            type="button"
                            className={styles.planMiniLink}
                            disabled={billingLoading || billingWorking}
                            onClick={() => void cancelPendingCheckout()}
                            style={{ marginTop: 8, color: "#b42318" }}
                          >
                            {billingWorking && billingAction === "cancel_pending" ? "Cancelando…" : "Cancelar pagamento pendente"}
                          </button>
                        </div>
                      ) : checkoutOpen ? (
                        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 13, fontWeight: 700 }}>
                          Existe um pagamento pendente em outro plano. Cancele para escolher este.
                        </div>
                      ) : null}
                      <div className={styles.planFootnote}>Pagamento seguro processado pela Stripe.</div>
                      <ul className={styles.planList}>
                        <li>Cadastro ilimitado de itens</li>
                        <li>Cadastro ilimitado de fornecedores</li>
                        <li>Cadastro ilimitado de compras</li>
                        <li>Contagem ilimitada de inventário</li>
                        <li>Suporte via WhatsApp</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
      {showBlocked ? (
        <div className={styles.blockedOverlay}>
          <div className={styles.blockedCard}>
            <div className={styles.blockedTitle}>Assinatura necessária</div>
            {blockedFromText ? <div className={styles.blockedText}>A tela {blockedFromText} está bloqueada porque seu plano não está ativo.</div> : null}
            <div className={styles.blockedText}>
              {blockedOverlayText}
            </div>
            <div className={styles.blockedActions}>
              <button type="button" className={styles.btnPrimary} disabled={billingWorking} onClick={async () => startCheckout("pro_monthly")}>
                Assinar por R$ 97/mês
              </button>
              <button type="button" className={styles.btnGhost} disabled={billingWorking} onClick={async () => startCheckout("pro_yearly")}>
                Ver plano anual
              </button>
              <button type="button" className={styles.btnDanger} disabled={loggingOut} onClick={async () => doLogout()}>
                Sair
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
