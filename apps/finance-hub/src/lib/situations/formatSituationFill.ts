import { nyCalendarIso } from "@/lib/analytics/allocationNyDate";
import { parseOptionFromSchwabSymbol, optionDte } from "@/lib/strategy/optionParse";
import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { parseTradeTimeMs } from "@/lib/situations/fillDelta";

export type ResolvedFill = {
  underlying: string;
  right: "C" | "P" | null;
  strike: number | null;
  expiration: string | null;
  tradeDate: string;
  tradeTime: string | null;
  price: number | null;
  quantity: number | null;
  netAmount: number | null;
  positionEffect: string | null;
  action: "opened" | "closed" | "adjusted";
  deltaAtFill: number | null;
  dteAtFill: number | null;
};

/** Calendar trade date in America/New_York when we have a timestamp; else tradeDate. */
export function tradeCalendarDate(tradeDate: string, tradeTime: string | null): string {
  const ms = parseTradeTimeMs(tradeTime, tradeDate);
  if (ms != null) return nyCalendarIso(new Date(ms));
  return tradeDate.slice(0, 10);
}

export function dteAtTrade(tradeDate: string, tradeTime: string | null, expiration: string | null): number | null {
  if (!expiration) return null;
  return optionDte(tradeCalendarDate(tradeDate, tradeTime), expiration.slice(0, 10));
}

/** Live DTE from today (NY calendar) to an option expiration. */
export function liveDte(expiration: string | null, now: Date = new Date()): number | null {
  if (!expiration) return null;
  return optionDte(nyCalendarIso(now), expiration.slice(0, 10));
}

export function resolveFill(m: SituationMemberView): ResolvedFill {
  const parsed = parseOptionFromSchwabSymbol(m.symbol);
  const right = m.right ?? parsed?.right ?? null;
  const strike = m.strike ?? parsed?.strike ?? null;
  const expiration = m.expiration ?? parsed?.expiration ?? null;
  const underlying =
    (m.underlying ?? parsed?.underlying ?? "").trim().toUpperCase() ||
    (m.symbol ?? "").trim().split(/\s+/)[0]?.toUpperCase() ||
    "—";
  const effect = (m.positionEffect ?? "").toUpperCase();
  const action: ResolvedFill["action"] =
    m.role === "roll_close" || m.role === "close" || effect === "CLOSING"
      ? "closed"
      : m.role === "roll_open" || m.role === "open" || effect === "OPENING"
        ? "opened"
        : "adjusted";
  const dte = dteAtTrade(m.tradeDate, m.tradeTime, expiration);
  return {
    underlying,
    right,
    strike,
    expiration,
    tradeDate: m.tradeDate,
    tradeTime: m.tradeTime,
    price: m.price,
    quantity: m.quantity,
    netAmount: m.netAmount,
    positionEffect: m.positionEffect,
    action,
    deltaAtFill: m.deltaAtFill ?? null,
    dteAtFill: dte,
  };
}

/** @deprecated Wall-clock fill time — prefer DTE in fill lines. Kept for tests/legacy. */
export function formatFillWhen(tradeDate: string, tradeTime: string | null): string {
  if (tradeTime) {
    const ms = parseTradeTimeMs(tradeTime, tradeDate);
    if (ms != null) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ms));
    }
  }
  const d = Date.parse(`${tradeDate}T12:00:00Z`);
  if (!Number.isFinite(d)) return tradeDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
}

export function formatExpiry(expiration: string | null): string {
  if (!expiration) return "—";
  const d = Date.parse(`${expiration}T12:00:00Z`);
  if (!Number.isFinite(d)) return expiration;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
}

export function formatStrikeRight(strike: number | null, right: "C" | "P" | null): string {
  if (strike == null) return right === "C" ? "call" : right === "P" ? "put" : "option";
  const s = Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/\.?0+$/, "");
  if (right === "C") return `${s}C`;
  if (right === "P") return `${s}P`;
  return s;
}

export function formatDte(dte: number | null): string | null {
  if (dte == null || !Number.isFinite(dte)) return null;
  return `${Math.round(dte)} DTE`;
}

