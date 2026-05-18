import fs from "node:fs";

const path = "src/app/dividend-models/page.tsx";
let s = fs.readFileSync(path, "utf8");

// Types cleanup
s = s.replace(
  `type SchwabAccountRow = { id: string; name: string; type: string; lastSnapshotAsOf: string | null };\n\ntype CounterfactualPoint = { month_end: string; monthDividend: number; nav: number | null };\n\n`,
  "",
);
s = s.replace(
  `type LivePoint = {\n  as_of: string;\n  nav_total: number | null;\n  dividends_period: number;\n  portfolio_rebased_pct: number | null;\n  spy_rebased_pct: number | null;\n  qqq_rebased_pct: number | null;\n  status: string;\n};\n\n`,
  "",
);
s = s.replace(
  `function modeledChartXLabel(monthEndIso: string, _windowYears: 3 | 5): string {`,
  `type TimelineYears = 1 | 3 | 5;\ntype SimulationMode = "reinvest" | "withdraw";\n\nfunction modeledChartXLabel(monthEndIso: string, _windowYears: TimelineYears): string {`,
);
s = s.replace(
  /function liveChartXLabel\([\s\S]*?\n\}\n\nfunction positionAnnualDiv/,
  "function positionAnnualDiv",
);

// State
s = s.replace(
  `  const [modeled, setModeled] = useState<ModeledPoint[]>([]);\n  const [livePts, setLivePts] = useState<LivePoint[]>([]);\n  const [modeledFootnote, setModeledFootnote] = useState<string | null>(null);\n  const [modeledSpanSummary, setModeledSpanSummary] = useState<string | null>(null);\n  const [liveMsg, setLiveMsg] = useState<string | null>(null);\n\n  const [liveForward, setLiveForward] = useState(false);\n  const [years, setYears] = useState<3 | 5>(5);`,
  `  const [modeled, setModeled] = useState<ModeledPoint[]>([]);\n  const [modeledFootnote, setModeledFootnote] = useState<string | null>(null);\n  const [modeledSpanSummary, setModeledSpanSummary] = useState<string | null>(null);\n\n  const [years, setYears] = useState<TimelineYears>(5);\n  const [simulationMode, setSimulationMode] = useState<SimulationMode>("withdraw");`,
);
s = s.replace(
  /  const \[schwabAccounts[\s\S]*?const active = useMemo/,
  "  const active = useMemo",
);
s = s.replace(
  /  const liveStartedAtActive = useMemo[\s\S]*?\n\n  const loadSchwabAccounts[\s\S]*?\n\n  const loadPortfolios/,
  "\n  const loadPortfolios",
);
s = s.replace(
  /  const \[useSliceCounterfactualBar[\s\S]*?const \[sliceCounterfactualDrip[\s\S]*?\n\n/,
  "",
);

// loadModeled mode param
s = s.replace(
  `      const qs = new URLSearchParams({\n        years: String(years),\n        includeSpy: showSpy ? "1" : "0",\n        includeQqq: showQqq ? "1" : "0",\n      });`,
  `      const qs = new URLSearchParams({\n        years: String(years),\n        mode: simulationMode,\n        includeSpy: showSpy ? "1" : "0",\n        includeQqq: showQqq ? "1" : "0",\n      });`,
);
s = s.replace(/modeled month-end/g, "simulated month-end");
s = s.replace("run Refresh data after", "run Build history after");
s = s.replace("[years, showSpy, showQqq]", "[years, simulationMode, showSpy, showQqq]");

// Remove loadLive block
s = s.replace(/  const loadLive = useCallback\([\s\S]*?\n  \);\n\n/, "");

// Effects
s = s.replace(
  /  useEffect\(\(\) => \{\n    void \(async \(\) => \{\n      setError\(null\);\n      try \{\n        await Promise\.all\(\[loadPortfolios\(\), loadSchwabAccounts\(\)\]\);\n      } catch/,
  `  useEffect(() => {\n    void (async () => {\n      setError(null);\n      try {\n        await loadPortfolios();\n      } catch`,
);
s = s.replace(/  \}, \[loadPortfolios, loadSchwabAccounts\]\);\n\n/, "  }, [loadPortfolios]);\n\n");
s = s.replace(
  /  useEffect\(\(\) => \{\n    const id = active\?\.sliceAccountId[\s\S]*?\n  \}, \[activeId, active\?\.sliceAccountId\]\);\n\n/,
  "",
);
s = s.replace(
  /      setUseSliceCounterfactualBar\(false\);\n      setCounterfactualPoints\(\[\]\);\n      setCounterfactualError\(null\);\n/,
  "",
);
s = s.replace(/  useEffect\(\(\) => \{\n    if \(!activeId \|\| liveForward[\s\S]*?\n  \}, \[activeId, active\?\.sliceAccountId, liveForward[\s\S]*?\]\);\n\n/, "");
s = s.replace(/  useEffect\(\(\) => \{\n    if \(!active\?\.sliceAccountId\) setUseSliceCounterfactualBar\(false\);\n  \}, \[active\?\.sliceAccountId\]\);\n\n/, "");
s = s.replace(
  /        await loadPortfolios\(\);\n        await loadLive\(activeId\);\n        if \(!liveForward\) await loadModeled\(activeId\);/g,
  "        await loadPortfolios();\n        await loadModeled(activeId);",
);
s = s.replace(
  /  \}, \[activeId, liveForward, years, showSpy, showQqq, loadTable, loadDashboard, loadModeled, loadLive, loadPortfolios\]\);/,
  "  }, [activeId, years, simulationMode, showSpy, showQqq, loadTable, loadDashboard, loadModeled, loadPortfolios]);",
);
s = s.replace(/  useEffect\(\(\) => \{\n    if \(!activeId \|\| !liveStartedAtActive\)[\s\S]*?\n  \}, \[activeId, liveStartedAtActive[\s\S]*?\]\);\n\n/, "");

// modeledChart
s = s.replace(
  /  const counterfactualByMonth = useMemo\([\s\S]*?\n  \}, \[counterfactualPoints\]\);\n\n  const modeledChart = useMemo\(\(\) => \{[\s\S]*?\n  \}\);\n\n  const modeledDividendBarName[\s\S]*?\n  \}, \[useSliceCounterfactualBar[\s\S]*?\]\);\n\n  const liveChart = useMemo\([\s\S]*?\n  \);\n\n  const modeledChartEmpty/,
  `  const modeledChart = useMemo(
    () =>
      modeled.map((p) => ({
        monthEnd: p.month_end.slice(0, 10),
        div: Math.max(0, Number(p.total_dividends) || 0),
        port: p.portfolio_rebased_pct != null && Number.isFinite(p.portfolio_rebased_pct) ? p.portfolio_rebased_pct : 0,
        spy: p.spy_rebased_pct != null && Number.isFinite(p.spy_rebased_pct) ? p.spy_rebased_pct : undefined,
        qqq: p.qqq_rebased_pct != null && Number.isFinite(p.qqq_rebased_pct) ? p.qqq_rebased_pct : undefined,
      })),
    [modeled],
  );

  const modeledChartEmpty`,
);
s = s.replace("  const liveChartEmpty = liveChart.length === 0;\n\n", "");

s = s.replace(
  /await Promise\.all\(\[loadTable\(activeId\), loadDashboard\(activeId\), loadPortfolios\(\), loadModeled\(activeId\), loadLive\(activeId\)\]\);/g,
  "await Promise.all([loadTable(activeId), loadDashboard(activeId), loadPortfolios(), loadModeled(activeId)]);",
);

s = s.replace(/  async function onStartLive\(\) \{[\s\S]*?\n  \}\n\n  return \(/, "  return (");

// Header + button
s = s.replace(
  '<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dividend center</h1>',
  '<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simulated Dividend Portfolio</h1>',
);
s = s.replace(
  /Local SQLite materialization[\s\S]*?Link a Schwab account slice to scope income and sync quantities\./,
  "Manual portfolios with share counts. Build history to materialize five years of symbol-level monthly prices, dividends, and trailing yield, then chart 1y / 3y / 5y paths with dividend reinvestment vs withdrawal.",
);
s = s.replace('{busy === "refresh" ? "Refreshing…" : "Refresh data"}', '{busy === "refresh" ? "Building…" : "Build history"}');

fs.writeFileSync(path, s);

const lines = fs.readFileSync(path, "utf8").split("\n");

// Remove Schwab slice block (from title div through buttons before Rename)
const schwabStart = lines.findIndex((l) => l.includes("Schwab slice account"));
if (schwabStart >= 0) {
  let schwabEnd = schwabStart;
  while (schwabEnd < lines.length && !lines[schwabEnd].includes(">Rename</motion>")) {
    if (lines[schwabEnd].includes(">Rename</div>")) break;
    schwabEnd++;
  }
  // Back up to remove empty wrapper div if present
  let start = schwabStart;
  if (start > 0 && lines[start - 1].includes("text-xs font-semibold uppercase") && !lines[start - 1].includes("Rename")) {
    start--;
  }
  lines.splice(start, schwabEnd - start);
}

// Replace live-forward sidebar copy + Start live button with build-history hint
const liveBlockStart = lines.findIndex(
  (l) => l.includes("{active.liveStartedAt ? (") && lines.indexOf(l) > 400,
);
if (liveBlockStart >= 0) {
  let liveBlockEnd = liveBlockStart + 1;
  while (liveBlockEnd < lines.length && !lines[liveBlockEnd].includes("Start live log")) liveBlockEnd++;
  while (liveBlockEnd < lines.length && !lines[liveBlockEnd].includes(") : null}")) liveBlockEnd++;
  liveBlockEnd++;
  const hint = [
    `                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">`,
    `                  Set share counts on every holding, then use <span className="font-medium">Build history</span> to materialize`,
    `                  monthly simulation data.`,
    `                </p>`,
  ];
  lines.splice(liveBlockStart, liveBlockEnd - liveBlockStart, ...hint);
}

// Replace chart section
const chartIdx = lines.findIndex((l) => l.includes("Charts</h2>") || (l.includes("Chart</h2>") && l.includes("font-semibold")));
let secStart = chartIdx;
while (secStart > 0 && !lines[secStart].includes('<section className="rounded-2xl border border-zinc-300 bg-white p-6')) secStart--;
let secEnd = chartIdx;
while (secEnd < lines.length && lines[secEnd].trim() !== "</section>") secEnd++;
secEnd++;

let chart = fs.readFileSync("scripts/chart-section-snippet.txt", "utf8");
chart = chart.replaceAll("<motion", "<div").replaceAll("</motion>", "</motion>").replaceAll("</motion>", "</div>");
chart = chart.replace('dataKey="motion"', 'dataKey="motion"').replace('dataKey="motion"', 'dataKey="motion"');
chart = chart.replace('dataKey="motion"', 'dataKey="div"');

if (secStart >= 0 && secEnd > secStart) {
  lines.splice(secStart, secEnd - secStart, ...chart.split("\n"));
}

fs.writeFileSync(path, lines.join("\n"));
console.error("patched", { schwabStart, liveBlockStart, secStart, secEnd, total: lines.length });
