export type SituationKind =
  | "short-strangle"
  | "short-put"
  | "short-call"
  | "covered-call"
  | "butterfly"
  | "spread"
  | "leap"
  | "long-option"
  | "other";

export type SituationStatus = "open" | "closed";
export type SituationLinkStatus = "auto" | "proposed" | "confirmed" | "rejected";
export type SituationMemberRole = "open" | "roll_close" | "roll_open" | "close" | "leg";

export type SituationMember = {
  transactionId: string;
  role: SituationMemberRole;
};

export type ProposedSituation = {
  accountId: string;
  underlying: string;
  kind: SituationKind;
  linkStatus: Extract<SituationLinkStatus, "auto" | "proposed">;
  status: SituationStatus;
  openedOn: string;
  closedOn: string | null;
  title: string;
  members: SituationMember[];
  netPremium: number | null;
};

export type LinkableLeg = {
  symbol: string;
  underlying: string;
  expiration: string | null;
  right: "C" | "P" | null;
  strike: number | null;
  instruction: "buy_open" | "buy_close" | "sell_open" | "sell_close" | "unknown";
  opening: boolean;
  quantity: number | null;
};

export type LinkableTxn = {
  id: string;
  accountId: string;
  tradeDate: string;
  netAmount: number | null;
  legs: LinkableLeg[];
};
