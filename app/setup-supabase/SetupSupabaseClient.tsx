"use client";

import { useMemo, useState } from "react";

function Field({
  label,
  placeholder,
  value,
  onChange,
  mask,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  mask?: (v: string) => string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label className="cmv-label" style={{ marginTop: 0 }}>
        {label}
      </label>
      <input
        className="cmv-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      {mask ? (
        <div className="cmv-help">
          Pré-visualização: <span style={{ fontFamily: "var(--cmv-font-mono)" }}>{mask(value)}</span>
        </div>
      ) : null}
    </div>
  );
}

function maskKey(v: string) {
  const t = v.trim();
  if (t.length <= 12) return t ? `${t.slice(0, 3)}…` : "";
  return `${t.slice(0, 6)}…${t.slice(-6)}`;
}

export default function SetupSupabaseClient() {
  const [url, setUrl] = useState("");
  const [anon, setAnon] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const envText = useMemo(() => {
    const u = url.trim();
    const a = anon.trim();
    return [
      u ? `NEXT_PUBLIC_SUPABASE_URL=${u}` : `NEXT_PUBLIC_SUPABASE_URL=`,
      a ? `NEXT_PUBLIC_SUPABASE_ANON_KEY=${a}` : `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
      `NEXT_PUBLIC_SITE_URL=https://cmvfacil.app`,
    ].join("\n");
  }, [url, anon]);

  const tablesSql = useMemo(() => {
    return [
      "create or replace function public.cmvfacil_set_updated_at()",
      "returns trigger as $$",
      "begin",
      "  new.updated_at = now();",
      "  return new;",
      "end;",
      "$$ language plpgsql;",
      "",
      "create table if not exists public.fichas_tecnicas_state (",
      "  id text primary key,",
      "  payload jsonb not null default '[]'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.fichas_tecnicas_state;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.fichas_tecnicas_state",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.fichas_tecnicas_state enable row level security;",
      "",
      "drop policy if exists fichas_tecnicas_state_select_own on public.fichas_tecnicas_state;",
      "create policy fichas_tecnicas_state_select_own on public.fichas_tecnicas_state",
      "for select to authenticated",
      "using (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fichas_tecnicas_state_insert_own on public.fichas_tecnicas_state;",
      "create policy fichas_tecnicas_state_insert_own on public.fichas_tecnicas_state",
      "for insert to authenticated",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fichas_tecnicas_state_update_own on public.fichas_tecnicas_state;",
      "create policy fichas_tecnicas_state_update_own on public.fichas_tecnicas_state",
      "for update to authenticated",
      "using (id = ('user:' || auth.uid()::text))",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "create table if not exists public.fichas_tecnicas_etiquetas_state (",
      "  id text primary key,",
      "  payload jsonb not null default '[]'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.fichas_tecnicas_etiquetas_state;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.fichas_tecnicas_etiquetas_state",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.fichas_tecnicas_etiquetas_state enable row level security;",
      "",
      "drop policy if exists fichas_tecnicas_etiquetas_state_select_own on public.fichas_tecnicas_etiquetas_state;",
      "create policy fichas_tecnicas_etiquetas_state_select_own on public.fichas_tecnicas_etiquetas_state",
      "for select to authenticated",
      "using (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fichas_tecnicas_etiquetas_state_insert_own on public.fichas_tecnicas_etiquetas_state;",
      "create policy fichas_tecnicas_etiquetas_state_insert_own on public.fichas_tecnicas_etiquetas_state",
      "for insert to authenticated",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fichas_tecnicas_etiquetas_state_update_own on public.fichas_tecnicas_etiquetas_state;",
      "create policy fichas_tecnicas_etiquetas_state_update_own on public.fichas_tecnicas_etiquetas_state",
      "for update to authenticated",
      "using (id = ('user:' || auth.uid()::text))",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "create table if not exists public.insumos_templates_state (",
      "  id text primary key,",
      "  payload jsonb not null default '{}'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.insumos_templates_state;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.insumos_templates_state",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.insumos_templates_state enable row level security;",
      "",
      "drop policy if exists insumos_templates_state_select_own on public.insumos_templates_state;",
      "create policy insumos_templates_state_select_own on public.insumos_templates_state",
      "for select to authenticated",
      "using (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists insumos_templates_state_insert_own on public.insumos_templates_state;",
      "create policy insumos_templates_state_insert_own on public.insumos_templates_state",
      "for insert to authenticated",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists insumos_templates_state_update_own on public.insumos_templates_state;",
      "create policy insumos_templates_state_update_own on public.insumos_templates_state",
      "for update to authenticated",
      "using (id = ('user:' || auth.uid()::text))",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "create table if not exists public.insumos_state (",
      "  id text primary key,",
      "  payload jsonb not null default '{\"rows\":[],\"categories\":[]}'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.insumos_state;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.insumos_state",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.insumos_state enable row level security;",
      "",
      "drop policy if exists insumos_state_select_own on public.insumos_state;",
      "create policy insumos_state_select_own on public.insumos_state",
      "for select to authenticated",
      "using (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists insumos_state_insert_own on public.insumos_state;",
      "create policy insumos_state_insert_own on public.insumos_state",
      "for insert to authenticated",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists insumos_state_update_own on public.insumos_state;",
      "create policy insumos_state_update_own on public.insumos_state",
      "for update to authenticated",
      "using (id = ('user:' || auth.uid()::text))",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "create table if not exists public.insumos (",
      "  id text primary key,",
      "  item text not null,",
      "  medida text not null default 'Und',",
      "  custo_medio text not null default '',",
      "  categoria text not null default '',",
      "  especificacao text not null default '',",
      "  ocultar boolean not null default false,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.insumos;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.insumos",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.insumos enable row level security;",
      "",
      "drop policy if exists insumos_select_own on public.insumos;",
      "create policy insumos_select_own on public.insumos",
      "for select to authenticated",
      "using (id like ('user:' || auth.uid()::text || ':%'));",
      "",
      "drop policy if exists insumos_insert_own on public.insumos;",
      "create policy insumos_insert_own on public.insumos",
      "for insert to authenticated",
      "with check (id like ('user:' || auth.uid()::text || ':%'));",
      "",
      "drop policy if exists insumos_update_own on public.insumos;",
      "create policy insumos_update_own on public.insumos",
      "for update to authenticated",
      "using (id like ('user:' || auth.uid()::text || ':%'))",
      "with check (id like ('user:' || auth.uid()::text || ':%'));",
      "",
      "drop policy if exists insumos_delete_own on public.insumos;",
      "create policy insumos_delete_own on public.insumos",
      "for delete to authenticated",
      "using (id like ('user:' || auth.uid()::text || ':%'));",
      "",
      "create table if not exists public.ingredientes (",
      "  supabase_user_id uuid not null,",
      "  ingredient_id text not null,",
      "  item_bubble_id text not null default '',",
      "  quantidade numeric not null default 0,",
      "  custo numeric not null default 0,",
      "  ingrediente_temporario boolean not null default false,",
      "  bubble_user_id text not null default '',",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now(),",
      "  primary key (supabase_user_id, ingredient_id)",
      ");",
      "",
      "drop trigger if exists cmvfacil_set_updated_at on public.ingredientes;",
      "create trigger cmvfacil_set_updated_at",
      "before update on public.ingredientes",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.ingredientes enable row level security;",
      "",
      "drop policy if exists ingredientes_select_own on public.ingredientes;",
      "create policy ingredientes_select_own on public.ingredientes",
      "for select to authenticated",
      "using (supabase_user_id = auth.uid());",
      "",
      "drop policy if exists ingredientes_insert_own on public.ingredientes;",
      "create policy ingredientes_insert_own on public.ingredientes",
      "for insert to authenticated",
      "with check (supabase_user_id = auth.uid());",
      "",
      "drop policy if exists ingredientes_update_own on public.ingredientes;",
      "create policy ingredientes_update_own on public.ingredientes",
      "for update to authenticated",
      "using (supabase_user_id = auth.uid())",
      "with check (supabase_user_id = auth.uid());",
      "",
      "drop policy if exists ingredientes_delete_own on public.ingredientes;",
      "create policy ingredientes_delete_own on public.ingredientes",
      "for delete to authenticated",
      "using (supabase_user_id = auth.uid());",
      "",
      "create table if not exists public.fornecedores_state (",
      "  id text primary key,",
      "  info jsonb not null default '{}'::jsonb,",
      "  produtos jsonb not null default '{}'::jsonb,",
      "  equivalencias jsonb not null default '{}'::jsonb,",
      "  created_at timestamptz not null default now(),",
      "  updated_at timestamptz not null default now()",
      ");",
      "",
      "drop trigger if exists fornecedores_state_set_updated_at on public.fornecedores_state;",
      "create trigger fornecedores_state_set_updated_at",
      "before update on public.fornecedores_state",
      "for each row execute procedure public.cmvfacil_set_updated_at();",
      "",
      "alter table public.fornecedores_state enable row level security;",
      "",
      "drop policy if exists fornecedores_state_select_own on public.fornecedores_state;",
      "create policy fornecedores_state_select_own on public.fornecedores_state",
      "for select to authenticated",
      "using (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fornecedores_state_insert_own on public.fornecedores_state;",
      "create policy fornecedores_state_insert_own on public.fornecedores_state",
      "for insert to authenticated",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
      "drop policy if exists fornecedores_state_update_own on public.fornecedores_state;",
      "create policy fornecedores_state_update_own on public.fornecedores_state",
      "for update to authenticated",
      "using (id = ('user:' || auth.uid()::text))",
      "with check (id = ('user:' || auth.uid()::text));",
      "",
    ].join("\n");
  }, []);


  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 1200);
    } catch {
      setCopied(null);
    }
  }

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Conectar Login/Cadastro ao Supabase</h1>
          <div className="cmv-subtitle">Cole a URL e a anon key do Supabase e aplique no projeto.</div>
        </div>
      </header>

      <section className="cmv-grid" style={{ marginTop: 16 }}>
        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>1) Pegue no Supabase</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Supabase Dashboard → Project Settings → API
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <Field
              label="Project URL"
              placeholder="https://xxxxx.supabase.co"
              value={url}
              onChange={setUrl}
            />
            <Field
              label="anon public key"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anon}
              onChange={setAnon}
              mask={maskKey}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" className="cmv-button cmv-button-primary" onClick={() => void copy(envText, "env")}>
              {copied === "env" ? "Copiado" : "Copiar .env"}
            </button>
            <a
              className="cmv-button"
              href="https://supabase.com/dashboard/project/_/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              Abrir Supabase (API)
            </a>
          </div>

          <div className="cmv-help" style={{ marginTop: 12 }}>
            Cole o texto acima em uma env da Vercel e/ou no seu <span style={{ fontFamily: "var(--cmv-font-mono)" }}>.env.local</span>.
          </div>
        </div>

        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>2) Configure na Vercel</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Vercel → Project → Settings → Environment Variables
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div className="cmv-help">
              Adicione as variáveis em <b>Production</b>, <b>Preview</b> e <b>Development</b>.
            </div>
            <div className="cmv-help">
              Depois faça um redeploy para o build enxergar as envs.
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Env para colar</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--cmv-border)",
                background: "var(--cmv-surface-2)",
                fontFamily: "var(--cmv-font-mono)",
                fontSize: 12,
                lineHeight: "18px",
              }}
            >
              {envText}
            </pre>
            <button type="button" className="cmv-button" onClick={() => void copy(envText, "env2")}>
              {copied === "env2" ? "Copiado" : "Copiar novamente"}
            </button>
          </div>
        </div>

        <div className="cmv-card">
          <div style={{ fontWeight: 900 }}>3) Crie as tabelas no Supabase (SQL)</div>
          <div className="cmv-help" style={{ marginTop: 8 }}>
            Supabase Dashboard → SQL Editor → New query → Run
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>SQL para colar</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--cmv-border)",
                background: "var(--cmv-surface-2)",
                fontFamily: "var(--cmv-font-mono)",
                fontSize: 12,
                lineHeight: "18px",
              }}
            >
              {tablesSql}
            </pre>
            <button type="button" className="cmv-button cmv-button-primary" onClick={() => void copy(tablesSql, "sql")}>
              {copied === "sql" ? "Copiado" : "Copiar SQL"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
