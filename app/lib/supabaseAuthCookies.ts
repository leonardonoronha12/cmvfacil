export const SUPABASE_AT_COOKIE = "cmv_at";
export const SUPABASE_RT_COOKIE = "cmv_rt";

export function parseJwtExpMs(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payloadB64 = parts[1] ?? "";
  if (!payloadB64) return null;

  const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  try {
    const json = atob(padded);
    const obj = JSON.parse(json) as { exp?: number };
    const expSec = typeof obj.exp === "number" ? obj.exp : 0;
    if (!expSec) return null;
    return expSec * 1000;
  } catch {
    return null;
  }
}
