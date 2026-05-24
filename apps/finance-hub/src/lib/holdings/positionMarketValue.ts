/** Effective position market value: stored MV, else price × quantity. */
export const POSITION_MARKET_VALUE_SQL = "COALESCE(p.market_value, p.price * p.quantity, 0)";
