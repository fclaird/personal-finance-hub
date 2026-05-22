/** Shared option label formatting (matches PositionsGroupedTable display). */

export type OptionDisplayRow = {
  symbol: string;
  underlyingSymbol: string | null;
  effectiveUnderlyingSymbol?: string | null;
  optionExpiration: string | null;
  optionRight: "C" | "P" | null;
  optionStrike: number | null;
};

function formatExpiry(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const yy = m[1]!.slice(2);
  const mm = Number(m[2]!);
  const dd = m[3]!;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[mm - 1] ?? "???";
  return `${dd} ${mon} ${yy}`;
}

export function formatOptionSymbolDisplay(r: OptionDisplayRow): string {
  const u = (r.effectiveUnderlyingSymbol ?? r.underlyingSymbol ?? r.symbol).trim() || r.symbol;
  const exp = r.optionExpiration ? formatExpiry(r.optionExpiration) : "?";
  const right = r.optionRight ?? "?";
  const strike =
    r.optionStrike == null ? "?" : r.optionStrike % 1 === 0 ? String(r.optionStrike) : r.optionStrike.toFixed(2);
  return `${u} ${exp} ${right} ${strike}`;
}
