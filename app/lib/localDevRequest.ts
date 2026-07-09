export function isLocalDevRequest(req: Request) {
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  const hostname = host.split(":", 1)[0] ?? "";
  if (!hostname) return false;
  if (hostname.includes("localhost")) return true;
  if (hostname === "127.0.0.1" || hostname === "0.0.0.0") return true;
  if (hostname.endsWith(".local")) return true;

  const isPrivateIpv4 = (() => {
    const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    const d = Number(m[4]);
    const parts = [a, b, c, d];
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  })();

  if (isPrivateIpv4) return true;

  const isVercel = Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV);
  if (isVercel) return false;

  return false;
}
