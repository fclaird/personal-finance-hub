import { getDb } from "@/lib/db";

import { advToLiquidityScore, computeOpportunityScore, computeIvRankPct } from "@/lib/earnings/scoring";

export type EarningsRow = {
  id: string;
  symbol: string;
  earnings_date: string;
  fiscal_period_end: string | null;
  time_of_day: string | null;
  source: string;
  iv_current: number | null;
  iv_52w_high: number | null;
  iv_52w_low: number | null;
  iv_rank_pct: number | null;
  hist_vol_30d: number | null;
  iv_over_hist_vol: number | null;
  avg_dollar_volume_20d: number | null;
  dollar_liquidity_score: number | null;
  opportunity_score: number | null;
  metrics_source: string | null;
  metrics_updated_at: string | null;
};

export function eventId(symbol: string, earningsDate: string): string {
  return `earn_${symbol.toUpperCase().replace(/[^A-Z0-9]/g, "")}_${earningsDate}`;
}

export function metricsId(eventIdVal: string): string {
  return `earnmet_${eventIdVal}`;
}

export function upsertEarningsEvent(params: {
  symbol: string;
  earningsDate: string;
  fiscalPeriodEnd?: string | null;
  timeOfDay?: string | null;
  source: string;
  rawJson?: string | null;
}): string {
  const db = getDb();
  const id = eventId(params.symbol, params.earningsDate);
  const securityRow = db
    .prepare(`SELECT id FROM securities WHERE UPPER(symbol) = UPPER(?) AND security_type = 'equity' LIMIT 1`)
    .get(params.symbol) as { id: string } | undefined;

  db.prepare(
    `
    INSERT INTO earnings_events (id, symbol, security_id, earnings_date, fiscal_period_end, time_of_day, source, raw_json, updated_at)
    VALUES (@id, @symbol, @security_id, @earnings_date, @fiscal_period_end, @time_of_day, @source, @raw_json, datetime('now'))
    ON CONFLICT(symbol, earnings_date) DO UPDATE SET
      fiscal_period_end = excluded.fiscal_period_end,
      time_of_day = excluded.time_of_day,
      source = excluded.source,
      raw_json = COALESCE(excluded.raw_json, earnings_events.raw_json),
      security_id = COALESCE(excluded.security_id, earnings_events.security_id),
      updated_at = datetime('now')
  `,
  ).run({
    id,
    symbol: params.symbol.toUpperCase(),
    security_id: securityRow?.id ?? null,
    earnings_date: params.earningsDate,
    fiscal_period_end: params.fiscalPeriodEnd ?? null,
    time_of_day: params.timeOfDay ?? null,
    source: params.source,
    raw_json: params.rawJson ?? null,
  });

  return id;
}

export function upsertMetrics(params: {
  earningsEventId: string;
  ivCurrent?: number | null;
  iv52wHigh?: number | null;
  iv52wLow?: number | null;
  histVol30d?: number | null;
  /** When set (including `null`), replaces stored value; omit to keep existing. */
  avgDollarVolume20d?: number | null;
  metricsSource: string;
}): void {
  const db = getDb();
  const id = metricsId(params.earningsEventId);
  const existing = db
    .prepare(
      `SELECT iv_current, iv_52w_high, iv_52w_low, hist_vol_30d, avg_dollar_volume_20d
       FROM earnings_opp_metrics WHERE earnings_event_id = ?`,
    )
    .get(params.earningsEventId) as
    | {
        iv_current: number | null;
        iv_52w_high: number | null;
        iv_52w_low: number | null;
        hist_vol_30d: number | null;
        avg_dollar_volume_20d: number | null;
      }
    | undefined;

  const ivc = params.ivCurrent ?? existing?.iv_current ?? null;
  const ivh = params.iv52wHigh ?? existing?.iv_52w_high ?? null;
  const ivl = params.iv52wLow ?? existing?.iv_52w_low ?? null;
  const histV = params.histVol30d ?? existing?.hist_vol_30d ?? null;
  const adv =
    params.avgDollarVolume20d !== undefined ? params.avgDollarVolume20d : existing?.avg_dollar_volume_20d ?? null;

  const ivOhv = ivc != null && histV != null && histV > 1e-9 ? ivc / histV : null;

  const ivRank = ivc != null && ivh != null && ivl != null ? computeIvRankPct(ivc, ivh, ivl) : null;

  const dollarLiq = adv != null && adv > 0 ? advToLiquidityScore(adv) : null;
  const score = computeOpportunityScore(ivRank, dollarLiq);

  db.prepare(
    `
    INSERT INTO earnings_opp_metrics (
      id, earnings_event_id, as_of,
      iv_current, iv_52w_high, iv_52w_low, iv_rank_pct, hist_vol_30d, iv_over_hist_vol,
      avg_share_volume_20d, avg_share_volume_5d, volume_ratio,
      session_volume, relative_volume_index,
      avg_dollar_volume_20d, dollar_liquidity_score,
      opportunity_score, metrics_source, updated_at
    )
    VALUES (
      @id, @earnings_event_id, datetime('now'),
      @iv_current, @iv_52w_high, @iv_52w_low, @iv_rank_pct, @hist_vol_30d, @iv_over_hist_vol,
      NULL, NULL, NULL,
      NULL, NULL,
      @avg_dollar_volume_20d, @dollar_liquidity_score,
      @opportunity_score, @metrics_source, datetime('now')
    )
    ON CONFLICT(earnings_event_id) DO UPDATE SET
      as_of = excluded.as_of,
      iv_current = COALESCE(excluded.iv_current, earnings_opp_metrics.iv_current),
      iv_52w_high = COALESCE(excluded.iv_52w_high, earnings_opp_metrics.iv_52w_high),
      iv_52w_low = COALESCE(excluded.iv_52w_low, earnings_opp_metrics.iv_52w_low),
      iv_rank_pct = COALESCE(excluded.iv_rank_pct, earnings_opp_metrics.iv_rank_pct),
      hist_vol_30d = COALESCE(excluded.hist_vol_30d, earnings_opp_metrics.hist_vol_30d),
      iv_over_hist_vol = COALESCE(excluded.iv_over_hist_vol, earnings_opp_metrics.iv_over_hist_vol),
      avg_share_volume_20d = NULL,
      avg_share_volume_5d = NULL,
      volume_ratio = NULL,
      session_volume = NULL,
      relative_volume_index = NULL,
      avg_dollar_volume_20d = COALESCE(excluded.avg_dollar_volume_20d, earnings_opp_metrics.avg_dollar_volume_20d),
      dollar_liquidity_score = COALESCE(excluded.dollar_liquidity_score, earnings_opp_metrics.dollar_liquidity_score),
      opportunity_score = excluded.opportunity_score,
      metrics_source = excluded.metrics_source,
      updated_at = datetime('now')
  `,
  ).run({
    id,
    earnings_event_id: params.earningsEventId,
    iv_current: ivc,
    iv_52w_high: ivh,
    iv_52w_low: ivl,
    iv_rank_pct: ivRank,
    hist_vol_30d: histV,
    iv_over_hist_vol: ivOhv,
    avg_dollar_volume_20d: adv,
    dollar_liquidity_score: dollarLiq,
    opportunity_score: score,
    metrics_source: params.metricsSource,
  });
}

