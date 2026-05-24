/** Shared auth for cron/internal routes (Bearer or x-cron-secret header only). */
export function authorizeCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

export function getReportSigningSecret(): string | null {
  const a = process.env.ALLOC_REPORT_SECRET?.trim();
  const b = process.env.CRON_SECRET?.trim();
  return a || b || null;
}
