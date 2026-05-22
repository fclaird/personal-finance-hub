import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logError } from "@/lib/log";

const execFileAsync = promisify(execFile);

/** SEC fair-access: app name + contact (required). */
export const SEC_USER_AGENT = "FinanceHub admin@finance-hub.local";

export async function secFetchText(url: string, maxBuffer = 12 * 1024 * 1024): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-L", "-H", `User-Agent: ${SEC_USER_AGENT}`, "-H", "Accept: application/json,text/html,*/*", url],
      { maxBuffer },
    );
    const text = String(stdout ?? "").trim();
    if (!text || text.startsWith("<!DOCTYPE") || text.startsWith("<html")) return null;
    if (text.startsWith("<?xml") && /<Error>[\s\S]*<Code>/i.test(text)) return null;
    return text;
  } catch (e) {
    logError("sec_fetch_curl", e);
    return null;
  }
}