export function formatDelta(delta: number | null | undefined): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const rounded = Math.round(delta * 100) / 100;
  const abs = Math.abs(rounded).toFixed(2);
  const sign = rounded < 0 ? "−" : rounded > 0 ? "" : "";
  return `Δ ${sign}${abs}`;
}

/** One human line for a single fill — identity + DTE + Δ + price (no calendar noise). */
export function formatFillLine(m: SituationMemberView): string {
  const f = resolveFill(m);
  const qty = f.quantity != null ? `${Math.abs(f.quantity)}× ` : "";
  const parts = [
    `${f.underlying} ${qty}${formatStrikeRight(f.strike, f.right)}`,
    f.action,
  ];
  const dte = formatDte(f.dteAtFill);
  if (dte) parts.push(dte);
  const delta = formatDelta(f.deltaAtFill);
  const px = f.price != null && Number.isFinite(f.price) ? `@ $${f.price.toFixed(2)}` : null;
  if (delta && px) parts.push(`${delta} ${px}`);
  else if (delta) parts.push(delta);
  else if (px) parts.push(px);
  return parts.join(" · ");
}

function representativeDte(members: SituationMemberView[]): number | null {
  for (const m of members) {
    const d = dteAtTrade(m.tradeDate, m.tradeTime, resolveFill(m).expiration);
    if (d != null) return d;
  }
  return null;
}

/** Combined adjustment: close legs → open legs with DTE from→to (not calendar when). */
export function formatAdjustmentSummary(
  closeMembers: SituationMemberView[],
  openMembers: SituationMemberView[],
): { label: string; net: number | null; when: string; dteLabel: string | null } {
  const closes = closeMembers.map(resolveFill);
  const opens = openMembers.map(resolveFill);
  const und = closes[0]?.underlying ?? opens[0]?.underlying ?? "—";
  const closeBits = closes.map((f) => formatStrikeRight(f.strike, f.right)).join("/");
  const openBits = opens.map((f) => formatStrikeRight(f.strike, f.right)).join("/");

  const fromDte = representativeDte(closeMembers);
  const toDte = representativeDte(openMembers);
  let dteLabel: string | null = null;
  if (fromDte != null && toDte != null && fromDte !== toDte) {
    dteLabel = `${Math.round(fromDte)} DTE → ${Math.round(toDte)} DTE`;
  } else if (toDte != null) {
    dteLabel = formatDte(toDte);
  } else if (fromDte != null) {
    dteLabel = formatDte(fromDte);
  }

  let net: number | null = null;
  let saw = false;
  for (const m of [...closeMembers, ...openMembers]) {
    if (m.netAmount != null && Number.isFinite(m.netAmount)) {
      net = (net ?? 0) + m.netAmount;
      saw = true;
    }
  }
  if (saw && net != null) net = Math.round(net * 100) / 100;

  const core =
    closeBits && openBits
      ? `${und} adjust ${closeBits} → ${openBits}`
      : closeBits
        ? `${und} close ${closeBits}`
        : `${und} open ${openBits}`;
  const label = dteLabel ? `${core} · ${dteLabel}` : core;
  return { label, net: saw ? net : null, when: dteLabel ?? "—", dteLabel };
}

/** Live tip label: DTE to current structure expiration(s). */
export function formatCurrentDteLabel(symbols: string[], now: Date = new Date()): string | null {
  const dtes: number[] = [];
  const seen = new Set<string>();
  for (const sym of symbols) {
    const parsed = parseOptionFromSchwabSymbol(sym);
    if (!parsed?.expiration || seen.has(parsed.expiration)) continue;
    seen.add(parsed.expiration);
    const d = liveDte(parsed.expiration, now);
    if (d != null) dtes.push(d);
  }
  if (dtes.length === 0) return null;
  if (dtes.length === 1) return formatDte(dtes[0]!);
  return dtes.map((d) => formatDte(d)!).join(" / ");
}

export function sumMemberNets(members: SituationMemberView[]): number | null {
  let sum = 0;
  let saw = false;
  for (const m of members) {
    if (m.netAmount != null && Number.isFinite(m.netAmount)) {
      sum += m.netAmount;
      saw = true;
    }
  }
  return saw ? Math.round(sum * 100) / 100 : null;
}
