import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";
import type { SituationMemberView } from "@/lib/situations/apiTypes";

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
};

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
  };
}

/** Format a wall-clock fill time in America/New_York when we have an ISO timestamp. */
export function formatFillWhen(tradeDate: string, tradeTime: string | null): string {
  if (tradeTime) {
    const ms = Date.parse(tradeTime);
    if (Number.isFinite(ms)) {
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
  // Date-only fallback
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

/** One human line for a single fill. */
export function formatFillLine(m: SituationMemberView): string {
  const f = resolveFill(m);
  const qty = f.quantity != null ? `${Math.abs(f.quantity)}× ` : "";
  const px = f.price != null && Number.isFinite(f.price) ? ` @ $${f.price.toFixed(2)}` : "";
  return `${f.underlying} ${qty}${formatStrikeRight(f.strike, f.right)} · exp ${formatExpiry(f.expiration)} · ${f.action} ${formatFillWhen(f.tradeDate, f.tradeTime)}${px}`;
}

/** Combined adjustment: close legs → open legs with a single net. */
export function formatAdjustmentSummary(
  closeMembers: SituationMemberView[],
  openMembers: SituationMemberView[],
): { label: string; net: number | null; when: string } {
  const closes = closeMembers.map(resolveFill);
  const opens = openMembers.map(resolveFill);
  const und =
    closes[0]?.underlying ??
    opens[0]?.underlying ??
    "—";
  const closeBits = closes
    .map((f) => formatStrikeRight(f.strike, f.right))
    .join("/");
  const openBits = opens
    .map((f) => formatStrikeRight(f.strike, f.right))
    .join("/");
  const whenSrc = [...closeMembers, ...openMembers][0];
  const when = whenSrc
    ? formatFillWhen(whenSrc.tradeDate, whenSrc.tradeTime)
    : "—";
  let net: number | null = null;
  let saw = false;
  for (const m of [...closeMembers, ...openMembers]) {
    if (m.netAmount != null && Number.isFinite(m.netAmount)) {
      net = (net ?? 0) + m.netAmount;
      saw = true;
    }
  }
  if (saw && net != null) net = Math.round(net * 100) / 100;
  const label =
    closeBits && openBits
      ? `${und} adjust ${closeBits} → ${openBits} · ${when}`
      : closeBits
        ? `${und} close ${closeBits} · ${when}`
        : `${und} open ${openBits} · ${when}`;
  return { label, net: saw ? net : null, when };
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
