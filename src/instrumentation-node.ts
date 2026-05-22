import { scheduleColdStartupDataPullOnce } from "@/lib/coldStartupDataPull";

/**
 * Node runtime only — loaded dynamically from instrumentation.ts so the Edge build
 * of instrumentation never analyzes Node-only transitive imports (better-sqlite3, fs, path).
 */
export function registerNodeInstrumentation(): void {
  scheduleColdStartupDataPullOnce();

  if (process.env.VERCEL === "1") return;

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;

  const port = process.env.PORT ?? "3000";
  const base = (process.env.INTERNAL_APP_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  const url = `${base}/api/internal/dividend-models/roll`;

  async function tick() {
    try {
      await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
    } catch {
      /* non-fatal */
    }
  }

  const SIX_H_MS = 6 * 60 * 60 * 1000;
  setTimeout(() => void tick(), 45_000);
  setInterval(() => void tick(), SIX_H_MS);
}
