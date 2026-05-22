import { scheduleColdStartupDataPullOnce } from "@/lib/coldStartupDataPull";

/**
 * Node runtime only — loaded dynamically from instrumentation.ts so the Edge build
 * of instrumentation never analyzes Node-only transitive imports (better-sqlite3, fs, path).
 */
export function registerNodeInstrumentation(): void {
  scheduleColdStartupDataPullOnce();

  if (process.env.VERCEL === "1") return;

}
