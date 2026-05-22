import fs from "node:fs";

const path = "src/app/dividend-models/page.tsx";
let s = fs.readFileSync(path, "utf8");

s = s.replace("</motion>\n            ) : null}", "</div>\n            ) : null}");

// Remove Every position tab button
s = s.replace(
  /\s*<button[\s\S]*?onClick=\{\(\) => setWorkspaceTab\("positions"\)\}[\s\S]*?Every position\s*<\/button>/,
  "",
);

// holdings branch: only overview | holdings (remove ternary for positions)
const holdingsStart = s.indexOf(') : workspaceTab === "holdings" ? (');
if (holdingsStart < 0) throw new Error("holdings branch not found");

const positionsStart = s.indexOf(") : (\n                  <>\n                    {!dashboard || dashboard.positions", holdingsStart);
if (positionsStart < 0) throw new Error("positions branch not found");

const holdingsEnd = s.indexOf("                  </>\n                )}\n              </>\n            )}\n          </div>", positionsStart);
if (holdingsEnd < 0) throw new Error("holdings end not found");

const mergedTable = `) : (
                  <>
                    {sortedRows.length === 0 ? (
                      <motion className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No symbols yet.</div>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[1100px] border-collapse text-[15px]">
                          <thead>
                            <tr className="border-b border-zinc-200 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                              <th className="py-3 pr-3">
                                <SortTh col="symbol" label="Symbol" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                              </th>
                              <th className="py-2.5 pr-3">
                                <SortTh col="name" label="Name" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                              </th>
                              <th className="py-2.5 pr-3">
                                <SortTh col="category" label="Category" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align="left" />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="yield" label="Yield %" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="annual$" label="Est. annual div" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="shares" label="Shares" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">Avg price</th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="cost" label="Cost" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-2.5 pr-3 text-right">Last</th>
                              <th className="py-2.5 pr-3 text-right">
                                <SortTh col="mv" label="Market value" sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} />
                              </th>
                              <th className="py-3 pr-3 text-right"> </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedRows.map((r) => (
                              <tr
                                key={r.holdingId}
                                role="button"
                                tabIndex={0}
                                onClick={() => goToTerminalSymbol(r.symbol)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    goToTerminalSymbol(r.symbol);
                                  }
                                }}
                                className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
                              >
                                <td className="py-2.5 pr-3 font-semibold text-zinc-900 dark:text-zinc-100" onClick={(e) => e.stopPropagation()}>
                                  <SymbolLink symbol={r.symbol}>{r.symbol}</SymbolLink>
                                </td>
                                <td className="max-w-[14rem] truncate py-2.5 pr-3 text-sm text-zinc-600 dark:text-zinc-400" title={r.displayName ?? undefined}>
                                  {r.displayName ?? "—"}
                                </td>
                                <td className="max-w-[10rem] truncate py-2.5 pr-3 text-xs text-zinc-600 dark:text-zinc-400">{r.category}</td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(rowYieldPct(r))}</td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(positionAnnualDiv(r), privacy.masked)}</td>
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
                                <td className="py-2.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    className="h-8 w-28 cursor-text rounded border border-zinc-300 bg-white px-1 text-right tabular-nums text-xs dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
                                    defaultValue={r.avgUnitCost ?? ""}
                                    key={\`avg-\${r.holdingId}-\${r.avgUnitCost ?? "null"}\`}
                                    onBlur={(e) => {
                                      const raw = e.target.value.trim();
                                      const avg = raw === "" ? null : Number(raw);
                                      if (avg != null && !Number.isFinite(avg)) return;
                                      if (avg === r.avgUnitCost || (avg == null && r.avgUnitCost == null)) return;
                                      void (async () => {
                                        try {
                                          await fetch(
                                            \`/api/dividend-models/portfolios/\${encodeURIComponent(activeId!)}/holdings\`,
                                            {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ symbol: r.symbol, avg_unit_cost: avg }),
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
                                <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-teal-700 dark:text-teal-300">
                                  {usdMasked(r.cost, privacy.masked)}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                                  {usdMasked(r.last, privacy.masked)}
                                </td>
                                <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(r.marketValue, privacy.masked)}</td>
                                <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-white/20"
                                    onClick={() => {
                                      void (async () => {
                                        try {
                                          await fetch(
                                            \`/api/dividend-models/portfolios/\${encodeURIComponent(activeId!)}/holdings?symbol=\${encodeURIComponent(r.symbol)}\`,
                                            { method: "DELETE" },
                                          );
                                          await Promise.all([loadTable(activeId!), loadDashboard(activeId!), loadPortfolios()]);
                                        } catch {
                                          /* ignore */
                                        }
                                      })();
                                    }}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-zinc-300 bg-zinc-50 text-xs font-semibold text-zinc-800 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
                              <td className="py-2.5 pr-3">Totals</td>
                              <td className="py-2.5 pr-3">—</td>
                              <td className="py-2.5 pr-3">—</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{pctFmt(tableFooter.portfolioYieldPct)}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalAnnualDiv, privacy.masked)}</td>
                              <td className="py-2.5 pr-3 text-right tabular-nums">
                                {Number.isFinite(tableFooter.totalShares)
                                  ? tableFooter.totalShares.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                  : "—"}
                              </td>
                              <td className="py-2.5 pr-3" />
                              <td className="py-2.5 pr-3 text-right tabular-nums">
                                {usdMasked(
                                  sortedRows.reduce((sum, r) => sum + (r.cost ?? 0), 0),
                                  privacy.masked,
                                )}
                              </td>
                              <td className="py-2.5 pr-3" />
                              <td className="py-2.5 pr-3 text-right tabular-nums">{usdMasked(tableFooter.totalMv, privacy.masked)}</td>
                              <td className="py-2" />
                            </tr>
                          </tfoot>
                        </table>
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                          All columns come from the holdings API (Schwab/Yahoo fundamentals and quotes, with simulated TTM yield
                          after Build history). Use Refresh fundamentals if name or yield stayed empty.
                        </p>
                      </div>
                    )}
                  </>
                )}`;

