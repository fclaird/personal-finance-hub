/** Schwab accounts owned by Aurora Finance Hub — excluded from parent Finance Hub sync and analytics. */
export const AURORA_EXCLUSIVE_ACCOUNT_IDS = ["schwab_94558855"] as const;

export function isAuroraExclusiveAccountId(id: string | null | undefined): boolean {
  if (!id) return false;
  return (AURORA_EXCLUSIVE_ACCOUNT_IDS as readonly string[]).includes(id);
}

export function notAuroraExclusiveWhereSql(alias: string): string {
  const list = AURORA_EXCLUSIVE_ACCOUNT_IDS.map((id) => `'${id}'`).join(", ");
  return `${alias}.id NOT IN (${list})`;
}
