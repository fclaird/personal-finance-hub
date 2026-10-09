"use client";

import { useEffect, useState } from "react";

import type { OptionChain } from "@/lib/optionChain/chain";
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
import { compactQuotes, defaultSnapshotSummary, provenanceFromChain } from "@/lib/strategyLab/snapshots";

type SnapshotListItem = {
  id: string;
  createdAt: string;
  symbol: string;
  summary: string;
};

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
  chain,
  symbol,
  evaluation,
  onRestore,
}: {
  lab: LabScenario;
  chain: OptionChain;
  symbol: string;
  evaluation: LabEvaluation;
  onRestore: (scenario: LabScenario) => void;
}) {
  const [library, setLibrary] = useState<NamedScenario[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    setLibrary(readLibrary(window.localStorage));
    void refreshSnapshots(symbol, setSnapshots);
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
      <p className="basis-full pb-1 text-[11px] text-zinc-300">
        Named scenarios stay in this browser. A bad save is ignored and is not applied.
        {note ? ` ${note}` : ""}
      </p>
      <label className={labLabel}>
        Snapshot summary
        <input
          aria-label="Snapshot summary"
          value={summary}
          maxLength={160}
          placeholder={defaultSnapshotSummary(lab)}
          onChange={(event) => setSummary(event.target.value)}
          className={`mt-1 block w-64 px-2 py-1.5 text-sm ${labControl}`}
        />
      </label>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          void (async () => {
            const parsed = parseScenario(JSON.parse(JSON.stringify(lab)) as unknown);
            if (!parsed) {
              setNote("This scenario could not be saved.");
              return;
            }
            const resp = await fetch("/api/strategy-lab/snapshots", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                scenario: parsed,
                quotes: compactQuotes(chain, parsed),
                provenance: provenanceFromChain(chain),
                summary: summary.trim() || defaultSnapshotSummary(parsed),
              }),
            });
            const body = (await resp.json()) as { ok?: boolean; error?: string; snapshot?: { id: string } };
            if (!resp.ok || !body.ok || !body.snapshot) {
              setNote(body.error ?? "Snapshot was not saved.");
              return;
            }
            setSnapshotId(body.snapshot.id);
            setNote(`Saved snapshot ${body.snapshot.id}. A journal entry can cite that id.`);
            await refreshSnapshots(symbol, setSnapshots);
          })();
        }}
      >
        Save snapshot
      </button>
      <label className={labLabel}>
        Snapshots
        <select
          aria-label="Saved snapshots"
          value={snapshotId}
          onChange={(event) => setSnapshotId(event.target.value)}
          className={`mt-1 block max-w-72 px-2 py-1.5 text-sm ${labControl}`}
        >
          <option value="">Choose</option>
          {snapshots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.summary}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          void (async () => {
            if (!snapshotId) {
              setNote("Choose a snapshot.");
              return;
            }
            const resp = await fetch(`/api/strategy-lab/snapshots?id=${encodeURIComponent(snapshotId)}`, { cache: "no-store" });
            const body = (await resp.json()) as { ok?: boolean; error?: string; snapshot?: { scenario: unknown; symbol: string } };
            if (!resp.ok || !body.ok || !body.snapshot) {
              setNote(body.error ?? "That snapshot could not be read.");
              return;
            }
            if (body.snapshot.symbol !== symbol) {
              setNote(`Load ${body.snapshot.symbol} before opening this snapshot.`);
              return;
            }
            const parsed = parseScenario(body.snapshot.scenario);
            if (!parsed) {
              setNote("That snapshot could not be read.");
              return;
            }
            onRestore(parsed);
            setNote(`Loaded ${snapshotId}. Charts use the chain on screen. Cite this id from a journal entry.`);
          })();
        }}
      >
        Load snapshot
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => {
          void (async () => {
            if (!snapshotId) return;
            const resp = await fetch(`/api/strategy-lab/snapshots?id=${encodeURIComponent(snapshotId)}`, { method: "DELETE" });
            const body = (await resp.json()) as { ok?: boolean; error?: string };
            if (!resp.ok || !body.ok) {
              setNote(body.error ?? "Snapshot was not deleted.");
              return;
            }
            setNote(`Deleted ${snapshotId}.`);
            setSnapshotId("");
            await refreshSnapshots(symbol, setSnapshots);
          })();
        }}
      >
        Delete snapshot
      </button>
      {snapshotId ? (
        <p className="basis-full font-mono text-[11px] text-zinc-200">
          Snapshot id {snapshotId}
        </p>
      ) : null}
    </section>
  );
}

async function refreshSnapshots(symbol: string, setSnapshots: (rows: SnapshotListItem[]) => void) {
  try {
    const resp = await fetch(`/api/strategy-lab/snapshots?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    const body = (await resp.json()) as { ok?: boolean; snapshots?: SnapshotListItem[] };
    if (!resp.ok || !body.ok) return;
    setSnapshots(body.snapshots ?? []);
  } catch {
    setSnapshots([]);
  }
}
