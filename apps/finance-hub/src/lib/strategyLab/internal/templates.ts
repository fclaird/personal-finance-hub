import {
  listedStrikes,
  nearestStrike,
  type IsoDate,
  type OptionChain,
  type OptionRight,
} from "@/lib/optionChain/chain";
import { nearestDeltaStrike, strikeDeltas } from "@/lib/strategyLab/strikeDelta";

export type StrikeTarget = { readonly by: "strike"; readonly strike: number } | { readonly by: "delta"; readonly delta: number };

type Two = { readonly long: StrikeTarget; readonly short: StrikeTarget };
type Wings = { readonly put: StrikeTarget; readonly call: StrikeTarget };

export type TemplateRequest =
  | ({ readonly template: "callDebit" | "callDebitSpread" | "putDebit" | "callCredit" | "putCredit" | "zebra" } & Two)
  | { readonly template: "longCall" | "longPut" | "cashSecuredPut" | "syntheticLong" | "syntheticShort" | "longStraddle" | "shortStraddle"; readonly strike: StrikeTarget }
  | ({ readonly template: "longStrangle" | "shortStrangle" | "riskReversal" } & Wings)
  | { readonly template: "ironCondor"; readonly putLong: StrikeTarget; readonly putShort: StrikeTarget; readonly callShort: StrikeTarget; readonly callLong: StrikeTarget }
  | { readonly template: "ironButterfly"; readonly low: StrikeTarget; readonly body: StrikeTarget; readonly high: StrikeTarget }
  | { readonly template: "callButterfly" | "putButterfly"; readonly low: StrikeTarget; readonly body: StrikeTarget; readonly high: StrikeTarget }
  | ({ readonly template: "collar" } & Wings)
  | { readonly template: "coveredCall"; readonly call: StrikeTarget }
  | { readonly template: "calendar"; readonly right: OptionRight; readonly front: IsoDate; readonly strike: StrikeTarget }
  | { readonly template: "diagonal"; readonly right: OptionRight; readonly front: IsoDate; readonly frontStrike: StrikeTarget; readonly backStrike: StrikeTarget }
  | { readonly template: "custom"; readonly legs: readonly { readonly right: OptionRight; readonly strike: number; readonly ratio: number }[] };

export const TEMPLATE_CATALOG = [
  { id: "longCall", label: "Long call", group: "Debit" },
  { id: "longPut", label: "Long put", group: "Debit" },
  { id: "callDebit", label: "Call debit spread", group: "Debit" },
  { id: "putDebit", label: "Put debit spread", group: "Debit" },
  { id: "callCredit", label: "Call credit spread", group: "Credit" },
  { id: "putCredit", label: "Put credit spread", group: "Credit" },
  { id: "longStraddle", label: "Long straddle", group: "Volatility" },
  { id: "shortStraddle", label: "Short straddle", group: "Volatility" },
  { id: "longStrangle", label: "Long strangle", group: "Volatility" },
  { id: "shortStrangle", label: "Short strangle", group: "Volatility" },
  { id: "ironCondor", label: "Iron condor", group: "Volatility" },
  { id: "ironButterfly", label: "Iron butterfly", group: "Volatility" },
  { id: "callButterfly", label: "Call butterfly", group: "Volatility" },
  { id: "putButterfly", label: "Put butterfly", group: "Volatility" },
  { id: "syntheticLong", label: "Synthetic long", group: "Stock" },
  { id: "syntheticShort", label: "Synthetic short", group: "Stock" },
  { id: "riskReversal", label: "Risk reversal", group: "Stock" },
  { id: "collar", label: "Collar", group: "Stock" },
  { id: "coveredCall", label: "Covered call", group: "Stock" },
  { id: "cashSecuredPut", label: "Cash-secured put", group: "Stock" },
  { id: "calendar", label: "Calendar", group: "Calendar" },
  { id: "diagonal", label: "Diagonal", group: "Calendar" },
  { id: "zebra", label: "ZEBRA", group: "Debit" },
  { id: "custom", label: "Custom", group: "Custom" },
] as const;

export type TemplateId = (typeof TEMPLATE_CATALOG)[number]["id"];

type Assumptions = { readonly rate: number; readonly dividendYield: number };

