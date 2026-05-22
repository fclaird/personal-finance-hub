#!/usr/bin/env node
import fs from "node:fs";

const path = "src/app/dividend-models/page.tsx";
let s = fs.readFileSync(path, "utf8");

s = s.replace(/import \{\n  Bar,\n  CartesianGrid,/, `import {\n  Area,\n  CartesianGrid,`);
s = s.replace(
  /const DM_CHART_DIV = distinctColorForIndex\(11\);/,
  `const DM_CHART_DIV_LIFT = distinctColorForIndex(11);`,
);

if (!s.includes("category: string;")) {
  s = s.replace(
    /  sector: string \| null;\n  avgUnitCost: number \| null;\n\};\n\ntype TableFooter/,
    `  sector: string | null;
  industry: string | null;
  avgUnitCost: number | null;
  category: string;
  cost: number | null;
};

type TableFooter`,
  );
}

s = s.replace(
  /type ModeledPoint = \{\n  month_end: string;\n  portfolio_rebased_pct/,
  `type ModeledPoint = {
  month_end: string;
  price_only_rebased_pct: number | null;
  portfolio_rebased_pct`,
);

s = s.replace(
  /type SortCol = "symbol" \| "name" \| "annual\$" \| "mv" \| "yield" \| "shares";/,
  `type SortCol = "symbol" | "name" | "category" | "cost" | "annual$" | "mv" | "yield" | "shares";`,
);

s = s.replace(
  /useState<"overview" \| "holdings" \| "positions">\("overview"\);/,
  `useState<"overview" | "holdings">("overview");
  const [totalDividendsReceived, setTotalDividendsReceived] = useState<number | null>(null);`,
);

s = s.replace(
  /        lastMonthEnd\?: string \| null;\n        error\?: string;\n      };\n      if \(!json\.ok\) throw new Error\(json\.error \?\? "Failed to load modeled timeline"\);\n      setModeled\(json\.points \?\? \[\]\);/,
  `        lastMonthEnd?: string | null;
        totalDividendsReceived?: number;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to load modeled timeline");
      setModeled(json.points ?? []);
      setTotalDividendsReceived(
        typeof json.totalDividendsReceived === "number" && Number.isFinite(json.totalDividendsReceived)
          ? json.totalDividendsReceived
          : null,
      );`,
);

s = s.replace(
  /      setModeledFootnote\(null\);\n    }\);\n    return \(\) => cancelAnimationFrame\(id\);\n  }, \[activeId\]\);/,
  `      setModeledFootnote(null);
      setTotalDividendsReceived(null);
    });
    return () => cancelAnimationFrame(id);
  }, [activeId]);`,
);

if (!s.includes('if (sortCol === "category")')) {
  s = s.replace(
    /        return c !== 0 \? c \* dir : a\.symbol\.localeCompare\(b\.symbol\) \* dir;\n      }\n      if \(sortCol === "mv"\)/,
    `        return c !== 0 ? c * dir : a.symbol.localeCompare(b.symbol) * dir;
      }
      if (sortCol === "category") {
        const c = a.category.localeCompare(b.category);
        return c !== 0 ? c * dir : a.symbol.localeCompare(b.symbol) * dir;
      }
      if (sortCol === "cost") {
        const av = a.cost ?? -1;
        const bv = b.cost ?? -1;
        return (av - bv) * dir;
      }
      if (sortCol === "mv")`,
  );
}

const newChartBlock = `  const modeledChart = useMemo(() => {
    const raw = modeled.map((p) => ({
      monthEnd: p.month_end.slice(0, 10),
      port: p.portfolio_rebased_pct != null && Number.isFinite(p.portfolio_rebased_pct) ? p.portfolio_rebased_pct : 0,
      priceOnly:
        p.price_only_rebased_pct != null && Number.isFinite(p.price_only_rebased_pct) ? p.price_only_rebased_pct : 0,
      spy: p.spy_rebased_pct != null && Number.isFinite(p.spy_rebased_pct) ? p.spy_rebased_pct : undefined,
      qqq: p.qqq_rebased_pct != null && Number.isFinite(p.qqq_rebased_pct) ? p.qqq_rebased_pct : undefined,
    }));
    if (raw.length === 0) return [];
    const port0 = raw[0]!.port;
    const price0 = raw[0]!.priceOnly;
    const spy0 = raw[0]!.spy ?? 0;
    const qqq0 = raw[0]!.qqq ?? 0;
    return raw.map((p) => {
      const port = p.port - port0;
      const priceOnly = p.priceOnly - price0;
      const dividendLift = Math.max(0, port - priceOnly);
      return {
        monthEnd: p.monthEnd,
        port,
        priceOnly,
        dividendLift,
        spy: p.spy != null ? p.spy - spy0 : undefined,
        qqq: p.qqq != null ? p.qqq - qqq0 : undefined,
      };
    });
  }, [modeled]);

  const modeledChartEmpty = modeledChart.length === 0;

`;

