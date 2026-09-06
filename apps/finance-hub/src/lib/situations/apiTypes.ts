import type { SituationLinkStatus, SituationMemberRole } from "@/lib/situations/types";

export type SituationMemberView = {
  transactionId: string;
  role: SituationMemberRole;
  tradeDate: string;
  /** ISO timestamp from Schwab when available (e.g. 2026-09-04T18:21:28+0000). */
  tradeTime: string | null;
  symbol: string | null;
  underlying: string | null;
  expiration: string | null;
  right: "C" | "P" | null;
  strike: number | null;
  /** Fill price per share. */
  price: number | null;
  quantity: number | null;
  positionEffect: string | null;
  netAmount: number | null;
  instruction: string | null;
  description: string | null;
  /** Schwab order id when present (used to clump partial fills). */
  orderId: string | null;
  /** Contract delta at fill (call +ve, put −ve); null when spot/IV unavailable. */
  deltaAtFill: number | null;
};

export type SituationView = {
  id: string;
  accountId: string;
  accountName: string;
  underlying: string;
  kind: string;
  status: string;
  linkStatus: SituationLinkStatus;
  openedOn: string;
  closedOn: string | null;
  netPremium: number | null;
  title: string;
  members: SituationMemberView[];
};

export function situationKindMatchesTab(kind: string, tab: "short-strangles" | "butterflies"): boolean {
  if (tab === "short-strangles") return kind === "short-strangle";
  return kind === "butterfly";
}

export function rolePhaseLabel(role: SituationMemberRole): string {
  switch (role) {
    case "open":
      return "Open";
    case "roll_close":
      return "Roll close";
    case "roll_open":
      return "Roll open";
    case "close":
      return "Close";
    case "leg":
      return "Leg";
    default:
      return "Adjust";
  }
}
