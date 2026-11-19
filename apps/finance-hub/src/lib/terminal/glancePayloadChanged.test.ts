import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { glancePayloadChanged, type GlancePayload } from "./glanceCache";

const payload = {
  ok: true,
  session: {
    headline: "Open",
    detail: "RTH",
    isOpen: true,
    sessionYmd: "2026-11-16",
    chartYmd: "2026-11-16",
    sessionLabel: "Mon",
    showingPriorSession: false,
  },
  items: [],
  alternateGlanceItems: [],
  futuresGlanceItems: [],
  updatedAt: "2026-11-16T15:00:00.000Z",
} satisfies GlancePayload;

describe("glancePayloadChanged", () => {
  it("ignores a newer updatedAt when the body is the same", () => {
    const stored = JSON.stringify(payload);
    const next = { ...payload, updatedAt: "2026-11-16T15:01:00.000Z" };
    assert.equal(glancePayloadChanged(stored, next), false);
    assert.equal(
      glancePayloadChanged(stored, { ...next, session: { ...next.session, headline: "Closed" } }),
      true,
    );
    assert.equal(glancePayloadChanged(null, next), true);
  });
});
