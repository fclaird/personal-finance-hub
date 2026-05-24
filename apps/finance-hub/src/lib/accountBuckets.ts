export type AccountBucket = "brokerage" | "retirement" | "529";

/** Bucket keys used in allocation / exposure analytics (excludes combined net). */
export type AnalyticsBucketKey = "brokerage" | "retirement" | "529";

const IRA_WORD_RE = /\bIRA\b/i;
const RETIREMENT_RE = /\b(401\s*k|403\s*b|457|roth|sep|pension|retire)\b/i;
const PLAN_529_RE = /\b529\b/i;

export function bucketFromDisplayName(displayName: string): AccountBucket {
  const s = (displayName ?? "").trim();
  if (PLAN_529_RE.test(s)) return "529";
  if (IRA_WORD_RE.test(s) || RETIREMENT_RE.test(s)) return "retirement";
  return "brokerage";
}

export function bucketFromAccount(
  name: string,
  nickname: string | null,
  explicitBucket?: string | null,
): AccountBucket {
  const b = (explicitBucket ?? "").trim().toLowerCase();
  if (b === "529" || b === "retirement" || b === "brokerage") return b;
  return bucketFromDisplayName((nickname ?? "").trim() || (name ?? "").trim());
}

export function isValidAccountBucket(v: unknown): v is AccountBucket {
  return v === "brokerage" || v === "retirement" || v === "529";
}

export function accountBucketLabel(bucket: AccountBucket): string {
  if (bucket === "529") return "529";
  if (bucket === "retirement") return "Retirement";
  return "Brokerage";
}
