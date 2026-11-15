import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  JOURNAL_SIZE_LIMIT_BYTES,
  WAL_AUTOCHECKPOINT_PAGES,
  applyRuntimePragmas,
  checkpointWalPassive,
} from "./dbPragmas";

describe("sqlite wal pragmas", () => {
  it("does not rewrite the main database on every commit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-wal-"));
    const dbPath = path.join(dir, "hub.sqlite");
    const walPath = `${dbPath}-wal`;
    const db = new Database(dbPath);
    try {
      applyRuntimePragmas(db);
      assert.equal(db.pragma("wal_autocheckpoint", { simple: true }), WAL_AUTOCHECKPOINT_PAGES);
      assert.equal(db.pragma("synchronous", { simple: true }), 1);
      assert.equal(db.pragma("journal_size_limit", { simple: true }), JOURNAL_SIZE_LIMIT_BYTES);

      db.exec("CREATE TABLE ticks (id INTEGER PRIMARY KEY, body TEXT)");
      const insert = db.prepare("INSERT INTO ticks (body) VALUES (?)");
      const mainAfterCreate = fs.statSync(dbPath).size;
      const payload = "q".repeat(400);
      for (let i = 0; i < 2_000; i++) insert.run(payload);

      const mainAfterInserts = fs.statSync(dbPath).size;
      const walAfterInserts = fs.statSync(walPath).size;
      assert.ok(walAfterInserts > 0);
      // Autocheckpoint would have folded those frames back into the main file.
      assert.ok(
        mainAfterInserts - mainAfterCreate < 64 * 1024,
        `main db grew ${mainAfterInserts - mainAfterCreate} bytes during inserts`,
      );

      const folded = checkpointWalPassive(db);
      assert.equal(folded.busy, 0);
      assert.ok(folded.log > 0);
      assert.equal(folded.checkpointed, folded.log);
      const walAfter = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      assert.ok(walAfter <= JOURNAL_SIZE_LIMIT_BYTES);
      assert.ok(walAfter <= walAfterInserts);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