export type ResolvedLeg = {
  readonly right: OptionRight | null;
  readonly strike: number | null;
  readonly ratio: number;
  readonly expiry: IsoDate | null;
  readonly stock: boolean;
};

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

function option(right: OptionRight, strike: number, ratio: number, expiry: IsoDate | null = null): ResolvedLeg {
  return { right, strike, ratio, expiry, stock: false };
}

function shares(quantity: number): ResolvedLeg {
  return { right: null, strike: null, ratio: quantity, expiry: null, stock: true };
}

function sameStrike(
  chain: OptionChain,
  expiry: IsoDate,
  target: StrikeTarget,
  assumptions: Assumptions,
): number | string {
  if (target.by === "strike") {
    const strike = target.strike;
    const callListed = listedStrikes(chain, expiry, "C").some((item) => Math.abs(item - strike) < 1e-6);
    const putListed = listedStrikes(chain, expiry, "P").some((item) => Math.abs(item - strike) < 1e-6);
    if (!callListed || !putListed) return "The call and put did not land on the same strike.";
    return strike;
  }
  const call = resolveTarget(chain, expiry, "C", target, assumptions, "lower");
  const put = resolveTarget(chain, expiry, "P", target, assumptions, "lower");
  if (typeof call === "string") return call;
  if (typeof put === "string") return put;
  if (call !== put) return "The call and put did not land on the same strike.";
  return call;
}

function ordered(label: string, strikes: number[], rising: boolean): string | null {
  for (let i = 1; i < strikes.length; i++) {
    if (rising ? strikes[i]! <= strikes[i - 1]! : strikes[i]! >= strikes[i - 1]!) return label;
  }
  return null;
}

