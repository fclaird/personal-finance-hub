import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FLAVOR_IDS, parseFlavor } from "@/lib/flavor";
import { defaultNavHref, isPathAllowedForFlavor } from "@/lib/flavors/registry";
import {
  flavorCookieSecure,
  flavorCookieSentTo,
  flavorUnlockFailureLocation,
  isDocumentUnlock,
  planFlavorUnlock,
  sameHostPath,
  unlockFollowRequest,
} from "@/lib/flavors/flavorUnlockNavigation";

function headers(init: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

function middlewareAllows(pathname: string, flavorValue: string | null): boolean {
  const flavor = parseFlavor(flavorValue);
  if (!flavor) return pathname === "/connections" || pathname.startsWith("/connections/");
  return isPathAllowedForFlavor(pathname, flavor);
}

describe("flavor unlock navigation", () => {
  it("sends fh_flavor on the first document hop to the flavor home", () => {
    const from = new URL("https://127.0.0.1:3000/api/flavor");
    for (const id of FLAVOR_IDS) {
      const plan = planFlavorUnlock({ document: true, flavor: id, passwordOk: true, secure: true });
      assert.equal(plan.kind, "document-ok");
      if (plan.kind !== "document-ok") continue;
      assert.equal(plan.status, 303);
      assert.equal(plan.location, defaultNavHref(id));
      assert.equal(plan.location.startsWith("/"), true);
      assert.equal(plan.location.includes("localhost"), false);
      assert.equal(plan.cookie.httpOnly, true);
      assert.equal(plan.cookie.path, "/");
      assert.equal(plan.cookie.sameSite, "lax");
      assert.equal(plan.cookie.secure, true);
      const next = unlockFollowRequest(from, plan.location);
      assert.equal(next.hostname, "127.0.0.1");
      assert.equal(next.pathname, defaultNavHref(id));
      assert.equal(flavorCookieSentTo(plan.cookie, from, next), true);
      assert.equal(middlewareAllows(next.pathname, plan.flavor), true);
    }
  });

  it("does not send a 127.0.0.1 cookie to an absolute localhost redirect", () => {
    const from = new URL("https://127.0.0.1:3000/api/flavor");
    const plan = planFlavorUnlock({ document: true, flavor: "main", passwordOk: true, secure: true });
    assert.equal(plan.kind, "document-ok");
    if (plan.kind !== "document-ok") return;
    const localhost = new URL("https://localhost:3000/terminal");
    assert.equal(flavorCookieSentTo(plan.cookie, from, localhost), false);
    assert.equal(middlewareAllows("/terminal", null), false);
    assert.throws(() => sameHostPath(localhost.toString()));
    assert.throws(() => sameHostPath("//localhost/terminal"));
  });

  it("keeps a wrong password on connections without setting the cookie", () => {
    const plan = planFlavorUnlock({ document: true, flavor: "main", passwordOk: false, secure: true });
    assert.deepEqual(plan, {
      kind: "document-error",
      status: 303,
      location: flavorUnlockFailureLocation("main"),
    });
    assert.equal(plan.kind === "document-error" && plan.location.startsWith("/connections?"), true);
    assert.equal(middlewareAllows("/connections", null), true);
    const missing = planFlavorUnlock({ document: true, flavor: null, passwordOk: false, secure: false });
    assert.equal(missing.kind, "document-error");
  });

  it("sets Secure only when the browser connection is https", () => {
    assert.equal(flavorCookieSecure({ url: "https://127.0.0.1:3000/api/flavor", headers: headers({}) }), true);
    assert.equal(flavorCookieSecure({ url: "http://127.0.0.1:3000/api/flavor", headers: headers({}) }), false);
    assert.equal(
      flavorCookieSecure({
        url: "http://127.0.0.1:3000/api/flavor",
        headers: headers({ "x-forwarded-proto": "https" }),
      }),
      true,
    );
    assert.equal(
      flavorCookieSecure({
        url: "https://localhost:3000/api/flavor",
        headers: headers({ "x-forwarded-proto": "http" }),
      }),
      false,
    );
    const httpPlan = planFlavorUnlock({ document: true, flavor: "peyton", passwordOk: true, secure: false });
    assert.equal(httpPlan.kind, "document-ok");
    if (httpPlan.kind === "document-ok") {
      assert.equal(httpPlan.cookie.secure, false);
      const from = new URL("http://127.0.0.1:3049/api/flavor");
      const next = unlockFollowRequest(from, httpPlan.location);
      assert.equal(flavorCookieSentTo(httpPlan.cookie, from, next), true);
    }
  });

  it("leaves JSON unlocks as JSON and treats a password form as a document navigation", () => {
    const json = planFlavorUnlock({ document: false, flavor: "main", passwordOk: true, secure: true });
    assert.equal(json.kind, "json-ok");
    const denied = planFlavorUnlock({ document: false, flavor: "main", passwordOk: false, secure: true });
    assert.deepEqual(denied, { kind: "json-error", status: 401, error: "Incorrect password" });
    assert.equal(isDocumentUnlock({ headers: headers({ "sec-fetch-dest": "document" }) }), true);
    assert.equal(
      isDocumentUnlock({ headers: headers({ "content-type": "application/x-www-form-urlencoded" }) }),
      true,
    );
    assert.equal(
      isDocumentUnlock({ headers: headers({ "content-type": "application/json", "sec-fetch-dest": "empty" }) }),
      false,
    );
  });

  it("posts the password form and sets the cookie on that response", () => {
    const dialog = fs.readFileSync(
      fileURLToPath(new URL("../../app/components/FlavorPasswordDialog.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(dialog, /method="POST"/);
    assert.match(dialog, /action="\/api\/flavor"/);
    assert.equal(dialog.includes("fetch("), false);
    assert.equal(dialog.includes("location.assign"), false);

    const connections = fs.readFileSync(
      fileURLToPath(new URL("../../app/connections/connections-client.tsx", import.meta.url)),
      "utf8",
    );
    assert.equal(connections.includes("location.assign"), false);
    assert.equal(connections.includes("router.push"), false);
    assert.match(connections, /initialUnlockError/);
    const page = fs.readFileSync(
      fileURLToPath(new URL("../../app/connections/page.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(page, /flavorUnlock === "invalid"/);
    assert.match(page, /initialUnlockError/);

    const route = fs.readFileSync(fileURLToPath(new URL("../../app/api/flavor/route.ts", import.meta.url)), "utf8");
    assert.match(route, /response\.cookies\.set\(FLAVOR_COOKIE/);
    assert.equal(route.includes("jar.set"), false);
    assert.equal(route.includes("new URL("), false);
    assert.equal(route.includes("NextResponse.redirect"), false);
    assert.match(route, /planFlavorUnlock/);
  });
});
