import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

function getRequiredEnv(name: string) {
  const v = String(process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name}_not_set`);
  return v;
}

export function getStripe() {
  if (stripeSingleton) return stripeSingleton;
  const secretKey = getRequiredEnv("STRIPE_SECRET_KEY");
  stripeSingleton = new Stripe(secretKey);
  return stripeSingleton;
}

export function getAppUrl() {
  const v =
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim() ||
    "https://cmvfacil.vercel.app";
  return v.replace(/\/+$/, "");
}
