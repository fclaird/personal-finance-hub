"use client";

import { useEffect, useState } from "react";

import { entryTableCsv, evaluationCubeCsv } from "@/lib/strategyLab/exportCsv";
import type { LabEvaluation, LabScenario } from "@/lib/strategyLab/lab";
import { labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  parseScenario,
  readLibrary,
  upsertScenario,
  writeLibrary,
  type NamedScenario,
} from "@/lib/strategyLab/scenarioStore";

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ScenarioBar({
  lab,
  symbol,
  evaluation,
  onRestore,
}: {
  lab: LabScenario;
  symbol: string;
  evaluation: LabEvaluation;
  onRestore: (scenario: LabScenario) => void;
}) {
  const [library, setLibrary] = useState<NamedScenario[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setLibrary(readLibrary(window.localStorage));
  }, [symbol]);

  function persist(next: readonly NamedScenario[]) {
    writeLibrary(window.localStorage, next);
    setLibrary(readLibrary(window.localStorage));
  }

  return (
    <section className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100">
      <label className={labLabel}>
        Scenario name
        <input
          aria-label="Scenario name"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          className={`mt-1 block w-40 px-2 py-1.5 text-sm ${labControl}`}
        />
      </label>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          const parsed = parseScenario(JSON.parse(JSON.stringify(lab)) as unknown);
          if (!parsed) {
            setNote("This scenario could not be saved.");
            return;
          }
          const next = upsertScenario(library, name, parsed, new Date().toISOString());
          if (!next) {
            setNote("Name it in 1 to 40 characters.");
            return;
          }
          persist(next);
          setSelected(name.trim());
          setNote(`Saved ${name.trim()}.`);
        }}
      >
        Save scenario
      </button>
      <label className={labLabel}>
        Saved
        <select
          aria-label="Saved scenarios"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className={`mt-1 block max-w-48 px-2 py-1.5 text-sm ${labControl}`}
        >
          <option value="">Choose</option>
          {library.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          const item = library.find((row) => row.name === selected);
          if (!item) {
            setNote("Choose a saved scenario.");
            return;
          }
          if (item.scenario.symbol !== symbol) {
            setNote(`Load ${item.scenario.symbol} before restoring ${item.name}.`);
            return;
          }
          const parsed = parseScenario(JSON.parse(JSON.stringify(item.scenario)) as unknown);
          if (!parsed) {
            setNote("That save could not be read.");
            return;
          }
          onRestore(parsed);
          setNote(`Restored ${item.name}.`);
        }}
      >
        Restore
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          if (!selected) return;
          persist(library.filter((item) => item.name !== selected));
          setSelected("");
          setNote(`Deleted ${selected}.`);
        }}
      >
        Delete
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => downloadCsv(`${symbol.toLowerCase()}-strategy-lab-cube.csv`, evaluationCubeCsv(evaluation))}
      >
        Export P&L cube
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => downloadCsv(`${symbol.toLowerCase()}-strategy-lab-entry.csv`, entryTableCsv(evaluation))}
      >
        Export entry table
      </button>
      <p className="pb-1 text-[11px] text-zinc-300">
        Named scenarios stay in this browser. A bad save is ignored and is not applied.
        {note ? ` ${note}` : ""}
      </p>
    </section>
  );
}
