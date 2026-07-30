"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./atualizacao.module.css";

type LiveType = {
  objectType?: string;
  status?: string;
  expected?: number;
  received?: number;
  savedStaging?: number;
  processed?: number;
};

type MigrationStatus = {
  status: "not_started" | "running" | "completed" | "failed" | "pending_review";
  lastError: string;
  totals: {
    received: number;
    savedStaging: number;
    processed: number;
    pendingReview: number;
    error: number;
  };
  validation: {
    status: string;
    report?: any;
  };
  perTypeLive: LiveType[];
};

type ScreenState = "loading" | "ready" | "updating" | "validating" | "complete" | "error";

const TYPE_LABELS: Record<string, string> = {
  user: "dados da sua conta",
  empresas: "dados da empresa",
  item: "insumos e fichas técnicas",
  categorias: "categorias",
  custo_medio_item: "histórico de custos",
  fornecedores: "fornecedores",
  itens_fornecedores: "itens dos fornecedores",
  inventarios: "inventários",
  itens_inventarios: "itens dos inventários",
  notas_fiscais: "entradas",
  itens_notas: "itens das entradas",
  desperdicio: "desperdícios",
  motivos_desperdicios: "motivos de desperdício",
  etiquetas: "etiquetas",
  ingredientes: "ingredientes e modos de preparo",
  itens_lista_compras: "listas de compras",
  qtd_compra_real: "quantidades compradas",
  faturamentos: "dados do CMV",
};

function baseType(value: unknown) {
  return String(value ?? "")
    .split("#", 1)[0]
    .split("@", 1)[0]
    .trim()
    .toLowerCase();
}

function stageLabel(value: unknown) {
  const type = baseType(value);
  return TYPE_LABELS[type] ?? "suas informações";
}

function safeStatus(raw: any): MigrationStatus {
  const migration = raw?.migration ?? {};
  const statusRaw = String(migration?.status ?? "not_started");
  const status: MigrationStatus["status"] =
    statusRaw === "running" ||
    statusRaw === "completed" ||
    statusRaw === "failed" ||
    statusRaw === "pending_review"
      ? statusRaw
      : "not_started";
  return {
    status,
    lastError: String(migration?.lastError ?? ""),
    totals: {
      received: Number(migration?.totals?.received ?? 0),
      savedStaging: Number(migration?.totals?.savedStaging ?? 0),
      processed: Number(migration?.totals?.processed ?? 0),
      pendingReview: Number(migration?.totals?.pendingReview ?? 0),
      error: Number(migration?.totals?.error ?? 0),
    },
    validation: {
      status: String(migration?.validation?.status ?? "not_started"),
      report: migration?.validation?.report ?? null,
    },
    perTypeLive: Array.isArray(migration?.perTypeLive) ? migration.perTypeLive : [],
  };
}

function friendlyError(raw: unknown) {
  const message = String(raw ?? "").toLowerCase();
  if (message.includes("bubble_user_not_found_for_email")) {
    return "Não encontramos no sistema anterior uma conta com o mesmo e-mail deste acesso.";
  }
  if (message.includes("missing_base_url") || message.includes("missing_token")) {
    return "A atualização ainda não foi liberada para esta conta. Fale com o suporte.";
  }
  if (message.includes("unauthorized") || message.includes("401")) {
    return "Sua sessão expirou. Entre novamente para continuar a atualização.";
  }
  if (message.includes("unable_to_scope_query")) {
    return "Não conseguimos separar seus dados com segurança. Nenhum acesso foi bloqueado.";
  }
  return "Não foi possível concluir a atualização agora. Nenhum dado foi perdido.";
}

