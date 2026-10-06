import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { resolveOfficialSeries } from "@/lib/realEstate/resolveValue";
import { seedRealEstate } from "@/lib/realEstate/seed";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../db/schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  return db;
}

describe("real estate seed", () => {
  it("stores Cortland as 3131 plus the 3210 side lot, with 3141 only as mailing", () => {
    const db = memoryDb();
    seedRealEstate(db);
    const property = db
      .prepare(
        `SELECT street, mailing_street AS mailingStreet, owner_name AS ownerName, postal_code AS postalCode
         FROM real_estate_properties WHERE id = 're_cortland'`,
      )
      .get() as { street: string; mailingStreet: string; ownerName: string; postalCode: string };
    assert.equal(property.street, "3131 McCleary Jacoby Rd");
    assert.equal(property.mailingStreet, "3141 McCleary Jacoby Rd");
    assert.equal(property.ownerName, "Icarus Kaizen Strategies Limited");
    assert.equal(property.postalCode, "44410");
    const parcels = db
      .prepare(`SELECT apn, role, street FROM real_estate_parcels WHERE property_id = 're_cortland' ORDER BY apn`)
      .all() as Array<{ apn: string; role: string; street: string }>;
    assert.deepEqual(parcels, [
      { apn: "33-039430", role: "house", street: "3131 McCleary Jacoby Rd" },
      { apn: "33-039431", role: "side_lot", street: "3210 McCleary Jacoby Rd" },
    ]);
    const purchase = db
      .prepare(
        `SELECT as_of AS asOf, value_usd AS valueUsd, source, is_anchor AS isAnchor
         FROM real_estate_valuations WHERE property_id = 're_cortland'`,
      )
      .get() as { asOf: string; valueUsd: number; source: string; isAnchor: number };
    assert.equal(purchase.asOf, "2025-10-09");
    assert.equal(purchase.valueUsd, 239_000);
    assert.equal(purchase.source, "purchase");
    assert.equal(purchase.isAnchor, 0);
    const inputs = db
      .prepare(
        `SELECT id, as_of AS asOf, value_usd AS valueUsd, low_usd AS lowUsd, high_usd AS highUsd, source, source_detail AS sourceDetail
         FROM real_estate_valuations WHERE property_id = 're_cortland'`,
      )
      .all();
    assert.equal(resolveOfficialSeries(inputs as never, [], "2026-10").length, 0);
    db.close();
  });

  it("stores Crownsville ZIP, SDAT account, purchase, and the incomplete mortgage", () => {
    const db = memoryDb();
    seedRealEstate(db);
    const property = db
      .prepare(`SELECT street, postal_code AS postalCode FROM real_estate_properties WHERE id = 're_crownsville'`)
      .get() as { street: string; postalCode: string };
    assert.equal(property.street, "714 Old Herald Harbor Rd");
    assert.equal(property.postalCode, "21032");
    const parcel = db
      .prepare(`SELECT apn, county FROM real_estate_parcels WHERE property_id = 're_crownsville'`)
      .get() as { apn: string; county: string };
    assert.equal(parcel.apn, "02-000-90045139");
    assert.equal(parcel.county, "Anne Arundel");
    const purchase = db
      .prepare(`SELECT as_of AS asOf, value_usd AS valueUsd, is_anchor AS isAnchor FROM real_estate_valuations WHERE property_id = 're_crownsville'`)
      .get() as { asOf: string; valueUsd: number; isAnchor: number };
    assert.equal(purchase.asOf, "2024-06-21");
    assert.equal(purchase.valueUsd, 818_700);
    assert.equal(purchase.isAnchor, 0);
    const loan = db
      .prepare(
        `SELECT l.details_complete AS detailsComplete, b.balance_usd AS balanceUsd, b.source
         FROM real_estate_loans l JOIN real_estate_loan_balances b ON b.loan_id = l.id
         WHERE l.property_id = 're_crownsville'`,
      )
      .get() as { detailsComplete: number; balanceUsd: number; source: string };
    assert.equal(loan.detailsComplete, 0);
    assert.equal(loan.balanceUsd, 745_000);
    assert.equal(loan.source, "owner_estimate");
    db.close();
  });
});
