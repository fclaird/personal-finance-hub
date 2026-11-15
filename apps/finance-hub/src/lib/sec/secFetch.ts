import { logError } from "@/lib/log";
import { curlDeadlineArgs, execFileWithTimeout } from "@/lib/net/upstream";

/** SEC fair-access: app name + contact (required). */
export const SEC_USER_AGENT = "FinanceHub admin@finance-hub.local";

export async function secFetchText(url: string, maxBuffer = 12 * 1024 * 1024): Promise<string | null> {
  try {
    const { stdout } = await execFileWithTimeout(
      "curl",
      ["-sS", "-L", ...curlDeadlineArgs(), "-H", `User-Agent: ${SEC_USER_AGENT}`, "-H", "Accept: application/json,text/html,*/*", url],
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