export default function AtualizacaoClient() {
  const [migration, setMigration] = useState<MigrationStatus | null>(null);
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);

  const readStatus = useCallback(async () => {
    const response = await fetch(`/api/bubble-obj/migration/status?ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.error ?? "status_failed");
    const next = safeStatus(body);
    setMigration(next);
    return next;
  }, []);

  const validate = useCallback(async () => {
    setScreen("validating");
    const response = await fetch("/api/bubble-obj/migration/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.error ?? "validation_failed");
    const refreshed = await readStatus();
    if (String(refreshed.validation.status) !== "validated") {
      throw new Error("validation_divergent");
    }
    setScreen("complete");
  }, [readStatus]);

  const runUpdate = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelledRef.current = false;
    setStartedAt((current) => current ?? Date.now());
    setError("");
    setScreen("updating");
    try {
      for (let attempt = 0; attempt < 240 && !cancelledRef.current; attempt += 1) {
        const response = await fetch("/api/bubble-obj/migration/ensure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            callBudgetMs: 18000,
            maxTicks: 3,
            maxPages: 3,
            processLimit: 400,
            maxProcessTotal: 1200,
          }),
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.error ?? "update_failed");
        const next = await readStatus();
        if (next.status === "failed") throw new Error(next.lastError || "update_failed");
        if (next.status === "completed") {
          if (String(next.validation.status) === "validated") {
            setScreen("complete");
          } else {
            await validate();
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 450));
      }
      if (!cancelledRef.current) throw new Error("update_timeout");
    } catch (err) {
      if (!cancelledRef.current) {
        setError(friendlyError(err instanceof Error ? err.message : err));
        setScreen("error");
      }
    } finally {
      runningRef.current = false;
    }
  }, [readStatus, validate]);

  useEffect(() => {
    cancelledRef.current = false;
    void readStatus()
      .then((current) => {
        if (current.status === "completed" && current.validation.status === "validated") {
          setScreen("complete");
          return;
        }
        if (current.status === "running") {
          void runUpdate();
          return;
        }
        if (current.status === "completed") {
          void validate().catch((err) => {
            setError(friendlyError(err instanceof Error ? err.message : err));
            setScreen("error");
          });
          return;
        }
        setScreen(current.status === "failed" ? "error" : "ready");
      })
      .catch((err) => {
        setError(friendlyError(err instanceof Error ? err.message : err));
        setScreen("error");
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [readStatus, runUpdate, validate]);

  const progress = useMemo(() => {
    if (screen === "complete") return 100;
    if (screen === "validating") return 96;
    if (!migration?.perTypeLive.length) return screen === "updating" ? 7 : 0;
    const rows = migration.perTypeLive;
    let total = 0;
    let done = 0;
    for (const row of rows) {
      const expected = Math.max(1, Number(row.expected ?? 0), Number(row.received ?? 0));
      total += expected;
      if (String(row.status ?? "") === "done") {
        done += expected;
      } else {
        done += Math.min(expected, Math.max(Number(row.received ?? 0), Number(row.processed ?? 0)));
      }
    }
    if (!total) return 7;
    return Math.max(4, Math.min(92, Math.round((done / total) * 92)));
  }, [migration, screen]);

  const active = useMemo(() => {
    const rows = migration?.perTypeLive ?? [];
    return (
      rows.find((row) => ["running", "pending", "retrying"].includes(String(row.status ?? ""))) ??
      rows.find((row) => String(row.status ?? "") !== "done") ??
      null
    );
  }, [migration]);

  const elapsedLabel = useMemo(() => {
    if (!startedAt || (screen !== "updating" && screen !== "validating")) return "";
    const minutes = Math.max(1, Math.floor((Date.now() - startedAt) / 60000) + 1);
    return `${minutes} min`;
  }, [startedAt, screen, progress]);

  const processed = Math.max(Number(migration?.totals?.processed ?? 0), Number(migration?.totals?.savedStaging ?? 0));
  const received = Number(migration?.totals?.received ?? 0);
  const billingStatus = String(migration?.validation?.report?.billing?.status ?? "");
  const planLabel = billingStatus === "preserved" ? "Preservado" : billingStatus === "no_subscription" ? "Sem assinatura" : "Conferido";

  return (
    <main className={styles.page}>
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
      <section className={styles.card} aria-live="polite">
        <div className={styles.brand}>
          <img src="/brand/logo-preto.svg" alt="CMV Fácil" />
        </div>

        {screen === "loading" ? (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <h1>Preparando a atualização</h1>
            <p>Estamos verificando sua conta com segurança.</p>
          </div>
        ) : null}

        {screen === "ready" ? (
          <>
            <div className={styles.updateIcon}>
              <span>↓</span>
            </div>
            <div className={styles.versionBadge}>NOVA VERSÃO DISPONÍVEL</div>
            <h1>Atualização do CMV Fácil</h1>
            <p className={styles.lead}>
              Uma versão mais rápida, segura e completa está pronta. Seus dados, configurações e assinatura serão atualizados automaticamente.
            </p>
            <div className={styles.infoBox}>
              <strong>Seus dados serão conferidos no final.</strong>
              <span>O sistema anterior só será encerrado quando a atualização estiver 100% validada.</span>
            </div>
            <button className={styles.primaryButton} type="button" onClick={() => void runUpdate()}>
              Baixar e instalar atualização
            </button>
            <p className={styles.footnote}>Mantenha esta página aberta durante a atualização.</p>
          </>
        ) : null}

        {screen === "updating" || screen === "validating" ? (
          <>
            <div className={styles.appIcon}>
              <img src="/favicon.png" alt="" />
              <span className={styles.downloadPulse}>↓</span>
            </div>
            <h1>{screen === "validating" ? "Conferindo a atualização" : "Atualizando o CMV Fácil"}</h1>
            <p className={styles.lead}>
              {screen === "validating" ? "Estamos comparando seus dados com a versão anterior." : `Atualizando ${stageLabel(active?.objectType)}.`}
            </p>

            <div className={styles.progressHeader}>
              <span>{screen === "validating" ? "Verificação final" : "Baixando atualização"}</span>
              <strong>{progress}%</strong>
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.progressMeta}>
              <span>{received > 0 ? `${processed.toLocaleString("pt-BR")} de ${received.toLocaleString("pt-BR")} registros` : "Preparando registros"}</span>
              <span>{elapsedLabel ? `Tempo decorrido: ${elapsedLabel}` : "Calculando tempo…"}</span>
            </div>
            <div className={styles.safeBox}>
              <span className={styles.lock}>✓</span>
              <div>
                <strong>Seus dados estão protegidos</strong>
                <p>Não feche esta página. Se a conexão cair, a atualização continuará do ponto em que parou.</p>
              </div>
            </div>
          </>
        ) : null}

        {screen === "complete" ? (
          <>
            <div className={styles.successIcon}>✓</div>
            <div className={styles.versionBadge}>ATUALIZAÇÃO CONCLUÍDA</div>
            <h1>Tudo pronto!</h1>
            <p className={styles.lead}>Seus dados foram transferidos e conferidos. A nova versão do CMV Fácil já está disponível.</p>
            <div className={styles.summary}>
              <div>
                <strong>{processed.toLocaleString("pt-BR")}</strong>
                <span>registros atualizados</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>dados conferidos</span>
              </div>
              <div>
                <strong>{planLabel}</strong>
                <span>plano e assinatura</span>
              </div>
            </div>
            <button className={styles.primaryButton} type="button" onClick={() => window.location.replace("/dashboard")}>
              Abrir o novo CMV Fácil
            </button>
          </>
        ) : null}

        {screen === "error" ? (
          <>
            <div className={styles.errorIcon}>!</div>
            <h1>Não foi possível concluir</h1>
            <p className={styles.lead}>{error || friendlyError(migration?.lastError)}</p>
            <div className={styles.infoBox}>
              <strong>Nenhum dado foi perdido.</strong>
              <span>Seu acesso anterior permanece disponível enquanto corrigimos a atualização.</span>
            </div>
            <button className={styles.primaryButton} type="button" onClick={() => void runUpdate()}>
              Tentar atualização novamente
            </button>
            <a className={styles.supportLink} href="/suporte">
              Falar com o suporte
            </a>
          </>
        ) : null}
      </section>
    </main>
  );
}

