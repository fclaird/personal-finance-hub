import type { SituationLinkStatus, SituationMemberRole } from "@/lib/situations/types";

export type SituationMemberView = {
  transactionId: string;
  role: SituationMemberRole;
  tradeDate: string;
  symbol: string | null;
  netAmount: number | null;
  instruction: string | null;
  description: string | null;
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
