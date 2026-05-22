/** Shared auth for cron/internal routes (matches x-digest refresh pattern). */
export function authorizeCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  try {
    const u = new URL(req.url);
    if (u.searchParams.get("secret") === secret) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function getReportSigningSecret(): string | null {
  const a = process.env.ALLOC_REPORT_SECRET?.trim();
  const b = process.env.CRON_SECRET?.trim();
  return a || b || null;
}