/** Turn a template into integer-ratio legs on listed strikes. Stock legs are 100 shares. */
export function resolveTemplate(
  request: TemplateRequest,
  chain: OptionChain,
  expiry: IsoDate,
  assumptions: Assumptions,
): { readonly legs: ResolvedLeg[] } | { readonly error: string } {
  if (request.template === "custom") {
    if (request.legs.length < 1 || request.legs.length > 8) return { error: "A structure has 1 to 8 legs." };
    const legs: ResolvedLeg[] = [];
    for (const leg of request.legs) {
      if (!Number.isInteger(leg.ratio) || leg.ratio === 0) return { error: "Leg ratios are nonzero whole numbers." };
      const strike = resolveTarget(chain, expiry, leg.right, { by: "strike", strike: leg.strike }, assumptions, "lower");
      if (typeof strike === "string") return { error: strike };
      legs.push(option(leg.right, strike, leg.ratio));
    }
    return { legs };
  }

  if (request.template === "longCall" || request.template === "longPut" || request.template === "cashSecuredPut") {
    const right: OptionRight = request.template === "longCall" ? "C" : "P";
    const strike = resolveTarget(chain, expiry, right, request.strike, assumptions, "lower");
    if (typeof strike === "string") return { error: strike };
    const ratio = request.template === "cashSecuredPut" ? -1 : 1;
    return { legs: [option(right, strike, ratio)] };
  }

  if (request.template === "coveredCall") {
    const strike = resolveTarget(chain, expiry, "C", request.call, assumptions, "higher");
    if (typeof strike === "string") return { error: strike };
    return { legs: [shares(100), option("C", strike, -1)] };
  }

  if (
    request.template === "syntheticLong" ||
    request.template === "syntheticShort" ||
    request.template === "longStraddle" ||
    request.template === "shortStraddle"
  ) {
    const strike = sameStrike(chain, expiry, request.strike, assumptions);
    if (typeof strike === "string") return { error: strike };
    if (request.template === "syntheticLong") return { legs: [option("C", strike, 1), option("P", strike, -1)] };
    if (request.template === "syntheticShort") return { legs: [option("C", strike, -1), option("P", strike, 1)] };
    const ratio = request.template === "longStraddle" ? 1 : -1;
    return { legs: [option("C", strike, ratio), option("P", strike, ratio)] };
  }

  if (request.template === "longStrangle" || request.template === "shortStrangle" || request.template === "riskReversal" || request.template === "collar") {
    const putTie = request.template === "shortStrangle" ? "lower" : "lower";
    const callTie = request.template === "shortStrangle" ? "higher" : "higher";
    const put = resolveTarget(chain, expiry, "P", request.put, assumptions, putTie);
    const call = resolveTarget(chain, expiry, "C", request.call, assumptions, callTie);
    if (typeof put === "string") return { error: put };
    if (typeof call === "string") return { error: call };
    if (put >= call) return { error: "The put strike has to sit below the call strike." };
    if (request.template === "longStrangle") return { legs: [option("P", put, 1), option("C", call, 1)] };
    if (request.template === "shortStrangle") return { legs: [option("P", put, -1), option("C", call, -1)] };
    if (request.template === "riskReversal") return { legs: [option("P", put, -1), option("C", call, 1)] };
    return { legs: [shares(100), option("P", put, 1), option("C", call, -1)] };
  }

  if (request.template === "ironCondor") {
    const k1 = resolveTarget(chain, expiry, "P", request.putLong, assumptions, "lower");
    const k2 = resolveTarget(chain, expiry, "P", request.putShort, assumptions, "lower");
    const k3 = resolveTarget(chain, expiry, "C", request.callShort, assumptions, "higher");
    const k4 = resolveTarget(chain, expiry, "C", request.callLong, assumptions, "higher");
    if (typeof k1 === "string") return { error: k1 };
    if (typeof k2 === "string") return { error: k2 };
    if (typeof k3 === "string") return { error: k3 };
    if (typeof k4 === "string") return { error: k4 };
    const order = ordered("Iron condor strikes have to rise: long put, short put, short call, long call.", [k1, k2, k3, k4], true);
    if (order) return { error: order };
    return {
      legs: [option("P", k1, 1), option("P", k2, -1), option("C", k3, -1), option("C", k4, 1)],
    };
  }

  if (request.template === "ironButterfly") {
    const low = resolveTarget(chain, expiry, "P", request.low, assumptions, "lower");
    const bodyPut = resolveTarget(chain, expiry, "P", request.body, assumptions, "lower");
    const bodyCall = resolveTarget(chain, expiry, "C", request.body, assumptions, "lower");
    const high = resolveTarget(chain, expiry, "C", request.high, assumptions, "higher");
    if (typeof low === "string") return { error: low };
    if (typeof bodyPut === "string") return { error: bodyPut };
    if (typeof bodyCall === "string") return { error: bodyCall };
    if (typeof high === "string") return { error: high };
    if (bodyPut !== bodyCall) return { error: "The call and put did not land on the same strike." };
    if (!(low < bodyPut && bodyPut < high)) return { error: "The wings have to sit on either side of the body." };
    return {
      legs: [option("P", low, 1), option("P", bodyPut, -1), option("C", bodyPut, -1), option("C", high, 1)],
    };
  }

  if (request.template === "callButterfly" || request.template === "putButterfly") {
    const right: OptionRight = request.template === "callButterfly" ? "C" : "P";
    const low = resolveTarget(chain, expiry, right, request.low, assumptions, "lower");
    const body = resolveTarget(chain, expiry, right, request.body, assumptions, "lower");
    const high = resolveTarget(chain, expiry, right, request.high, assumptions, "higher");
    if (typeof low === "string") return { error: low };
    if (typeof body === "string") return { error: body };
    if (typeof high === "string") return { error: high };
    if (!(low < body && body < high)) return { error: "A butterfly needs a lower wing, a body, and an upper wing." };
    if (Math.abs(body - low - (high - body)) > 1e-6) return { error: "Butterfly wings have to be the same width." };
    return { legs: [option(right, low, 1), option(right, body, -2), option(right, high, 1)] };
  }

  if (request.template === "calendar") {
    const back = resolveTarget(chain, expiry, request.right, request.strike, assumptions, "lower");
    const front = resolveTarget(chain, request.front, request.right, request.strike, assumptions, "lower");
    if (typeof back === "string") return { error: back };
    if (typeof front === "string") return { error: front };
    if (front !== back) return { error: "A calendar uses one strike on both expiries." };
    if (request.front >= expiry) return { error: "The front expiry has to come before the back expiry." };
    return { legs: [option(request.right, front, -1, request.front), option(request.right, back, 1, null)] };
  }

  if (request.template === "diagonal") {
    const front = resolveTarget(chain, request.front, request.right, request.frontStrike, assumptions, request.right === "C" ? "higher" : "lower");
    const back = resolveTarget(chain, expiry, request.right, request.backStrike, assumptions, "lower");
    if (typeof front === "string") return { error: front };
    if (typeof back === "string") return { error: back };
    if (request.front >= expiry) return { error: "The front expiry has to come before the back expiry." };
    const otm = request.right === "C" ? front > back : front < back;
    if (!otm) return { error: "The front strike has to be further out of the money than the back strike." };
    return { legs: [option(request.right, front, -1, request.front), option(request.right, back, 1, null)] };
  }

  if (!("long" in request) || !("short" in request)) return { error: "That template is not supported." };
  const spreadRight: OptionRight = request.template === "putDebit" || request.template === "putCredit" ? "P" : "C";
  const long = resolveTarget(chain, expiry, spreadRight, request.long, assumptions, "lower");
  const short = resolveTarget(chain, expiry, spreadRight, request.short, assumptions, "higher");
  if (typeof long === "string") return { error: long };
  if (typeof short === "string") return { error: short };
  if (long === short) return { error: "The long and short strikes collapsed onto one contract." };
  const low = Math.min(long, short);
  const high = Math.max(long, short);
  if (request.template === "zebra" || request.template === "callDebit" || request.template === "callDebitSpread") {
    if (long >= short) return { error: "The long strike has to sit below the short strike." };
    return { legs: [option("C", long, request.template === "zebra" ? 2 : 1), option("C", short, -1)] };
  }
  if (request.template === "putDebit") {
    if (!(long > short)) return { error: "The long put has to sit above the short put." };
    return { legs: [option("P", high, 1), option("P", low, -1)] };
  }
  if (request.template === "callCredit") {
    if (!(short < long)) return { error: "The short call has to sit below the long call." };
    return { legs: [option("C", low, -1), option("C", high, 1)] };
  }
  if (!(short > long)) return { error: "The short put has to sit above the long put." };
  return { legs: [option("P", low, 1), option("P", high, -1)] };
}

