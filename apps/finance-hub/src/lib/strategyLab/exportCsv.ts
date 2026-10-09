import type { LabEvaluation, PricedStructure } from "@/lib/strategyLab/lab";

export function csvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function line(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map((cell) => csvField(cell)).join(",");
}

function pricedRows(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter((row): row is PricedStructure => row.status === "priced");
}

/** structures × horizons × spot points. One row per priced curve point. */
export function evaluationCubeCsv(evaluation: LabEvaluation): string {
  const rows = [line(["structure", "horizon", "date", "spot", "pnl"])];
  for (const structure of pricedRows(evaluation)) {
    for (const curve of structure.curves) {
      const horizon = evaluation.horizons.find((item) => item.id === curve.horizonId);
      for (const point of curve.points) {
        rows.push(line([structure.spec.label, horizon?.label ?? curve.horizonId, horizon?.date ?? "", point.spot, point.pnl]));
      }
    }
  }
  return `${rows.join("\n")}\n`;
}

function legsText(structure: PricedStructure): string {
  return structure.legs.map((leg) => `${leg.ratio}${leg.right} ${leg.strike}`).join(" / ");
}

function entryText(structure: PricedStructure): string {
  const entry = structure.spec.entry;
  return entry.kind === "limit" ? `limit ${entry.netPerShare}` : entry.kind;
}

function dollarsAtRisk(structure: PricedStructure): number | "" {
  if (structure.spec.capitalOverride != null) return structure.spec.capitalOverride;
  return typeof structure.risk.maxLoss === "number" ? structure.risk.maxLoss : "";
}

/** One row per priced structure: the entry card, not the chart. */
export function entryTableCsv(evaluation: LabEvaluation): string {
  const rows = [
    line(["label", "expiry", "legs", "entry", "debit", "breakevens", "maxLoss", "maxGain", "packages", "idleCash", "netDelta", "dollarsAtRisk"]),
  ];
  for (const structure of pricedRows(evaluation)) {
    const sizing = structure.sizing;
    const packages = sizing.status === "needsCapitalOverride" ? "" : sizing.packages;
    const idleCash = sizing.status === "sized" ? sizing.idleCash : sizing.status === "perPackage" ? 0 : "";
    rows.push(
      line([
        structure.spec.label,
        structure.spec.expiry,
        legsText(structure),
        entryText(structure),
        structure.debit,
        structure.risk.breakevens.join(";"),
        structure.risk.maxLoss,
        structure.risk.maxGain,
        packages,
        idleCash,
        structure.greeks?.delta ?? "",
        dollarsAtRisk(structure),
      ]),
    );
  }
  return `${rows.join("\n")}\n`;
}
