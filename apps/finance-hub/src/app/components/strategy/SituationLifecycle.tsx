"use client";

import { formatUsd2 } from "@/lib/format";
import { posNegClass } from "@/lib/terminal/colors";
import { rolePhaseLabel, type SituationView } from "@/lib/situations/apiTypes";

export function SituationLifecycle({
  row,
  privacyMasked,
}: {
  row: SituationView;
  privacyMasked: boolean;
}) {
  const running: Array<{ date: string; net: number | null }> = [];
  let acc = 0;
  let any = false;
  for (const m of row.members) {
    if (m.netAmount != null && Number.isFinite(m.netAmount)) {
      acc += m.netAmount;
      any = true;
    }
    running.push({ date: m.tradeDate, net: any ? acc : null });
  }

  return (
    <div className="border-t border-zinc-100 px-3 py-3 dark:border-white/10">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          Lifecycle · {row.members.length} fill{row.members.length === 1 ? "" : "s"}
          {row.closedOn ? ` · closed ${row.closedOn}` : " · still open"}
        </span>
        <span className={row.netPremium == null ? "" : posNegClass(row.netPremium) || ""}>
          Net {row.netPremium == null ? "—" : formatUsd2(row.netPremium, { mask: privacyMasked })}
        </span>
      </div>
      <ol className="space-y-2">
        {row.members.map((m, i) => (
          <li key={`${m.transactionId}:${m.role}:${i}`} className="flex gap-3 text-xs">
            <div className="flex w-4 flex-col items-center">
              <span className="mt-1 h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
              {i < row.members.length - 1 ? <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-white/15" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">
                  {rolePhaseLabel(m.role)}
                  <span className="ml-2 font-mono font-normal text-zinc-500">{m.symbol ?? m.transactionId}</span>
                </span>
                <span className={m.netAmount == null ? "text-zinc-500" : posNegClass(m.netAmount) || ""}>
                  {m.netAmount == null ? "—" : formatUsd2(m.netAmount, { mask: privacyMasked })}
                </span>
              </div>
              <div className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                {m.tradeDate}
                {m.instruction ? ` · ${m.instruction}` : ""}
                {running[i]?.net != null
                  ? ` · cum ${formatUsd2(running[i]!.net, { mask: privacyMasked })}`
                  : ""}
                {m.description ? ` · ${m.description}` : ""}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
