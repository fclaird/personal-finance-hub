/** Client-safe helper — keep free of server/db imports. */
export function isManualAccountId(accountId: string): boolean {
  return accountId.startsWith("manual_");
}
