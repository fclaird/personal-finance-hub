/** Shared OCC / Schwab option parsing and instruction helpers. */

export const LEAP_MIN_DTE = 365;
export const EARNINGS_WINDOW_DAYS = 5;

export type OptionRight = "C" | "P";
export type InstructionKind = "buy_open" | "buy_close" | "sell_open" | "sell_close" | "unknown";

export type ParsedOccOption = {
  underlying: string | null;
  expiration: string;
  right: OptionRight;
  strike: number;
};

export function daysBetween(isoA: string, isoB: string): number | null {
  const a = new Date(`${isoA}T12:00:00Z`).getTime();
  const b = new Date(`${isoB}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(Math.round((a - b) / (24 * 3600 * 1000)));
}

export function optionDte(tradeDateIso: string, expirationIso: string | null): number | null {
  if (!expirationIso) return null;
  return daysBetween(tradeDateIso, expirationIso);
}

/** Parse Schwab/OCC option symbol, e.g. "AAPL  260117P00150000". */
export function parseOptionFromSchwabSymbol(symbol: string | null | undefined): ParsedOccOption | null {
  if (!symbol) return null;
  const s = symbol.replace(/\s+/g, " ").trim();
  const m = s.match(/^(?:(.+?)\s+)?([0-9]{6})([CP])([0-9]{8})$/);
  if (!m) return null;
  const yy = Number(m[2]!.slice(0, 2));
  const mm = Number(m[2]!.slice(2, 4));
  const dd = Number(m[2]!.slice(4, 6));
  const year = 2000 + yy;
  const expiration = `${year.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  const root = (m[1] ?? "").trim();
  return {
    underlying: root ? root.toUpperCase() : null,
    expiration,
    right: m[3] === "C" ? "C" : "P",
    strike: Number(m[4]!) / 1000,
  };
}

export function instructionKind(inst: string | null | undefined): InstructionKind {
  if (!inst) return "unknown";
  const u = inst.toUpperCase();
  if (u.includes("BUY_TO_OPEN") || u === "BUY TO OPEN") return "buy_open";
  if (u.includes("BUY_TO_CLOSE") || u === "BUY TO CLOSE") return "buy_close";
  if (u.includes("SELL_TO_OPEN") || (u.includes("SELL") && u.includes("OPEN"))) return "sell_open";
  if (u.includes("SELL_TO_CLOSE") || (u.includes("SELL") && u.includes("CLOSE"))) return "sell_close";
  if (u === "SELL") return "sell_open";
  if (u === "BUY") return "buy_open";
  return "unknown";
}

export function positionIsOpening(effect: string | null | undefined, instKind: InstructionKind): boolean {
  const e = (effect ?? "").toUpperCase();
  if (e === "OPENING") return true;
  if (e === "CLOSING") return false;
  return instKind === "buy_open" || instKind === "sell_open";
}

export function isShortPremiumInstruction(kind: InstructionKind): boolean {
  return kind === "sell_open";
}

export function isCloseInstruction(kind: InstructionKind): boolean {
  return kind === "buy_close" || kind === "sell_close";
}
