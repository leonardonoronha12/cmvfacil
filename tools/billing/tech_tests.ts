import assert from "assert";
import { computeBillingAccess, getAllowedPriceId, planKeyFromPriceId } from "../../app/lib/billing.ts";
import { POST as checkoutPost } from "../../app/api/billing/checkout/route.ts";
import { POST as portalPost } from "../../app/api/billing/portal/route.ts";
import { GET as accessGet } from "../../app/api/billing/access/route.ts";
import { POST as webhookPost } from "../../app/api/stripe/webhook/route.ts";

function makeReq(opts: { jsonBody?: unknown; headers?: Record<string, string> } = {}) {
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k.toLowerCase(), v);
  return {
    headers: {
      get(name: string) {
        return headers.get(String(name).toLowerCase()) ?? null;
      },
    },
    cookies: {
      get() {
        return undefined;
      },
    },
    async json() {
      if (opts.jsonBody === undefined) throw new Error("no_json");
      return opts.jsonBody;
    },
    async text() {
      return "{}";
    },
  } as any;
}

async function run() {
  const priceMonthly = getAllowedPriceId("pro_monthly");
  const priceYearly = getAllowedPriceId("pro_yearly");
  assert.equal(planKeyFromPriceId(priceMonthly), "pro_monthly");
  assert.equal(planKeyFromPriceId(priceYearly), "pro_yearly");

  const trialActive = computeBillingAccess({
    id: "c1",
    fantasy_name: null,
    legal_name: null,
    cnpj: null,
    email: null,
    phone_e164: null,
    industry: null,
    logo_url: null,
    trial_started_at: new Date(Date.now() - 1000).toISOString(),
    trial_ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    subscription_status: null,
  });
  assert.equal(trialActive.allowed, true);
  assert.equal(trialActive.reason, "trial_internal");

  const trialExpired = computeBillingAccess({
    id: "c1",
    fantasy_name: null,
    legal_name: null,
    cnpj: null,
    email: null,
    phone_e164: null,
    industry: null,
    logo_url: null,
    trial_started_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    trial_ends_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    subscription_status: null,
  });
  assert.equal(trialExpired.allowed, false);
  assert.equal(trialExpired.reason, "expired");

  const active = computeBillingAccess({
    id: "c1",
    fantasy_name: null,
    legal_name: null,
    cnpj: null,
    email: null,
    phone_e164: null,
    industry: null,
    logo_url: null,
    subscription_status: "active",
    stripe_price_id: priceMonthly,
    current_period_end: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: false,
  });
  assert.equal(active.allowed, true);
  assert.equal(active.reason, "active");

  const canceling = computeBillingAccess({
    id: "c1",
    fantasy_name: null,
    legal_name: null,
    cnpj: null,
    email: null,
    phone_e164: null,
    industry: null,
    logo_url: null,
    subscription_status: "active",
    stripe_price_id: priceMonthly,
    current_period_end: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: true,
  });
  assert.equal(canceling.allowed, true);
  assert.equal(canceling.reason, "canceling");

  const canceledEnded = computeBillingAccess({
    id: "c1",
    fantasy_name: null,
    legal_name: null,
    cnpj: null,
    email: null,
    phone_e164: null,
    industry: null,
    logo_url: null,
    subscription_status: "canceled",
    stripe_price_id: priceMonthly,
    current_period_end: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: true,
  });
  assert.equal(canceledEnded.allowed, false);

  const invalidPlan = await checkoutPost(makeReq({ jsonBody: { plan_key: "basic" } }));
  assert.equal(invalidPlan.status, 400);

  const noSessionCheckout = await checkoutPost(makeReq({ jsonBody: { plan_key: "pro_monthly" } }));
  assert.equal(noSessionCheckout.status, 401);

  const noSessionPortal = await portalPost(makeReq({ jsonBody: {} }));
  assert.equal(noSessionPortal.status, 401);

  const noSessionAccess = await accessGet(makeReq());
  assert.equal(noSessionAccess.status, 401);

  const missingSig = await webhookPost(makeReq({ headers: {} }));
  assert.equal(missingSig.status, 400);

  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
  const invalidSig = await webhookPost(makeReq({ headers: { "stripe-signature": "t=1,v1=invalid" } }));
  assert.equal(invalidSig.status, 400);
}

run()
  .then(() => {
    process.stdout.write("ok\n");
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(String((err as any)?.stack ?? err) + "\n");
    process.exit(1);
  });
