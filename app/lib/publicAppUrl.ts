import "server-only";

function normalizeUrl(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

function isLocalhostHost(host: string) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost") return true;
  if (h.startsWith("localhost:")) return true;
  if (h === "127.0.0.1") return true;
  if (h.startsWith("127.0.0.1:")) return true;
  return false;
}

function sanitizeCandidate(candidate: string) {
  const s = normalizeUrl(candidate);
  if (!s) return "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }

  if (process.env.NODE_ENV === "production") {
    if (u.protocol !== "https:") return "";
    if (isLocalhostHost(u.host)) return "";
  } else {
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  }

  return u.toString().replace(/\/+$/, "");
}

export function getPublicAppUrl() {
  const fallback = "https://cmvfacil.app";
  const fromEnv = sanitizeCandidate(process.env.NEXT_PUBLIC_APP_URL ?? "");

  if (process.env.NODE_ENV === "production") return fromEnv || fallback;

  return fromEnv || fallback;
}
