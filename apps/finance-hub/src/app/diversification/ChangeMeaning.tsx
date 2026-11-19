import { explainMeasuredChange, type FundingContext } from "@/lib/fortress/explainChange";
import type { ReturnReport } from "@/lib/fortress/returns";

const body = "text-sm leading-6 text-zinc-900 dark:text-zinc-100";
const muted = "text-xs leading-5 text-zinc-700 dark:text-zinc-300";

export function ChangeMeaning({ report, funding, scopeLabel }: { report: ReturnReport | null; funding: FundingContext | null; scopeLabel: string }) {
  const explained = explainMeasuredChange({ report, funding, scopeLabel });
  return (
    <section className="mt-4 rounded-lg border border-zinc-400 bg-white p-3 dark:border-zinc-400 dark:bg-zinc-950" data-change-meaning="" data-sigma-direction={explained.sigmaDirection} data-change-limited={explained.limited ? "yes" : "no"}>
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">What this change means</h3>
      {explained.definitions.map((line) => (
        <p key={line.slice(0, 24)} className={`mt-2 ${body}`}>{line}</p>
      ))}
      <p className={`mt-3 font-semibold ${body}`}>{explained.lead}</p>
      {explained.sentences.map((line) => (
        <p key={line.slice(0, 48)} className={`mt-2 ${body}`}>{line}</p>
      ))}
      {explained.rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm text-zinc-900 dark:text-zinc-100">
            <caption className={`mb-1 text-left ${muted}`}>Before, after, and the change. The change is after minus before. Daily sigma is not annualized.</caption>
            <thead className="text-zinc-800 dark:text-zinc-200">
              <tr>
                <th className="py-1 pr-3">Measure</th>
                <th className="py-1 pr-3">Before</th>
                <th className="py-1 pr-3">After</th>
                <th className="py-1">Change</th>
              </tr>
            </thead>
            <tbody>
              {explained.rows.map((row) => (
                <tr key={row.label} className="border-t border-zinc-400" data-change-row={row.label}>
                  <th className="py-1 pr-3 font-medium" scope="row">{row.label}</th>
                  <td className="py-1 pr-3 tabular-nums">{row.before}</td>
                  <td className="py-1 pr-3 tabular-nums">{row.after}</td>
                  <td className="py-1 tabular-nums">{row.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <details className="mt-3">
        <summary className={`cursor-pointer rounded px-1 ${muted} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100`}>
          How these numbers are calculated
        </summary>
        <ul className={`mt-2 list-disc space-y-2 pl-5 ${body}`}>
          {explained.formulas.map((line) => (
            <li key={line.slice(0, 32)}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
