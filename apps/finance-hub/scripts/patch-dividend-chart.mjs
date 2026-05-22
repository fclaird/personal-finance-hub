import fs from "node:fs";

const path = "src/app/dividend-models/page.tsx";
let text = fs.readFileSync(path, "utf8");
const marker = '<h2 className="text-base font-semibold">Charts</h2>';
const idx = text.lastIndexOf(marker);
if (idx < 0) throw new Error("Charts marker not found");
const secStart = text.lastIndexOf(
  '<section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">',
  idx,
);
const rest = text.slice(idx);
const closeRel = rest.indexOf("      </section>");
const secEnd = idx + closeRel + "      </section>\n".length;

const newSection = `      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <motion className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Chart</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Monthly dividends (bars) and rebased total return % vs SPY/QQQ. Toggle reinvestment vs withdrawal to compare
              hypothetical NAV paths using your share counts.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-white/10 dark:bg-white/10 dark:text-zinc-100">
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
        {modeledSpanSummary ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{modeledSpanSummary}</motion> : null}

        <div className="mt-4 flex min-h-[24rem] w-full min-w-0 flex-col">
          {modeledChartEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
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
                  <YAxis yAxisId="left" width={56} tickFormatter={(v) => usdMasked(Number(v), privacy.masked)} />
                  <YAxis yAxisId="right" width={44} orientation="right" tickFormatter={(v) => \`\${Number(v).toFixed(0)}%\`} />
                  <Tooltip
                    labelFormatter={(v) => (typeof v === "string" ? \`Month-end \${v}\` : String(v))}
                    formatter={(value, name) => {
                      const n = typeof name === "string" ? name : String(name);
                      if (n.startsWith("Monthly dividends")) return usdMasked(Number(value), privacy.masked);
                      return \`\${Number(value).toFixed(2)}%\`;
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="div" name="Monthly dividends" fill={DM_CHART_DIV} />
                  <Line
                    yAxisId="right"
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
                      yAxisId="right"
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
                      yAxisId="right"
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
      </section>
`.replaceAll("<motion", "<div").replaceAll("</motion>", "</div>");

text = text.slice(0, secStart) + newSection + text.slice(secEnd);
fs.writeFileSync(path, text);
console.error("patched", secStart, secEnd, "new len", text.length);