s = s.replace(
  /  const modeledChart = useMemo\([\s\S]*?  const liveChartEmpty = liveChart\.length === 0;\n\n/,
  newChartBlock,
);

s = s.replaceAll("Simulated Dividend Portfolio", "Sim Dividend Portfolio");

s = s.replace(
  `                <div className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">`,
  `                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">`,
);

s = s.replace(
  /\n                  <button\n                    type="button"\n                    onClick=\{\(\) => setWorkspaceTab\("positions"\)\}[\s\S]*?Every position\n                  <\/button>/,
  "",
);

// Remove positions table branch: ) : workspaceTab === "holdings" ? ( ... ) : ( positions ... )
const holdingsMarker = ') : workspaceTab === "holdings" ? (';
const hIdx = s.indexOf(holdingsMarker);
if (hIdx < 0) throw new Error("holdings marker missing");
const elseIdx = s.indexOf("\n                ) : (\n                  <>", hIdx);
if (elseIdx < 0) throw new Error("positions else missing");
const closeIdx = s.indexOf("\n                )}\n              </>\n            )}", elseIdx);
if (closeIdx < 0) throw new Error("tab close missing");
// Change ternary to: overview ? ... : (holdings only)
s =
  s.slice(0, hIdx) +
  " ) : (\n" +
  s.slice(hIdx + holdingsMarker.length, elseIdx) +
  s.slice(closeIdx);

// Patch holdings table headers + rows - replace old thead through tbody start
const holdingsTableOld = `<table className="w-full min-w-[860px] border-collapse text-[15px]">
                          <thead>
                            <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                              <th className="py-3 pr-3">
                                <SortTh
                                  col="symbol"
                                  label="Symbol"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                  align="left"
                                />
                              </th>
                              <th className="py-2.5 pr-3">
                                <SortTh
                                  col="name"
                                  label="Name"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                  align="left"
                                />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh
                                  col="annual$"
                                  label="Est. annual div"
                                  sortCol={sortCol}
                                  sortAsc={sortAsc}
                                  onToggle={toggleSort}
                                />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="yield" label="Yield %" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="shares" label="Shares" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="mv" label="Market value" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-3 pr-3 text-right"> </th>
                            </tr>
                          </thead>`;

const holdingsTableNew = fs.readFileSync("scripts/holdings-table-head.txt", "utf8");
if (s.includes(holdingsTableOld)) {
  s = s.replace(holdingsTableOld, holdingsTableNew);
} else {
  console.error("warn: holdings thead pattern not found");
}

// Replace row cells - after name add category, reorder columns
const rowOld = `                                <td className="max-w-[16rem] truncate py-2.5 pr-3 text-sm text-zinc-600 dark:text-zinc-400" title={r.displayName ?? undefined}>
                                  {r.displayName ?? "—"}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(positionAnnualDiv(r), privacy.masked)}</td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(rowYieldPct(r))}</td>
                                <td className="py-2.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    className="h-8 w-24 cursor-text rounded border border-zinc-300 bg-white px-1 text-right tabular-nums dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                                    defaultValue={r.shares ?? ""}
                                    key={\`\${r.holdingId}-\${r.shares ?? "null"}\`}
                                    onBlur={(e) => {
                                      const raw = e.target.value.trim();
                                      const shares = raw === "" ? null : Number(raw);
                                      if (shares != null && !Number.isFinite(shares)) return;
                                      if (shares === r.shares || (shares == null && r.shares == null)) return;
                                      void (async () => {
                                        try {
                                          await fetch(
                                            \`/api/dividend-models/portfolios/\${encodeURIComponent(activeId!)}/holdings\`,
                                            {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ symbol: r.symbol, shares }),
                                            },
                                          );
                                          await Promise.all([loadTable(activeId!), loadDashboard(activeId!)]);
                                        } catch {
                                          /* ignore */
                                        }
                                      })();
                                    }}
                                  />
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(r.marketValue, privacy.masked)}</td>`;

const rowNew = fs.readFileSync("scripts/holdings-table-row-cells.txt", "utf8");
if (s.includes(rowOld)) {
  s = s.replace(rowOld, rowNew);
} else {
  console.error("warn: holdings row pattern not found");
}

// Footer
const footOld = `                              <td className="py-2.5 pr-3">Totals</td>
                              <td className="py-2.5 pr-3">—</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalAnnualDiv, privacy.masked)}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(tableFooter.portfolioYieldPct)}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">
                                {Number.isFinite(tableFooter.totalShares)
                                  ? tableFooter.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                  : "—"}
                              </td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalMv, privacy.masked)}</td>
                              <td className="py-2" />`;

const footNew = fs.readFileSync("scripts/holdings-table-foot.txt", "utf8");
if (s.includes(footOld)) {
  s = s.replace(footOld, footNew);
}

s = s.replace(/min-w-\[860px\]/, "min-w-[1100px]");

// Chart section (last one)
const chartIdx = s.lastIndexOf('<h2 className="text-base font-semibold">Chart</h2>');
if (chartIdx < 0) throw new Error("Chart section missing");
const secStart = s.lastIndexOf(
  '<section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">',
  chartIdx,
);
const secEnd = s.indexOf("</section>", chartIdx) + "</section>".length;
const chartSnippet = fs.readFileSync("scripts/chart-ux-section.tsx.txt", "utf8");
s = s.slice(0, secStart) + chartSnippet + s.slice(secEnd);

fs.writeFileSync(path, s);
console.error("wrote", path, "lines", s.split("\n").length);