export function listEarningsRanked(fromDate: string, toDate: string): EarningsRow[] {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        e.id,
        e.symbol,
        e.earnings_date,
        e.fiscal_period_end,
        e.time_of_day,
        e.source,
        m.iv_current,
        m.iv_52w_high,
        m.iv_52w_low,
        m.iv_rank_pct,
        m.hist_vol_30d,
        m.iv_over_hist_vol,
        m.avg_dollar_volume_20d,
        m.dollar_liquidity_score,
        m.opportunity_score,
        m.metrics_source,
        m.updated_at AS metrics_updated_at
      FROM earnings_events e
      LEFT JOIN earnings_opp_metrics m ON m.earnings_event_id = e.id
      WHERE e.earnings_date >= @from_date AND e.earnings_date <= @to_date
      ORDER BY COALESCE(m.opportunity_score, 0) DESC, e.earnings_date ASC, e.symbol ASC
    `,
    )
    .all({ from_date: fromDate, to_date: toDate }) as EarningsRow[];
}

export function deleteDemoEarnings(): void {
  const db = getDb();
  db.prepare(`DELETE FROM earnings_events WHERE source = 'demo'`).run();
}

/** Demo rows for UI / offline testing (no API keys). */
export function seedDemoEarnings(): number {
  const today = new Date();
  const mkDate = (dplus: number) => {
    const d = new Date(today.getTime() + dplus * 86400000);
    return d.toISOString().slice(0, 10);
  };

  const samples: Array<{
    sym: string;
    day: number;
    iv: number;
    hi: number;
    lo: number;
    /** Rough 20d avg $ volume / day for liquidity tiering (not spike-based). */
    adv20dUsd: number;
    t: string;
  }> = [
    { sym: "NBIS", day: 3, iv: 0.92, hi: 1.0, lo: 0.35, adv20dUsd: 180e6, t: "amc" },
    { sym: "PLTR", day: 5, iv: 0.78, hi: 0.95, lo: 0.4, adv20dUsd: 1.1e9, t: "bmo" },
    { sym: "TSLA", day: 7, iv: 0.85, hi: 0.9, lo: 0.45, adv20dUsd: 22e9, t: "amc" },
    { sym: "RKLB", day: 10, iv: 0.72, hi: 0.88, lo: 0.38, adv20dUsd: 450e6, t: "bmo" },
    { sym: "BMNR", day: 12, iv: 0.88, hi: 0.92, lo: 0.5, adv20dUsd: 120e6, t: "amc" },
    { sym: "ORCL", day: 14, iv: 0.55, hi: 0.75, lo: 0.3, adv20dUsd: 900e6, t: "bmo" },
    { sym: "AAPL", day: 18, iv: 0.42, hi: 0.55, lo: 0.22, adv20dUsd: 9e9, t: "amc" },
    { sym: "MSFT", day: 20, iv: 0.38, hi: 0.5, lo: 0.2, adv20dUsd: 5e9, t: "bmo" },
  ];

  let n = 0;
  for (const s of samples) {
    const ed = mkDate(s.day);
    const eid = upsertEarningsEvent({
      symbol: s.sym,
      earningsDate: ed,
      fiscalPeriodEnd: null,
      timeOfDay: s.t,
      source: "demo",
      rawJson: null,
    });
    const histV = Math.min(0.95, Math.max(0.12, s.iv * 0.7));
    upsertMetrics({
      earningsEventId: eid,
      ivCurrent: s.iv,
      iv52wHigh: s.hi,
      iv52wLow: s.lo,
      histVol30d: histV,
      avgDollarVolume20d: s.adv20dUsd,
      metricsSource: "demo",
    });
    n++;
  }
  return n;
}
