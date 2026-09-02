/**
 * Chinese wall: Schwab Trader order endpoints stay dark unless Chris
 * explicitly sets FINANCE_HUB_ALLOW_BROKER_ORDERS=1.
 */

const ORDER_PATH = /(?:^|\/)(?:orders|previewOrder)(?:\/|$|\?)/i;

export function isBrokerOrderWriteAuthorized(): boolean {
  return process.env.FINANCE_HUB_ALLOW_BROKER_ORDERS === "1";
}

export function traderPathLooksLikeOrder(path: string): boolean {
  return ORDER_PATH.test(path);
}

export function isSafeTraderReadMethod(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** Throws if this call could place, preview, cancel, or replace a broker order. */
export function assertSchwabTraderCallAllowed(path: string, method?: string): void {
  const orderish = traderPathLooksLikeOrder(path);
  const write = !isSafeTraderReadMethod(method);
  if (!orderish && !write) return;
  if (orderish || (write && orderish)) {
    if (isBrokerOrderWriteAuthorized()) return;
    throw new Error(
      "Chinese wall: Schwab order endpoints are disabled. FINANCE_HUB_ALLOW_BROKER_ORDERS is not set.",
    );
  }
  if (write && !isBrokerOrderWriteAuthorized()) {
    throw new Error(
      `Chinese wall: non-GET Schwab Trader calls are disabled (${(method ?? "POST").toUpperCase()} ${path}).`,
    );
  }
}
