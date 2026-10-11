import type { WatchFiring } from "@/lib/alerts/watchAlerts";

/** Copy for a local browser notification. The page decides whether the browser will show it. */
export function localNoticeCopy(firing: Pick<WatchFiring, "title" | "symbol">): { title: string; body: string } {
  return {
    title: firing.title,
    body: `${firing.symbol} · Financial Bridge`,
  };
}
