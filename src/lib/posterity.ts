export const POSTERITY_ACCOUNT_IDS = ["schwab_50138076", "schwab_94558855"] as const;

export function isPosterityAccountId(id: string | null | undefined): boolean {
  if (!id) return false;
  return (POSTERITY_ACCOUNT_IDS as readonly string[]).includes(id);
}

export function notPosterityWhereSql(alias: string): string {
  const list = POSTERITY_ACCOUNT_IDS.map((id) => `'${id}'`).join(", ");
  return `${alias}.id NOT IN (${list})`;
}

