import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seriesReactKey, structureDisplayNames } from "@/lib/strategyLab/displayNames";

describe("structure display names", () => {
  it("leaves a unique label alone and numbers later copies", () => {
    const names = structureDisplayNames([
      { id: "s1", label: "ZEBRA" },
      { id: "s2", label: "Spread" },
      { id: "s3", label: "ZEBRA" },
      { id: "s4", label: "ZEBRA" },
    ]);
    assert.equal(names.get("s1"), "ZEBRA");
    assert.equal(names.get("s2"), "Spread");
    assert.equal(names.get("s3"), "ZEBRA (2)");
    assert.equal(names.get("s4"), "ZEBRA (3)");
  });

  it("keys a tooltip row by structure and horizon, not the shared name", () => {
    assert.equal(seriesReactKey({ dataKey: "s3@@q:expiry:2027-01-15", name: "ZEBRA" }, 0), "s3@@q:expiry:2027-01-15:0");
    assert.notEqual(
      seriesReactKey({ dataKey: "s1@@h", name: "ZEBRA" }, 0),
      seriesReactKey({ dataKey: "s3@@h", name: "ZEBRA" }, 1),
    );
  });
});
