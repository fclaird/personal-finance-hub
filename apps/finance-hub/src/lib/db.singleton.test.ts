import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "./db";

describe("process sqlite handle", () => {
  it("reuses the process-wide connection instead of opening another", () => {
    const pragmas: string[] = [];
    const sentinel = {
      pragma(sql: string) {
        pragmas.push(sql);
        return [];
      },
    };
    const previous = globalThis.__fhSqlite;
    globalThis.__fhSqlite = sentinel as unknown as typeof globalThis.__fhSqlite;
    try {
      assert.equal(getDb(), sentinel);
      assert.equal(getDb(), sentinel);
      assert.ok(pragmas.some((sql) => sql.startsWith("wal_autocheckpoint")));
      const afterFirst = pragmas.length;
      getDb();
      assert.equal(pragmas.length, afterFirst);
    } finally {
      if (previous) globalThis.__fhSqlite = previous;
      else delete globalThis.__fhSqlite;
    }
  });
});
