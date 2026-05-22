import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contentHashFromBody,
  extractDollarTickers,
  extractFirstUrl,
  parseIngestText,
  titleFromBody,
} from "./parseIngestText";

describe("parseIngestText", () => {
  it("extracts URL and builds title from first line", () => {
    const text = "Fed holds rates steady\nFull story https://example.com/article?q=1\nMore detail";
    const p = parseIngestText(text);
    assert.ok(p);
    assert.equal(p!.title, "Fed holds rates steady");
    assert.equal(p!.link, "https://example.com/article?q=1");
    assert.ok(p!.body.includes("More detail"));
  });

  it("uses synthetic link when no URL", () => {
    const p = parseIngestText("PLTR wins new contract");
    assert.ok(p);
    assert.ok(p!.link.startsWith("app://news/caktusjxck/"));
  });

  it("stable content hash for same body", () => {
    const a = contentHashFromBody("  Hello   world  ");
    const b = contentHashFromBody("Hello world");
    assert.equal(a, b);
  });

  it("extracts dollar tickers", () => {
    assert.deepEqual(extractDollarTickers("Big move in $TSLA and $AAPL today"), ["TSLA", "AAPL"]);
  });

  it("title truncates long first line", () => {
    const long = "x".repeat(250);
    assert.ok(titleFromBody(long).endsWith("…"));
  });

  it("extractFirstUrl strips trailing punctuation", () => {
    assert.equal(extractFirstUrl("See https://foo.com/bar)."), "https://foo.com/bar");
  });
});
