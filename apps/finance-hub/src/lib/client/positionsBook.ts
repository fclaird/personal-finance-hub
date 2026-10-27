export type PositionsBookPosition = {
  accountId: string;
  symbol?: string | null;
  securityType?: string;
  underlyingSymbol?: string | null;
  effectiveUnderlyingSymbol?: string | null;
  marketValue?: number | null;
  metadataJson?: string | null;
  schwabDayProfitLoss?: number | null;
};

export type PositionsBookAccount = {
  id: string;
  name: string;
  nickname: string | null;
  accountBucket: string | null;
};

export type PositionsBook = {
  ok: boolean;
  error?: string;
  asOf?: string;
  stale?: boolean;
  refreshing?: boolean;
  positions?: PositionsBookPosition[];
  accounts?: PositionsBookAccount[];
  nonIndividualSecuritySymbols?: string[];
};

const CLIENT_FRESH_MS = 15_000;

export function positionsForAccount<T extends { accountId: string }>(rows: readonly T[], accountId: string): T[] {
  return rows.filter((row) => row.accountId === accountId);
}

/**
 * One in-flight `/api/positions` for the whole book. Callers split by account locally.
 * `refresh` asks the server cache to rebuild and replaces the client copy.
 */
export function createPositionsBookClient(fetchImpl: typeof fetch, now: () => number = Date.now) {
  let cached: { at: number; body: PositionsBook } | null = null;
  let inflight: Promise<PositionsBook> | null = null;

  async function load(opts?: { refresh?: boolean }): Promise<PositionsBook> {
    const refresh = opts?.refresh === true;
    if (!refresh && cached && now() - cached.at < CLIENT_FRESH_MS) return cached.body;
    if (!refresh && inflight) return inflight;
    const url = refresh ? "/api/positions?refresh=1" : "/api/positions";
    const run = fetchImpl(url, { cache: "no-store" }).then(async (resp) => {
      const body = (await resp.json()) as PositionsBook;
      if (resp.ok && body.ok !== false) cached = { at: now(), body };
      return body;
    });
    if (!refresh) {
      inflight = run.finally(() => {
        if (inflight === run) inflight = null;
      });
      return inflight;
    }
    return run;
  }

  return { load };
}

const browserClient = createPositionsBookClient(globalThis.fetch.bind(globalThis));

export function loadPositionsBook(opts?: { refresh?: boolean }): Promise<PositionsBook> {
  return browserClient.load(opts);
}
