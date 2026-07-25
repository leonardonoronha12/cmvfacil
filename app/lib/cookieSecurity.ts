export function shouldUseSecureCookies(req: Request) {
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
  if (isLocalhost) return false;

  const xf = String(req.headers.get("x-forwarded-proto") ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (xf) return xf === "https";

  try {
    const url = new URL(req.url);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getAuthCookieDomain(req: Request) {
  const xfHost = String(req.headers.get("x-forwarded-host") ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const host = xfHost || String(req.headers.get("host") ?? "").trim().toLowerCase();
  const cleanHost = host.split(":")[0] ?? host;
  const isLocalhost = cleanHost.includes("localhost") || cleanHost.includes("127.0.0.1");
  if (isLocalhost) return null;
  if (cleanHost.endsWith("cmvfacil.app")) return ".cmvfacil.app";
  return null;
}
