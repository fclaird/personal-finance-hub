import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { isoDateInUsEastern } from "@/lib/market/glanceSession";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { portfolioDailyReturnPct } from "@/lib/terminal/portfolioCashFlows";

const RTH_CLOSE_MIN = 16 * 60;

export type PortfolioSessionValuation = {
  /** Liquidation used for day % and the indexed headline. Live during RTH; session close when cash is shut. */
  netValueForReturn: number;
  seriesThroughMs: number;
  lockedToSessionClose: boolean;
  changePct: number | null;
};

/**
 * Outside the regular session, Schwab liquidation can collapse (option marks go to 0)
 * or disagree with the cash close. The portfolio day % then prints a wild number.
 * Lock the return to the last Schwab snapshot at or before 16:00 ET on the session
 * the glance is showing, plus external holdings. During RTH, use the live total.
 */
export function selectPortfolioSessionValuation(args: {
  now: Date;
  sessionYmd: string;
  netValue: number;
  priorNetValue: number;
  netCashFlow: number;
  externalCurrent: number;
  schwabIntraday: Array<{ tsMs: number; total: number }>;
}): PortfolioSessionValuation {
  const flow = Number.isFinite(args.netCashFlow) ? args.netCashFlow : 0;
  if (isUsEquityRegularSessionOpen(args.now)) {
    return {
      netValueForReturn: args.netValue,
      seriesThroughMs: args.now.getTime(),
      lockedToSessionClose: false,
      changePct: portfolioDailyReturnPct(args.netValue, args.priorNetValue, flow),
    };
  }

  const closeMs = nyWallTimeMs(args.sessionYmd, RTH_CLOSE_MIN);
  let schwabAtClose: number | null = null;
  let schwabAtCloseTs = -Infinity;
  for (const pt of args.schwabIntraday) {
    if (!Number.isFinite(pt.tsMs) || !Number.isFinite(pt.total)) continue;
    if (pt.tsMs > closeMs) continue;
    if (isoDateInUsEastern(pt.tsMs) !== args.sessionYmd) continue;
    if (pt.tsMs >= schwabAtCloseTs) {
      schwabAtCloseTs = pt.tsMs;
      schwabAtClose = pt.total;
    }
  }

  if (schwabAtClose == null) {
    return {
      netValueForReturn: args.netValue,
      seriesThroughMs: args.now.getTime(),
      lockedToSessionClose: false,
      changePct: portfolioDailyReturnPct(args.netValue, args.priorNetValue, flow),
    };
  }

  const external = Number.isFinite(args.externalCurrent) ? args.externalCurrent : 0;
  const netValueForReturn = schwabAtClose + external;
  return {
    netValueForReturn,
    seriesThroughMs: closeMs,
    lockedToSessionClose: true,
    changePct: portfolioDailyReturnPct(netValueForReturn, args.priorNetValue, flow),
  };
}
