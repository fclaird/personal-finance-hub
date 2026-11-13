export type SecFact = {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  fp?: string;
  fy?: number;
  filed?: string;
  accn?: string;
  frame?: string;
};

export type TtmPiece = { form: string | null; start: string; end: string; val: number; accn: string | null };

export type TtmResult = {
  value: number;
  asOf: string;
  method: "four-quarters" | "fy-plus-ytd" | "latest-annual";
  concept: string;
  facts: TtmPiece[];
};

const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A"]);

export const REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
] as const;

export const EPS_CONCEPTS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"] as const;

function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

function piece(fact: SecFact): TtmPiece | null {
  if (!fact.start || !fact.end || typeof fact.val !== "number" || !Number.isFinite(fact.val)) return null;
  return { form: fact.form ?? null, start: fact.start, end: fact.end, val: fact.val, accn: fact.accn ?? null };
}

function usable(facts: SecFact[]): SecFact[] {
  const scored = facts.filter((fact) => {
    if (!fact.start || !fact.end || typeof fact.val !== "number" || !Number.isFinite(fact.val)) return false;
    if (!fact.form || !FORMS.has(fact.form)) return false;
    return Number.isFinite(daysBetween(fact.start, fact.end));
  });
  const best = new Map<string, SecFact>();
  for (const fact of scored) {
    const key = `${fact.start}|${fact.end}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, fact);
      continue;
    }
    const prevFrame = prev.frame ? 1 : 0;
    const nextFrame = fact.frame ? 1 : 0;
    if (nextFrame !== prevFrame) {
      if (nextFrame > prevFrame) best.set(key, fact);
      continue;
    }
    const prevFiled = prev.filed ?? "";
    const nextFiled = fact.filed ?? "";
    if (nextFiled > prevFiled) best.set(key, fact);
  }
  return [...best.values()];
}

function fourQuarters(facts: SecFact[]): TtmResult | null {
  const quarters = facts
    .filter((fact) => {
      const days = daysBetween(fact.start!, fact.end!);
      return days >= 75 && days <= 110;
    })
    .sort((a, b) => b.end!.localeCompare(a.end!));
  const picked: SecFact[] = [];
  for (const fact of quarters) {
    if (picked.length === 0) {
      picked.push(fact);
      continue;
    }
    const prev = picked[picked.length - 1]!;
    const gap = daysBetween(fact.end!, prev.end!);
    if (gap >= 70 && gap <= 120) picked.push(fact);
    if (picked.length === 4) break;
  }
  if (picked.length !== 4) return null;
  const factsOut = picked.map(piece).filter((item): item is TtmPiece => item != null);
  if (factsOut.length !== 4) return null;
  return {
    value: factsOut.reduce((sum, item) => sum + item.val, 0),
    asOf: factsOut[0]!.end,
    method: "four-quarters",
    concept: "",
    facts: factsOut,
  };
}

function bridge(facts: SecFact[]): TtmResult | null {
  const annuals = facts.filter((fact) => {
    const days = daysBetween(fact.start!, fact.end!);
    return days >= 340 && days <= 380;
  });
  if (annuals.length === 0) return null;
  const fy = annuals.sort((a, b) => b.end!.localeCompare(a.end!))[0]!;
  const later = facts.filter((fact) => fact.end! > fy.end!);
  if (later.length === 0) {
    const annualPiece = piece(fy);
    if (!annualPiece) return null;
    return { value: annualPiece.val, asOf: annualPiece.end, method: "latest-annual", concept: "", facts: [annualPiece] };
  }
  const latestEnd = later.map((fact) => fact.end!).sort().at(-1)!;
  const current = later
    .filter((fact) => fact.end === latestEnd)
    .sort((a, b) => daysBetween(b.start!, b.end!) - daysBetween(a.start!, a.end!))[0]!;
  const duration = daysBetween(current.start!, current.end!);
  const prior = facts.find((fact) => {
    if (fact.end! >= current.end!) return false;
    const gap = daysBetween(fact.end!, current.end!);
    const dur = daysBetween(fact.start!, fact.end!);
    return gap >= 350 && gap <= 380 && Math.abs(dur - duration) <= 5;
  });
  if (!prior) return null;
  const pieces = [piece(fy), piece(current), piece(prior)].filter((item): item is TtmPiece => item != null);
  if (pieces.length !== 3) return null;
  return {
    value: pieces[0]!.val + pieces[1]!.val - pieces[2]!.val,
    asOf: pieces[1]!.end,
    method: "fy-plus-ytd",
    concept: "",
    facts: pieces,
  };
}

export function trailingFromFacts(facts: SecFact[], concept: string): TtmResult | null {
  const clean = usable(facts);
  const quarterly = fourQuarters(clean);
  const result = quarterly ?? bridge(clean);
  if (!result) return null;
  return { ...result, concept };
}

type CompanyFacts = {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, SecFact[]> }>;
  };
};

export function trailingFromCompanyFacts(payload: unknown, concepts: readonly string[]): TtmResult | null {
  const root = payload as CompanyFacts;
  const gaap = root?.facts?.["us-gaap"];
  if (!gaap) return null;
  for (const concept of concepts) {
    const units = gaap[concept]?.units;
    if (!units) continue;
    const unitKey = Object.keys(units).find((key) => key.startsWith("USD")) ?? Object.keys(units)[0];
    if (!unitKey) continue;
    const result = trailingFromFacts(units[unitKey] ?? [], concept);
    if (result) return result;
  }
  return null;
}
