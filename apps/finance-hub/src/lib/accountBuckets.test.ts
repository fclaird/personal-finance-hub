import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  accountBucketLabel,
  bucketFromAccount,
  bucketFromDisplayName,
  isValidAccountBucket,
} from "./accountBuckets";

describe("accountBuckets", () => {
  it("bucketFromDisplayName detects 529, IRA, and brokerage", () => {
    assert.equal(bucketFromDisplayName("Utah 529 Plan"), "529");
    assert.equal(bucketFromDisplayName("Roth IRA"), "retirement");
    assert.equal(bucketFromDisplayName("Individual Brokerage"), "brokerage");
  });

  it("bucketFromAccount prefers explicit account_bucket column", () => {
    assert.equal(bucketFromAccount("Taxable", null, "529"), "529");
    assert.equal(bucketFromAccount("Roth IRA", null, "brokerage"), "brokerage");
    assert.equal(bucketFromAccount("Some Name", "401k", "retirement"), "retirement");
  });

  it("bucketFromAccount falls back to nickname then name", () => {
    assert.equal(bucketFromAccount("External", "529 College", null), "529");
    assert.equal(bucketFromAccount("Traditional IRA", null, null), "retirement");
    assert.equal(bucketFromAccount("Fidelity Taxable", null, null), "brokerage");
  });

  it("isValidAccountBucket and accountBucketLabel", () => {
    assert.equal(isValidAccountBucket("529"), true);
    assert.equal(isValidAccountBucket("other"), false);
    assert.equal(accountBucketLabel("529"), "529");
    assert.equal(accountBucketLabel("retirement"), "Retirement");
    assert.equal(accountBucketLabel("brokerage"), "Brokerage");
  });
});