function target(strike: number): StrikeTarget {
  return { by: "strike", strike };
}

/** Prefill a catalog template from the strikes the form is showing. */
export function catalogRequest(input: {
  readonly template: TemplateId;
  readonly expiry: IsoDate;
  readonly front: IsoDate | null;
  readonly right: OptionRight;
  readonly strikes: readonly number[];
  readonly shortStrangleDelta: boolean;
}): TemplateRequest | { readonly error: string } {
  const [a = 0, b = 0, c = 0, d = 0] = input.strikes;
  const template = input.template;
  if (template === "longCall" || template === "longPut" || template === "cashSecuredPut" || template === "syntheticLong" || template === "syntheticShort" || template === "longStraddle" || template === "shortStraddle") {
    return { template, strike: target(a) };
  }
  if (template === "callDebit" || template === "zebra") return { template, long: target(a), short: target(b) };
  if (template === "putDebit") return { template, long: target(b), short: target(a) };
  if (template === "callCredit") return { template, long: target(b), short: target(a) };
  if (template === "putCredit") return { template, long: target(a), short: target(b) };
  if (template === "shortStrangle" && input.shortStrangleDelta) {
    return { template, put: { by: "delta", delta: 0.15 }, call: { by: "delta", delta: 0.15 } };
  }
  if (template === "longStrangle" || template === "shortStrangle" || template === "riskReversal" || template === "collar") {
    return { template, put: target(a), call: target(b) };
  }
  if (template === "ironCondor") return { template, putLong: target(a), putShort: target(b), callShort: target(c), callLong: target(d) };
  if (template === "ironButterfly" || template === "callButterfly" || template === "putButterfly") {
    return { template, low: target(a), body: target(b), high: target(c) };
  }
  if (template === "coveredCall") return { template, call: target(a) };
  if (template === "calendar") {
    if (!input.front) return { error: "Pick a front expiry." };
    return { template, right: input.right, front: input.front, strike: target(a) };
  }
  if (template === "diagonal") {
    if (!input.front) return { error: "Pick a front expiry." };
    return { template, right: input.right, front: input.front, frontStrike: target(a), backStrike: target(b) };
  }
  return { template: "custom", legs: [{ right: "C", strike: a, ratio: 1 }] };
}
