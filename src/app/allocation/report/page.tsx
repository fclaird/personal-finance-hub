import type { Metadata } from "next";

import type { AllocationDigestPayload } from "@/lib/allocationDigest";
import { buildAllocationDigest } from "@/lib/allocationDigest";
import { verifyAllocationReportToken } from "@/lib/allocationReportToken";
import { formatUsd2 } from "@/lib/format";
import { formatDisplayDateTime } from "@/lib/formatDate";
import { getReportSigningSecret } from "@/lib/internalCronAuth";

export const metadata: Metadata = {
  title: "Allocation report",
  robots: { index: false, follow: false },
};

function BarBlock({ title, buckets }: { title: string; buckets: Array<{ key: string; weight: number }> }) {
  const sorted = [...buckets].filter((b) => b.weight > 0).sort((a, b) => b.weight - a.weight);
  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      <div className="mt-3 space-y-2">
        {sorted.length === 0 ? <p className="text-zinc-500">No slices.</p> : null}
        {sorted.map((b) => (
          <div key={b.key}>
            <div className="flex justify-between text-xs text-zinc-700">
              <span>{b.key}</span>
              <span className="tabular-nums">{(b.weight * 100).toFixed(2)}%</span>
            </div>
            <div className="mt-0.5 h-2 w-full overflow-hidden rounded bg-zinc-200">
              <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, b.weight * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableBlock({
  title,
  totalMarketValue,
  buckets,
}: {
  title: string;
  totalMarketValue: number;
  buckets: Array<{ key: string; marketValue: number; weight: number }>;
}) {
  const rows = [...buckets].sort((a, b) => b.marketValue - a.marketValue);
  return (
    <div className="mt-4">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 text-xs text-zinc-600">Total: {formatUsd2(totalMarketValue, { mask: false })}</p>
      <table className="mt-2 w-full border-collapse border border-zinc-200 text-xs">
        <thead>
          <tr className="bg-zinc-50">
            <th className="border border-zinc-200 px-2 py-1 text-left">Class</th>
            <th className="border border-zinc-200 px-2 py-1 text-right">MV</th>
            <th className="border border-zinc-200 px-2 py-1 text-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="border border-zinc-200 px-2 py-1">{r.key}</td>
              <td className="border border-zinc-200 px-2 py-1 text-right tabular-nums">
                {formatUsd2(r.marketValue, { mask: false })}
              </td>
              <td className="border border-zinc-200 px-2 py-1 text-right tabular-nums">
                {(r.weight * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportBody({ payload }: { payload: AllocationDigestPayload }) {
  return (
    <div className="min-h-screen bg-white px-4 py-6 text-zinc-900 print:px-3 print:py-4">
      <header className="border-b border-zinc-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Allocation report</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {formatDisplayDateTime(payload.generatedAt)} · data mode <span className="font-mono">{payload.mode}</span>
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Consolidated net includes synthetic option exposure in equities; spot excludes option market value.
        </p>
      </header>

      <section className="mt-6 print:break-inside-avoid">
        <h2 className="text-lg font-semibold">Consolidated</h2>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <BarBlock title="Net weights" buckets={payload.consolidated.net.byAssetClass} />
          <BarBlock title="Spot weights" buckets={payload.consolidated.spot.byAssetClass} />
        </div>
        <TableBlock
          title="Net — detail"
          totalMarketValue={payload.consolidated.net.totalMarketValue}
          buckets={payload.consolidated.net.byAssetClass}
        />
        <TableBlock
          title="Spot — detail"
          totalMarketValue={payload.consolidated.spot.totalMarketValue}
          buckets={payload.consolidated.spot.byAssetClass}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">By account</h2>
        {payload.accounts.map((a) => (
          <div key={a.accountId} className="mt-6 border-t border-zinc-200 pt-6 print:break-inside-avoid">
            <h3 className="text-base font-semibold">{a.accountName}</h3>
            <p className="text-xs text-zinc-600">
              Net total: {formatUsd2(a.totalMarketValue, { mask: false })} · Spot total:{" "}
              {formatUsd2(a.spotTotalMarketValue, { mask: false })}
            </p>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <BarBlock title="Net weights" buckets={a.net.byAssetClass} />
              <BarBlock title="Spot weights" buckets={a.spot.byAssetClass} />
            </div>
            <TableBlock title="Net — detail" totalMarketValue={a.totalMarketValue} buckets={a.net.byAssetClass} />
            <TableBlock title="Spot — detail" totalMarketValue={a.spotTotalMarketValue} buckets={a.spot.byAssetClass} />
          </div>
        ))}
      </section>
    </div>
  );
}

export default async function AllocationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? "").trim();
  const secret = getReportSigningSecret();

  if (!secret) {
    return (
      <div className="min-h-screen bg-white p-8 text-red-700">
        Server is not configured for signed reports (set CRON_SECRET or ALLOC_REPORT_SECRET).
      </div>
    );
  }

  if (!token) {
    return <div className="min-h-screen bg-white p-8 text-zinc-700">Open this page using a link from your digest (token required).</div>;
  }

  const verified = await verifyAllocationReportToken(token, secret);
  if (!verified.ok) {
    return <div className="min-h-screen bg-white p-8 text-red-700">Invalid or expired link.</div>;
  }

  const payload = buildAllocationDigest(verified.dataMode);
  return <ReportBody payload={payload} />;
}
