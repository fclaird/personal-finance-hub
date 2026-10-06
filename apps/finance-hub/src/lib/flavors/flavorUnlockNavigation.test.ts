import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FLAVOR_IDS } from "@/lib/flavor";
import { defaultNavHref } from "@/lib/flavors/registry";

describe("flavor unlock navigation", () => {
  it("loads each flavor's default page with a document navigation", () => {
    const srcPath = fileURLToPath(new URL("../../app/connections/connections-client.tsx", import.meta.url));
    const src = fs.readFileSync(srcPath, "utf8");
    const start = src.indexOf("function onFlavorUnlocked");
    const end = src.indexOf("const pendingFlavorLabel");
    const fn = src.slice(start, end);
    assert.equal(fn.includes('router.push("/terminal")'), false);
    assert.match(fn, /location\.assign\(defaultNavHref\(unlocked\)\)/);
    assert.deepEqual(
      FLAVOR_IDS.map((id) => defaultNavHref(id)),
      ["/terminal", "/terminal", "/terminal"],
    );
  });
});
