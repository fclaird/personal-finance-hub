import fs from "node:fs";

const src = fs.readFileSync("/tmp/page-clean.tsx", "utf8");
let s = src;

// --- types / helpers ---
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
s = s.replace(/function liveChartXLabel\([\s\S]*?\n\}\n\nfunction positionAnnualDiv/, "function positionAnnualDiv");

// --- state ---
s = s.replace(
  `  const [modeled, setModeled] = useState<ModeledPoint[]>([]);\n  const [livePts, setLivePts] = useState<LivePoint[]>([]);\n  const [modeledFootnote, setModeledFootnote] = useState<string | null>(null);\n  const [modeledSpanSummary, setModeledSpanSummary] = useState<string | null>(null);\n  const [liveMsg, setLiveMsg] = useState<string | null>(null);\n\n  const [liveForward, setLiveForward] = useState(false);\n  const [years, setYears] = useState<3 | 5>(5);`,
  `  const [modeled, setModeled] = useState<ModeledPoint[]>([]);\n  const [modeledFootnote, setModeledFootnote] = useState<string | null>(null);\n  const [modeledSpanSummary, setModeledSpanSummary] = useState<string | null>(null);\n\n  const [years, setYears] = useState<TimelineYears>(5);\n  const [simulationMode, setSimulationMode] = useState<SimulationMode>("withdraw");`,
);
s = s.replace(/  const \[schwabAccounts[\s\S]*?const active = useMemo/, "  const active = useMemo");
s = s.replace(
  /  const liveStartedAtActive = useMemo[\s\S]*?\n\n  const loadSchwabAccounts[\s\S]*?\n\n  const loadPortfolios/,
  "\n  const loadPortfolios",
);
s = s.replace(
  /  const \[useSliceCounterfactualBar[\s\S]*?const \[sliceCounterfactualDrip[\s\S]*?\n\n/,
  "",
);

// --- loadModeled ---
s = s.replace(
  `      const qs = new URLSearchParams({\n        years: String(years),\n        includeSpy: showSpy ? "1" : "0",\n        includeQqq: showQqq ? "1" : "0",\n      });`,
  `      const qs = new URLSearchParams({\n        years: String(years),\n        mode: simulationMode,\n        includeSpy: showSpy ? "1" : "0",\n        includeQqq: showQqq ? "1" : "0",\n      });`,
);
s = s.replace(/modeled month-end/g, "simulated month-end");
s = s.replace("run Refresh data after", "run Build history after");
s = s.replace("[years, showSpy, showQqq]", "[years, simulationMode, showSpy, showQqq]");

s = s.replace(/  const loadLive = useCallback\([\s\S]*?\n  \);\n\n/, "");

// --- effects ---
s = s.replace(
  /await Promise\.all\(\[loadPortfolios\(\), loadSchwabAccounts\(\)\]\)/,
  "await loadPortfolios()",
);
s = s.replace(/  \}, \[loadPortfolios, loadSchwabAccounts\]\);\n\n/, "  }, [loadPortfolios]);\n\n");
s = s.replace(/  useEffect\(\(\) => \{\n    const id = active\?\.sliceAccountId[\s\S]*?\n  \}, \[activeId, active\?\.sliceAccountId\]\);\n\n/, "");
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

// --- chart data ---
const chartBlockRe =
  /  const counterfactualByMonth = useMemo\([\s\S]*?  const modeledChartEmpty = modeledChart\.length === 0;\n/;
if (!chartBlockRe.test(s)) throw new Error("chart block not found");
s = s.replace(
  chartBlockRe,
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

  const modeledChartEmpty = modeledChart.length === 0;

`,
);
s = s.replace(/\n  const liveChartEmpty = liveChart\.length === 0;\n\n/, "\n");

s = s.replace(
  /await Promise\.all\(\[loadTable\(activeId\), loadDashboard\(activeId\), loadPortfolios\(\), loadModeled\(activeId\), loadLive\(activeId\)\]\);/g,
  "await Promise.all([loadTable(activeId), loadDashboard(activeId), loadPortfolios(), loadModeled(activeId)]);",
);
s = s.replace(/  async function onStartLive\(\) \{[\s\S]*?\n  \}\n\n  return \(/, "  return (");

s = s.replace(
  '<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dividend center</h1>',
  '<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simulated Dividend Portfolio</h1>',
);
s = s.replace(
  /Local SQLite materialization[\s\S]*?Link a Schwab account slice to scope income and sync quantities\./,
  "Manual portfolios with share counts. Build history to materialize five years of symbol-level monthly prices, dividends, and trailing yield, then chart 1y / 3y / 5y paths with dividend reinvestment vs withdrawal.",
);
s = s.replace('{busy === "refresh" ? "Refreshing…" : "Refresh data"}', '{busy === "refresh" ? "Building…" : "Build history"}');

// --- line edits ---
const lines = s.split("\n");

// Remove Schwab block
const schwabStart = lines.findIndex((l) => l.includes("Schwab slice account"));
if (schwabStart >= 0) {
  let start = schwabStart;
  if (start > 0 && lines[start - 1].includes("text-xs font-semibold uppercase")) start--;
  let end = schwabStart;
  while (end < lines.length && !lines[end].includes(">Rename</div>")) end++;
  lines.splice(start, end - start);
}

// Replace live sidebar block
let liveIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i]?.includes('className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">') && lines[i + 1]?.includes("{active.liveStartedAt")) {
    liveIdx = i;
    break;
  }
}
if (liveIdx < 0) liveIdx = lines.findIndex((l) => l.includes("{active.liveStartedAt ? ("));
if (liveIdx >= 0) {
  let end = liveIdx;
  while (end < lines.length && !lines[end].includes("Start live log")) end++;
  if (end >= lines.length) throw new Error("Start live log button not found after liveStartedAt block");
  while (end < lines.length && !lines[end].includes("</button>")) end++;
  end++;
  lines.splice(
    liveIdx,
    end - liveIdx,
    `                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">`,
    `                  Set share counts on every holding, then use <span className="font-medium">Build history</span> to materialize`,
    `                  monthly simulation data.`,
    `                </p>`,
  );
}

// Replace chart section (last section with Charts h2)
let chartLine = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes("Charts</h2>") || lines[i].includes('>Chart</h2>')) {
    chartLine = i;
    break;
  }
}
if (chartLine < 0) throw new Error("Charts section not found");
let secStart = chartLine;
while (secStart > 0 && !lines[secStart].includes('<section className="rounded-2xl border border-zinc-300 bg-white p-6')) secStart--;
let secEnd = chartLine;
while (secEnd < lines.length && lines[secEnd].trim() !== "</section>") secEnd++;
secEnd++;

const chart = fs.readFileSync("scripts/chart-section-snippet.txt", "utf8").split("\n");
lines.splice(secStart, secEnd - secStart, ...chart);

const out = lines.join("\n");
fs.writeFileSync("src/app/dividend-models/page.tsx", out);
console.error("wrote page.tsx", lines.length, "lines");
