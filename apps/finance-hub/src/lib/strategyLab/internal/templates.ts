import {
  listedStrikes,
  nearestStrike,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";
import { nearestDeltaStrike, strikeDeltas } from "@/lib/strategyLab/strikeDelta";

export type StrikeTarget = { readonly by: "strike"; readonly strike: number } | { readonly by: "delta"; readonly delta: number };

export type TemplateRequest =
  | { readonly template: "callDebitSpread"; readonly long: StrikeTarget; readonly short: StrikeTarget }
  | { readonly template: "zebra"; readonly long: StrikeTarget; readonly short: StrikeTarget }
  | { readonly template: "longCall"; readonly strike: StrikeTarget }
  | { readonly template: "custom"; readonly legs: readonly { readonly right: OptionRight; readonly strike: number; readonly ratio: number }[] };

export const TEMPLATE_CATALOG = [
  { id: "callDebitSpread", label: "Call debit spread" },
  { id: "zebra", label: "ZEBRA" },
  { id: "longCall", label: "Long call" },
  { id: "custom", label: "Custom" },
] as const;

export type TemplateId = (typeof TEMPLATE_CATALOG)[number]["id"];

type Assumptions = { readonly rate: number; readonly dividendYield: number };

export type ResolvedLeg = { readonly right: OptionRight; readonly strike: number; readonly ratio: number };

function resolveTarget(
  chain: OptionChain,
  expiry: IsoDate,
  right: OptionRight,
  target: StrikeTarget,
  assumptions: Assumptions,
  tie: "lower" | "higher",
): number | string {
  const strikes = listedStrikes(chain, expiry, right);
  if (strikes.length === 0) return "No listed contracts for that expiry.";
  if (target.by === "strike") {
    const snapped = nearestStrike(strikes, target.strike);
    return snapped ?? "No listed strike.";
  }
  const best = nearestDeltaStrike(strikeDeltas(chain, expiry, right, assumptions), target.delta, tie);
  return best ?? "Could not solve a delta on that expiry.";
}

/** Turn a template into integer-ratio legs on listed strikes. */
export function resolveTemplate(
  request: TemplateRequest,
  chain: OptionChain,
  expiry: IsoDate,
  assumptions: Assumptions,
): { readonly legs: ResolvedLeg[] } | { readonly error: string } {
  if (request.template === "custom") {
    if (request.legs.length < 1 || request.legs.length > 6) return { error: "A structure has 1 to 6 legs." };
    const legs: ResolvedLeg[] = [];
    for (const leg of request.legs) {
      if (!Number.isInteger(leg.ratio) || leg.ratio === 0) return { error: "Leg ratios are nonzero whole numbers." };
      const strike = resolveTarget(chain, expiry, leg.right, { by: "strike", strike: leg.strike }, assumptions, "lower");
      if (typeof strike === "string") return { error: strike };
      legs.push({ right: leg.right, strike, ratio: leg.ratio });
    }
    return { legs };
  }

  if (request.template === "longCall") {
    const strike = resolveTarget(chain, expiry, "C", request.strike, assumptions, "lower");
    if (typeof strike === "string") return { error: strike };
    return { legs: [{ right: "C", strike, ratio: 1 }] };
  }

  const long = resolveTarget(chain, expiry, "C", request.long, assumptions, "lower");
  const short = resolveTarget(chain, expiry, "C", request.short, assumptions, "higher");
  if (typeof long === "string") return { error: long };
  if (typeof short === "string") return { error: short };
  if (long === short) return { error: "The long and short strikes collapsed onto one contract." };
  if (long >= short) return { error: "The long strike has to sit below the short strike." };
  const longRatio = request.template === "zebra" ? 2 : 1;
  return {
    legs: [
      { right: "C", strike: long, ratio: longRatio },
      { right: "C", strike: short, ratio: -1 },
    ],
  };
}
