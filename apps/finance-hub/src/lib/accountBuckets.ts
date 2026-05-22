export type AccountBucket = "brokerage" | "retirement";

const IRA_WORD_RE = /\bIRA\b/i;

export function bucketFromDisplayName(displayName: string): AccountBucket {
  const s = (displayName ?? "").trim();
  return IRA_WORD_RE.test(s) ? "retirement" : "brokerage";
}

export function bucketFromAccount(name: string, nickname: string | null): AccountBucket {
  return bucketFromDisplayName((nickname ?? "").trim() || (name ?? "").trim());
}

