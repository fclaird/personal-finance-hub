import { getAllocationByAccount, getConsolidatedAllocation } from "@/lib/analytics/allocation";
import type { DataMode } from "@/lib/dataMode";

export type AllocationDigestBucket = {
  key: string;
  /** 0–1 */
  weight: number;
  marketValue: number;
};

export type AllocationDigestAccount = {
  accountId: string;
  accountName: string;
  /** Net-style total (includeSynthetic true). */
  totalMarketValue: number;
  /** Spot-style total (includeSynthetic false). */
  spotTotalMarketValue: number;
  net: { byAssetClass: AllocationDigestBucket[] };
  spot: { byAssetClass: AllocationDigestBucket[] };
};

export type AllocationDigestPayload = {
  ok: true;
  generatedAt: string;
  mode: DataMode;
  consolidated: {
    net: { totalMarketValue: number; byAssetClass: AllocationDigestBucket[] };
    spot: { totalMarketValue: number; byAssetClass: AllocationDigestBucket[] };
  };
  accounts: AllocationDigestAccount[];
};

const PCT0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function buildBuckets(includeSynthetic: boolean, mode: DataMode): { totalMarketValue: number; byAssetClass: AllocationDigestBucket[] } {
  const r = getConsolidatedAllocation(includeSynthetic, mode);
  return {
    totalMarketValue: r.totalMarketValue,
    byAssetClass: r.byAssetClass.map((x) => ({
      key: x.key,
      weight: x.weight,
      marketValue: x.marketValue,
    })),
  };
}

export function buildAllocationDigest(mode: DataMode = "auto"): AllocationDigestPayload {
  const net = buildBuckets(true, mode);
  const spot = buildBuckets(false, mode);

  const acctRows = getAllocationByAccount(true, mode);
  const acctRowsSpot = getAllocationByAccount(false, mode);
  const spotById = new Map(acctRowsSpot.map((a) => [a.accountId, a]));

  const accounts: AllocationDigestAccount[] = acctRows.map((a) => {
    const s = spotById.get(a.accountId);
    return {
      accountId: a.accountId,
      accountName: a.accountName,
      totalMarketValue: a.totalMarketValue,
      spotTotalMarketValue: s?.totalMarketValue ?? 0,
      net: {
        byAssetClass: a.byAssetClass.map((x) => ({
          key: x.key,
          weight: x.weight,
          marketValue: x.marketValue,
        })),
      },
      spot: {
        byAssetClass: (s?.byAssetClass ?? []).map((x) => ({
          key: x.key,
          weight: x.weight,
          marketValue: x.marketValue,
        })),
      },
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode,
    consolidated: { net, spot },
    accounts,
  };
}

/** SMS body: percentages only, no currency. Keep short for carrier limits. */
export function formatAllocationDigestSms(payload: AllocationDigestPayload, opts?: { reportUrl?: string; maxLen?: number }): string {
  const maxLen = opts?.maxLen ?? 1500;
  const parts: string[] = [];

  function summarize(label: string, buckets: AllocationDigestBucket[]) {
    const top = [...buckets].filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 6);
    const seg = top.map((b) => `${shortKey(b.key)} ${PCT0.format(b.weight * 100)}%`).join(" ");
    return `${label}: ${seg || "—"}`;
  }

  parts.push("Finance Hub status");
  parts.push(summarize("NET", payload.consolidated.net.byAssetClass));
  parts.push(summarize("SPOT", payload.consolidated.spot.byAssetClass));

  if (opts?.reportUrl) {
    parts.push(`Report: ${opts.reportUrl}`);
  }

  let body = parts.join(" | ");
  if (body.length > maxLen) body = body.slice(0, maxLen - 1) + "…";
  return body;
}

function shortKey(k: string) {
  const s = (k ?? "").trim();
  if (s.length <= 10) return s;
  return `${s.slice(0, 9)}…`;
}

export function formatAllocationDigestEmailHtml(payload: AllocationDigestPayload): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function table(title: string, buckets: AllocationDigestBucket[], total: number) {
    const rows = [...buckets]
      .filter((b) => b.marketValue !== 0 || b.weight > 0)
      .sort((a, b) => b.marketValue - a.marketValue)
      .map(
        (b) =>
          `<tr><td>${esc(b.key)}</td><td style="text-align:right">${b.marketValue.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td><td style="text-align:right">${(b.weight * 100).toFixed(2)}%</td></tr>`,
      )
      .join("");
    return `
      <h2 style="font-family:system-ui;font-size:16px">${esc(title)}</h2>
      <p style="font-family:system-ui;font-size:13px">Total: ${total.toLocaleString(undefined, { style: "currency", currency: "USD" })}</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:system-ui;font-size:13px">
        <thead><tr><th>Class</th><th>MV</th><th>Weight</th></tr></thead>
        <tbody>${rows || "<tr><td colspan='3'>No rows</td></tr>"}</tbody>
      </table>`;
  }

  let html = `<div style="font-family:system-ui">
    <p>Generated ${esc(payload.generatedAt)} (mode: ${esc(payload.mode)})</p>
    ${table("Consolidated — Net (incl. synthetic in equity)", payload.consolidated.net.byAssetClass, payload.consolidated.net.totalMarketValue)}
    ${table("Consolidated — Spot (excl. option MV)", payload.consolidated.spot.byAssetClass, payload.consolidated.spot.totalMarketValue)}
  `;

  for (const a of payload.accounts) {
    html += `<h2 style="font-size:15px;margin-top:1.5rem">${esc(a.accountName)}</h2>`;
    html += table("Net", a.net.byAssetClass, a.totalMarketValue);
    html += table("Spot", a.spot.byAssetClass, a.spotTotalMarketValue);
  }

  html += "</div>";
  return html;
}
