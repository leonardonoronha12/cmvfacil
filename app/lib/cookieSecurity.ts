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

