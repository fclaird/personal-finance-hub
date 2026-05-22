export type SchwabConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getSchwabConfig(): SchwabConfig {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId) throw new Error("Missing env var: SCHWAB_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing env var: SCHWAB_CLIENT_SECRET");
  if (!redirectUri) throw new Error("Missing env var: SCHWAB_REDIRECT_URI");

  return { clientId, clientSecret, redirectUri };
}

export const SCHWAB_OAUTH_AUTHORIZE_URL = "https://api.schwabapi.com/v1/oauth/authorize";
export const SCHWAB_OAUTH_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const SCHWAB_TRADER_API_BASE = "https://api.schwabapi.com/trader/v1";
export const SCHWAB_MARKETDATA_API_BASE = "https://api.schwabapi.com/marketdata/v1";

/** Schwab documents a ~60-day max span per transactions request; chunk slightly under that. */
export const SCHWAB_TRANSACTION_CHUNK_DAYS = 59;

/**
 * Default calendar depth for TRADE history sync. Schwab returns empty for unavailable periods;
 * we chunk backward until this many days are covered (many API calls: ceil(days / chunk) per account).
 */
export const DEFAULT_TRANSACTION_LOOKBACK_DAYS = 5000;

/** Hard cap for optional `lookbackDays` on POST /api/schwab/transactions/sync. */
export const MAX_TRANSACTION_LOOKBACK_DAYS = 10_000;

