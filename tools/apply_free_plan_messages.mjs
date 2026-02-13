import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const messages = [
  {
    event_type: "plan.free_pending",
    whatsapp_body:
      "Renan Capeletto: Não Desista do seu LUCRO!\n\nFinalize o cadastro no CMV Fácil e transforme estoque em dinheiro 👇\n\n- Acesse: `https://app.cmvfacil.com`\n- Escolha seu Plano\n- Inicie o Teste Grátis!",
  },
  {
    event_type: "plan.free_pending_2",
    whatsapp_body:
      "Será que preciso de um App só pra Controlar CMV? 🤔\n\nPensa comigo...\n\n1. Você tá faturando bem, mas quase não tem Lucro\n2. Cortar gastos é a solução mais rápida\n3. CMV é o maior gasto de todos!\n\nNosso sistema te entrega o CMV Real de forma automática e te ajuda a reduzir ele em tempo recorde!\n\nCMV Controlado = Lucro Recuperado\n\n- Conclua seu cadastro: `https://app.cmvfacil.com`",
  },
  {
    event_type: "plan.free_pending_3",
    whatsapp_body:
      "🍔 Como a Gold Burger LUCROU + R$ 40.000 usando o CMV Fácil...\n\nHamburgueria de sucesso, 3 lojas, faturando R$ 350 mil por mês...\n\nO problema? Igual ao seu:\n\n1. Fornecedor subindo preço\n2. Promoções agressivas pra não perder clientes\n3. Margem muito apertada\n\nCom o CMV Fácil, eles baixaram o CMV Real de 45% para 33%, ou seja, 12% de economia…\n\nR$ 350.000 x 12% = R$42.000,00 de LUCRO RECUPERADO!\n\nFaça o mesmo no seu Restaurante: `https://app.cmvfacil.com`",
  },
  {
    event_type: "plan.free_pending_4",
    whatsapp_body:
      "Ficou com Dúvida? 🙋‍♂️\n\nFale com o Renan, fundador do App e Dono de Restaurante há 6 anos…\n\nJá investi +100 mil em mentorias para aprender a fazer gestão…\n\nManda sua pergunta aqui, sou eu mesmo que respondo 👇",
  },
  {
    event_type: "plan.free_pending_5",
    whatsapp_body: "Essa é a última mensagem",
  },
];

function loadEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    value = value.replace(/\\r\\n/g, "").replace(/\\n/g, "").replace(/\\r/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const envLocal = resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadEnvFile(envLocal);

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const serviceRole = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE ??
  process.env.SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  ""
).trim();

if (url && serviceRole) {
  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("automation_messages").upsert(messages, { onConflict: "event_type" });
  if (error) {
    console.error("Failed to apply messages:", error.message);
    process.exit(1);
  }

  console.log(`Applied ${messages.length} messages to automation_messages.`);
} else {
  const baseUrl = (process.env.SUPABASE_FUNCTIONS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const adminSecret = (process.env.ADMIN_SECRET ?? "").trim();
  if (!baseUrl || !adminSecret) {
    console.error("Missing SUPABASE_FUNCTIONS_BASE_URL / ADMIN_SECRET in env.");
    process.exit(1);
  }

  for (const msg of messages) {
    const res = await fetch(`${baseUrl}/message-admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-admin-secret": adminSecret,
      },
      body: JSON.stringify({ event_type: msg.event_type, whatsapp_body: msg.whatsapp_body }),
    });
    const out = await res.json().catch(() => null);
    const ok = Boolean(res.ok && out && typeof out === "object" && out.ok);
    if (!ok) {
      const error = out && typeof out === "object" ? out.error : null;
      const details = out && typeof out === "object" ? out.details : null;
      console.error(`Failed to apply ${msg.event_type} (status ${res.status}).`);
      if (error) console.error(String(error));
      if (details) console.error(String(details));
      process.exit(1);
    }
  }

  console.log(`Applied ${messages.length} messages via message-admin.`);
}
