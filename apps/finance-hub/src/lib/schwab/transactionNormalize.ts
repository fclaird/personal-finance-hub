/** Normalize Schwab Trader API transaction objects into DB-ready fields. */

export type SchwabTxnInstrument = {
  symbol?: string;
  underlyingSymbol?: string;
  assetType?: string;
  putCall?: string;
  strikePrice?: number;
  description?: string;
};

export type SchwabTxnItem = {
  instruction?: string;
  positionEffect?: string;
  price?: number;
  amount?: number;
  cost?: number;
  quantity?: number;
  instrument?: SchwabTxnInstrument;
};

export type SchwabTxnRaw = {
  activityId?: number;
  transactionId?: number;
  time?: string;
  tradeDate?: string;
  settlementDate?: string;
  type?: string;
  description?: string;
  netAmount?: number;
  transactionItem?: SchwabTxnItem[];
  transferItems?: SchwabTxnItem[];
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function itemsOf(tx: SchwabTxnRaw): SchwabTxnItem[] {
  const a = tx.transactionItem;
  if (Array.isArray(a) && a.length) return a;
  const b = tx.transferItems;
  if (Array.isArray(b) && b.length) return b;
  return [];
}

export function externalActivityId(tx: SchwabTxnRaw): string | null {
  if (tx.activityId != null && Number.isFinite(tx.activityId)) return String(tx.activityId);
  if (tx.transactionId != null && Number.isFinite(tx.transactionId)) return String(tx.transactionId);
  return null;
}

export function tradeDateIso(tx: SchwabTxnRaw): string | null {
  const d = (tx.tradeDate ?? tx.time ?? tx.settlementDate ?? "").toString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (tx.time) {
    const t = new Date(tx.time);
    if (!Number.isNaN(t.getTime())) return t.toISOString().slice(0, 10);
  }
  return null;
}

export type NormalizedBrokerTransaction = {
  external_activity_id: string;
  trade_date: string;
  transaction_type: string | null;
  description: string | null;
  net_amount: number | null;
  raw_json: string;
  symbol: string | null;
  underlying_symbol: string | null;
  asset_type: string | null;
  instruction: string | null;
  position_effect: string | null;
  quantity: number | null;
  price: number | null;
  option_expiration: string | null;
  option_right: string | null;
  option_strike: number | null;
  leg_count: number;
};

export function normalizeSchwabTransaction(tx: SchwabTxnRaw): NormalizedBrokerTransaction | null {
  const ext = externalActivityId(tx);
  const date = tradeDateIso(tx);
  if (!ext || !date) return null;

  const items = itemsOf(tx);
  const first = items[0];
  const inst = first?.instrument;
  const assetType = (inst?.assetType ?? "").toUpperCase() || null;
  const symbol = inst?.symbol?.trim() || null;
  const underlying = inst?.underlyingSymbol?.trim() || null;

  let optionExpiration: string | null = null;
  let optionRight: string | null = null;
  let optionStrike: number | null = null;
  if (assetType === "OPTION" && symbol) {
    const s = symbol.replace(/\s+/g, " ").trim();
    const m = s.match(/([0-9]{6})([CP])([0-9]{8})$/);
    if (m) {
      const yy = Number(m[1]!.slice(0, 2));
      const mm = Number(m[1]!.slice(2, 4));
      const dd = Number(m[1]!.slice(4, 6));
      const year = 2000 + yy;
      optionExpiration = `${year.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
      optionRight = m[2] === "C" ? "C" : "P";
      optionStrike = Number(m[3]!) / 1000;
    } else if (inst?.putCall && inst.strikePrice != null) {
      optionRight = inst.putCall.toUpperCase().startsWith("P") ? "P" : "C";
      optionStrike = inst.strikePrice;
    }
  }

  const qty = asNumber(first?.quantity) ?? asNumber(first?.amount);
  const price = asNumber(first?.price);
  const net = asNumber(tx.netAmount);

  return {
    external_activity_id: ext,
    trade_date: date,
    transaction_type: tx.type ?? null,
    description: tx.description ?? null,
    net_amount: net,
    raw_json: JSON.stringify(tx),
    symbol,
    underlying_symbol: underlying,
    asset_type: assetType,
    instruction: first?.instruction?.toUpperCase() ?? null,
    position_effect: first?.positionEffect?.toUpperCase() ?? null,
    quantity: qty,
    price,
    option_expiration: optionExpiration,
    option_right: optionRight,
    option_strike: optionStrike,
    leg_count: Math.max(1, items.length),
  };
}
