/**
 * Print /allocation/report to PDF (requires Next server running).
 *
 * Env: CRON_SECRET (or ALLOC_REPORT_SECRET), PUBLIC_APP_URL (base, no trailing slash)
 * Optional: DIGEST_PDF_PATH (default ./allocation-report.pdf), DIGEST_REPORT_MODE (auto|schwab)
 */
import { chromium } from "playwright";

import { signAllocationReportToken } from "../src/lib/allocationReportToken";
import type { DataMode } from "../src/lib/dataMode";
import { getReportSigningSecret } from "../src/lib/internalCronAuth";

async function main() {
  const secret = getReportSigningSecret();
  if (!secret) {
    throw new Error("Set CRON_SECRET or ALLOC_REPORT_SECRET");
  }
  const base = (process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const modeRaw = (process.env.DIGEST_REPORT_MODE ?? "auto").toLowerCase();
  const mode: DataMode = modeRaw === "schwab" ? "schwab" : "auto";
  const token = await signAllocationReportToken(secret, 600, mode);
  const url = `${base}/allocation/report?token=${encodeURIComponent(token)}`;
  const out = process.env.DIGEST_PDF_PATH ?? "./allocation-report.pdf";

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.pdf({ path: out, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
  console.log("Wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