// Fix typo in mergedTable
const mergedTableFixed = mergedTable.replace('<motion className', '<div className').replace('</motion>', '</div>').replace('No symbols yet.</motion>', 'No symbols yet.</div>');

s = s.slice(0, holdingsStart) + mergedTableFixed + s.slice(holdingsEnd);

// Replace chart section
const chartSecStart = s.lastIndexOf('      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">');
if (chartSecStart < 0) throw new Error("chart section not found");
let chartSecEnd = chartSecStart;
while (chartSecEnd < s.length && s.slice(chartSecEnd, chartSecEnd + 20) !== "      </section>\n\n    </div>") {
  const idx = s.indexOf("      </section>", chartSecEnd + 1);
  if (idx < 0) break;
  chartSecEnd = idx;
}
chartSecEnd += "      </section>".length;

const chartSection = `      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Chart</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Rebased total return % from the first month in range. In reinvest mode, the shaded band above the price-only path is
              cumulative dividend lift (DRIP).
            </p>
          </div>
        </div>

        <motion className="mt-3 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-white/10 dark:bg-white/10 dark:text-zinc-100">
          {simulationMode === "reinvest"
            ? \`Reinvest dividends at month-end (\${years}-year window).\`
            : \`Withdraw dividends to cash (\${years}-year window).\`}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showSpy} onChange={(e) => setShowSpy(e.target.checked)} />
            SPY
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showQqq} onChange={(e) => setShowQqq(e.target.checked)} />
            QQQ
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">Range</span>
            {([1, 3, 5] as const).map((y) => (
              <button
                key={y}
                type="button"
                className={\`rounded-md px-2 py-1 text-xs font-semibold \${years === y ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-white/20"}\`}
                onClick={() => setYears(y)}
              >
                {y}y
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-l border-zinc-200 pl-4 dark:border-white/10">
            <span className="text-zinc-500">Dividends</span>
            <button
              type="button"
              className={\`rounded-md px-2 py-1 text-xs font-semibold \${simulationMode === "withdraw" ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-white/20"}\`}
              onClick={() => setSimulationMode("withdraw")}
            >
              Withdraw
            </button>
            <button
              type="button"
              className={\`rounded-md px-2 py-1 text-xs font-semibold \${simulationMode === "reinvest" ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-white/20"}\`}
              onClick={() => setSimulationMode("reinvest")}
            >
              Reinvest
            </button>
          </div>
        </div>

        {modeledFootnote ? <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{modeledFootnote}</div> : null}
        {modeledSpanSummary ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{modeledSpanSummary}</div> : null}
        {totalDividendsReceived != null ? (
          <div className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Total dividends received ({years}-year window): {usdMasked(totalDividendsReceived, privacy.masked)}
          </div>
        ) : null}

        <div className="mt-4 flex min-h-[24rem] w-full min-w-0 flex-col">
          {modeledChartEmpty ? (
            <motion className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
              <p className="font-medium text-zinc-800 dark:text-zinc-200">No simulated months to chart yet.</p>
              <p className="mt-2 max-w-md">
                Set shares on every holding, then use <span className="font-semibold">Build history</span> to materialize monthly
                simulation points.
              </p>
            </div>
          ) : (
            <div className="h-96 w-full min-h-[24rem] flex-1">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320} debounce={50}>
                <ComposedChart data={modeledChart} margin={{ top: 8, right: 8, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="monthEnd"
                    tickFormatter={(v: string) => modeledChartXLabel(v, years)}
                    tick={{ fontSize: 10, fill: "#71717a" }}
                    interval={years === 1 ? 0 : years === 3 ? 1 : 2}
                    minTickGap={8}
                  />
                  <YAxis width={48} tickFormatter={(v) => \`\${Number(v).toFixed(0)}%\`} />
                  <Tooltip
                    labelFormatter={(v) => (typeof v === "string" ? \`Month-end \${v}\` : String(v))}
                    formatter={(value, name) => {
                      const n = typeof name === "string" ? name : String(name);
                      if (n === "Dividend lift") return \`\${Number(value).toFixed(2)}%\`;
                      return \`\${Number(value).toFixed(2)}%\`;
                    }}
                  />
                  <Legend />
                  {simulationMode === "reinvest" ? (
                    <>
                      <Area
                        type="monotone"
                        dataKey="priceOnly"
                        stackId="nav"
                        name="Price only"
                        fill={DM_CHART_PORT}
                        fillOpacity={0.15}
                        stroke="none"
                      />
                      <Area
                        type="monotone"
                        dataKey="motionLift"
                        stackId="nav"
                        name="Dividend lift"
                        fill={DM_CHART_DIV_LIFT}
                        fillOpacity={0.45}
                        stroke="none"
                      />
                    </>
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="port"
                    name="Portfolio %"
                    stroke={DM_CHART_PORT}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                  {showSpy ? (
                    <Line
                      type="monotone"
                      dataKey="spy"
                      name="SPY %"
                      stroke={DM_CHART_SPY}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ) : null}
                  {showQqq ? (
                    <Line
                      type="monotone"
                      dataKey="qqq"
                      name="QQQ %"
                      stroke={DM_CHART_QQQ}
                      dot={false}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>`;

const chartFixed = chartSection
  .replaceAll("<motion", "<div")
  .replaceAll("</motion>", "</motion>")
  .replaceAll("</motion>", "</motion>")
  .replaceAll('dataKey="motionLift"', 'dataKey="motionLift"')
  .replaceAll('dataKey="motionLift"', 'dataKey="dividendLift"');

s = s.slice(0, chartSecStart) + chartFixed + s.slice(chartSecEnd);

fs.writeFileSync(path, s);
console.error("patched", s.length);
