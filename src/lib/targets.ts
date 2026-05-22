import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

export type Target = {
  assetClass: string;
  targetWeight: number; // 0..1
};

export function getGlobalTargets(): Target[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT asset_class, target_weight
      FROM target_allocations
      WHERE scope = 'global'
      ORDER BY asset_class ASC
    `,
    )
    .all() as Array<{ asset_class: string; target_weight: number }>;

  return rows.map((r) => ({ assetClass: r.asset_class, targetWeight: r.target_weight }));
}

export function setGlobalTargets(targets: Target[]) {
  const db = getDb();
  const del = db.prepare(`DELETE FROM target_allocations WHERE scope = 'global'`);
  const ins = db.prepare(`
    INSERT INTO target_allocations (id, scope, asset_class, target_weight, updated_at)
    VALUES (@id, 'global', @asset_class, @target_weight, datetime('now'))
  `);

  const tx = db.transaction(() => {
    del.run();
    for (const t of targets) {
      ins.run({
        id: newId("tgt"),
        asset_class: t.assetClass,
        target_weight: t.targetWeight,
      });
    }
  });
  tx();
}

