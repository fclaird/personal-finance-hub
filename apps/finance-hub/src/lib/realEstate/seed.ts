import type Database from "better-sqlite3";

export const CORTLAND_ID = "re_cortland";
export const CROWNSVILLE_ID = "re_crownsville";
export const CORTLAND_OWNER = "Christopher R. and Brittany L. Laird";

/** Replaced on startup only when this exact seeded value is still stored. */
const CORTLAND_OWNER_PREVIOUS = "Icarus Kaizen Strategies Limited";

export const CORTLAND_CAVEAT =
  "Public estimates exclude the recent addition until this property is appraised. The house is 3131 McCleary Jacoby Rd and the side lot is 3210 McCleary Jacoby Rd. 3141 McCleary Jacoby Rd is only the mailing address.";

const CORTLAND_PURCHASE_ID = "reval_cortland_purchase";
const CROWNSVILLE_PURCHASE_ID = "reval_crownsville_purchase";
const CROWNSVILLE_LOAN_ID = "re_loan_crownsville";
const CROWNSVILLE_ESTIMATE_ID = "rebal_crownsville_estimate";

/** Insert the two owned properties once. Later edits and deletes are left alone. */
export function seedRealEstate(db: Database.Database): void {
  const insertProperty = db.prepare(`
    INSERT OR IGNORE INTO real_estate_properties (
      id, flavor, label, street, city, state, postal_code, mailing_street, owner_name,
      status, estimate_caveat, hpi_place_id, created_at, updated_at
    ) VALUES (
      @id, 'main', @label, @street, @city, @state, @postal_code, @mailing_street, @owner_name,
      'active', @estimate_caveat, @hpi_place_id, datetime('now'), datetime('now')
    )
  `);
  const insertParcel = db.prepare(`
    INSERT OR IGNORE INTO real_estate_parcels (id, property_id, apn, county, state, role, street)
    VALUES (@id, @property_id, @apn, @county, @state, @role, @street)
  `);
  const insertValuation = db.prepare(`
    INSERT OR IGNORE INTO real_estate_valuations (
      id, property_id, as_of, value_usd, low_usd, high_usd, source, source_detail, source_url, is_anchor, notes
    ) VALUES (
      @id, @property_id, @as_of, @value_usd, NULL, NULL, 'purchase', 'purchase', NULL, 0, @notes
    )
  `);
  const insertLoan = db.prepare(`
    INSERT OR IGNORE INTO real_estate_loans (
      id, property_id, lender, original_principal, interest_rate, term_months, start_date, monthly_payment, details_complete
    ) VALUES (
      @id, @property_id, NULL, NULL, NULL, NULL, NULL, NULL, 0
    )
  `);
  const insertBalance = db.prepare(`
    INSERT OR IGNORE INTO real_estate_loan_balances (id, loan_id, as_of, balance_usd, source, notes)
    VALUES (@id, @loan_id, @as_of, @balance_usd, 'owner_estimate', @notes)
  `);

  const tx = db.transaction(() => {
    insertProperty.run({
      id: CORTLAND_ID,
      label: "Cortland",
      street: "3131 McCleary Jacoby Rd",
      city: "Cortland",
      state: "OH",
      postal_code: "44410",
      mailing_street: "3141 McCleary Jacoby Rd",
      owner_name: CORTLAND_OWNER,
      estimate_caveat: CORTLAND_CAVEAT,
      hpi_place_id: "49660",
    });
    insertProperty.run({
      id: CROWNSVILLE_ID,
      label: "Crownsville",
      street: "714 Old Herald Harbor Rd",
      city: "Crownsville",
      state: "MD",
      postal_code: "21032",
      mailing_street: null,
      owner_name: null,
      estimate_caveat: null,
      hpi_place_id: "12580",
    });
    insertParcel.run({
      id: "reparcel_cortland_house",
      property_id: CORTLAND_ID,
      apn: "33-039430",
      county: "Trumbull",
      state: "OH",
      role: "house",
      street: "3131 McCleary Jacoby Rd",
    });
    insertParcel.run({
      id: "reparcel_cortland_lot",
      property_id: CORTLAND_ID,
      apn: "33-039431",
      county: "Trumbull",
      state: "OH",
      role: "side_lot",
      street: "3210 McCleary Jacoby Rd",
    });
    insertParcel.run({
      id: "reparcel_crownsville",
      property_id: CROWNSVILLE_ID,
      apn: "02-000-90045139",
      county: "Anne Arundel",
      state: "MD",
      role: "house",
      street: "714 Old Herald Harbor Rd",
    });
    insertValuation.run({
      id: CORTLAND_PURCHASE_ID,
      property_id: CORTLAND_ID,
      as_of: "2025-10-09",
      value_usd: 239_000,
      notes: "Purchase price for the house and side lot. Reference only, not a value anchor.",
    });
    insertValuation.run({
      id: CROWNSVILLE_PURCHASE_ID,
      property_id: CROWNSVILLE_ID,
      as_of: "2024-06-21",
      value_usd: 818_700,
      notes: "Purchase price. Reference only, not a value anchor.",
    });
    insertLoan.run({ id: CROWNSVILLE_LOAN_ID, property_id: CROWNSVILLE_ID });
    insertBalance.run({
      id: CROWNSVILLE_ESTIMATE_ID,
      loan_id: CROWNSVILLE_LOAN_ID,
      as_of: "2026-10-06",
      balance_usd: 745_000,
      notes: "Owner estimate of about $745,000. Terms not entered, so this balance is not amortized.",
    });
    db.prepare(
      `UPDATE real_estate_properties
       SET owner_name = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_name = ?`,
    ).run(CORTLAND_OWNER, CORTLAND_ID, CORTLAND_OWNER_PREVIOUS);
  });
  tx();
}
