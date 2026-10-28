import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACCESSIBILITY_HINT,
  BROWSERS,
  appleScriptForBrowser,
  classifyBrowser,
  interpretOsascriptResult,
  isBridgeTabUrl,
  matchesBridgePrefix,
  normalizeOpenUrl,
  runReopen,
} from "./reopenBridgeBrowser.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const BRIDGE_TABS = [
  "https://localhost:3000",
  "https://localhost:3000/",
  "https://localhost:3000/positions",
  "http://localhost:3000/allocation?refresh=1",
  "https://127.0.0.1:3000/",
  "http://127.0.0.1:3000/#book",
  "HTTPS://LocalHost:3000/Strategy",
  "https://localhost:3000?x=1",
];

const OTHER_TABS = [
  "https://localhost:3001/",
  "https://localhost:30000/",
  "https://localhost:3000.evil.com/",
  "https://example.com:3000/",
  "https://localhost.example.com:3000/",
  "http://localhost:8080/",
  "http://localhost/",
  "https://127.0.0.1:443/",
  "chrome://newtab/",
  "https://mail.google.com/",
  "https://localhost:3000foo",
  "",
  null,
];

test("only Bridge tabs on localhost and 127.0.0.1 match", () => {
  for (const url of BRIDGE_TABS) {
    assert.equal(isBridgeTabUrl(url, 3000), true, url);
    assert.equal(matchesBridgePrefix(url, 3000), true, url);
  }
  for (const url of OTHER_TABS) {
    assert.equal(isBridgeTabUrl(url, 3000), false, String(url));
    assert.equal(matchesBridgePrefix(url, 3000), false, String(url));
  }
  assert.equal(isBridgeTabUrl("https://localhost:3049/", 3049), true);
  assert.equal(matchesBridgePrefix("https://127.0.0.1:3049/book", 3049), true);
  assert.equal(isBridgeTabUrl("https://localhost:3000/", 3049), false);
});

test("default browser detection covers Safari, Chrome, Arc, Brave, and Edge", () => {
  assert.equal(classifyBrowser({ bundleId: "com.apple.Safari", appPath: "/System/Applications/Safari.app" }), "safari");
  assert.equal(classifyBrowser({ bundleId: "com.google.Chrome", appPath: "/Applications/Google Chrome.app" }), "chrome");
  assert.equal(classifyBrowser({ bundleId: "company.thebrowser.Browser", appPath: "/Applications/Arc.app" }), "arc");
  assert.equal(classifyBrowser({ bundleId: "com.brave.Browser", appPath: "/Applications/Brave Browser.app" }), "brave");
  assert.equal(classifyBrowser({ bundleId: "com.microsoft.edgemac", appPath: "/Applications/Microsoft Edge.app" }), "edge");
  assert.equal(classifyBrowser({ appPath: "/Applications/Firefox.app", bundleId: "org.mozilla.firefox" }), null);
  assert.equal(classifyBrowser({ bundleId: "com.apple.SafariTechnologyPreview" }), null);
});

test("Chrome-family scripts close only matching tabs, then make a new window and full screen", () => {
  for (const id of ["chrome", "brave", "edge", "arc"]) {
    const script = appleScriptForBrowser(id, "https://127.0.0.1:3000/");
    const browser = BROWSERS[id];
    assert.match(script, new RegExp(`tell application "${browser.appName}"`));
    assert.match(script, /if my isBridgeTab\(tabUrl\) then/);
    assert.match(script, /close tab t of window w/);
    assert.match(script, /is 0 then close window w/);
    assert.doesNotMatch(script, /close every/);
    assert.doesNotMatch(script, /close windows/);
    assert.match(script, /if openedWindow is false then return "OPEN_FAILED"/);
    assert.match(script, /set newWin to make new window/);
    assert.match(script, /set URL of active tab of newWin to "https:\/\/127\.0\.0\.1:3000\/"/);
    assert.match(script, /set bounds of newWin to targetBounds/);
    assert.match(script, /keystroke "f" using \{control down, command down\}/);
    assert.match(script, /AXFullScreen/);
    assert.match(script, new RegExp(`tell process "${browser.processName}"`));
    for (const prefix of [
      "http://localhost:3000",
      "https://localhost:3000",
      "http://127.0.0.1:3000",
      "https://127.0.0.1:3000",
    ]) {
      assert.ok(script.includes(`"${prefix}"`), `${id} missing ${prefix}`);
    }
  }
});

test("Safari uses a new document and AXFullScreen, not the Chrome keystroke", () => {
  const script = appleScriptForBrowser("safari", "http://localhost:3000/positions");
  assert.match(script, /tell application "Safari"/);
  assert.match(script, /if my isBridgeTab\(tabUrl\) then/);
  assert.match(script, /close tab t of window w/);
  assert.match(script, /is 0 then close window w/);
  assert.match(script, /if openedWindow is false then return "OPEN_FAILED"/);
  assert.match(script, /make new document with properties \{URL:"http:\/\/localhost:3000\/"\}/);
  assert.match(script, /AXFullScreen/);
  assert.doesNotMatch(script, /keystroke "f" using \{control down, command down\}/);
  assert.doesNotMatch(script, /make new window/);
});

test("the new window opens at the Bridge origin", () => {
  assert.equal(normalizeOpenUrl("https://127.0.0.1:3000/positions?x=1#y"), "https://127.0.0.1:3000/");
  assert.equal(normalizeOpenUrl('http://127.0.0.1:3000/" & close windows & "'), "http://127.0.0.1:3000/");
  assert.throws(() => normalizeOpenUrl("file:///tmp/bridge"));
  assert.throws(() => normalizeOpenUrl("https://localhost/"));
  const script = appleScriptForBrowser("chrome", "http://127.0.0.1:3000/positions");
  assert.match(script, /set URL of active tab of newWin to "http:\/\/127\.0\.0\.1:3000\/"/);
  assert.doesNotMatch(script, /positions/);
  assert.doesNotMatch(script, /close windows/);
});

test("Accessibility failure still leaves the new window and returns one hint", () => {
  const lines = [];
  const opened = [];
  const code = runReopen({
    platform: "darwin",
    argv: ["https://127.0.0.1:3000"],
    env: {},
    deps: {
      detect: () => ({ bundleId: "com.google.chrome", appPath: "/Applications/Google Chrome.app" }),
      osascript: () => ({ status: 0, stdout: "NO_ACCESSIBILITY\n", stderr: "" }),
      openSystem: (url) => opened.push(url),
      log: (line) => lines.push(line),
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(opened, []);
  assert.equal(lines.filter((line) => line === ACCESSIBILITY_HINT).length, 1);
  assert.match(lines[0], /Opened https:\/\/127\.0\.0\.1:3000\/ in a new Google Chrome window\./);
});

test("an unhandled browser opens the URL and does not close tabs", () => {
  let scripted = false;
  const opened = [];
  const lines = [];
  const code = runReopen({
    platform: "darwin",
    argv: ["http://localhost:3000"],
    env: {},
    deps: {
      detect: () => ({ bundleId: "org.mozilla.firefox", appPath: "/Applications/Firefox.app" }),
      osascript: () => {
        scripted = true;
        return { status: 0, stdout: "", stderr: "" };
      },
      openSystem: (url) => opened.push(url),
      log: (line) => lines.push(line),
    },
  });
  assert.equal(code, 0);
  assert.equal(scripted, false);
  assert.deepEqual(opened, ["http://localhost:3000/"]);
  assert.match(lines[0], /without closing tabs/);
});

test("FINANCE_HUB_NO_BROWSER skips detection and AppleScript", () => {
  let called = false;
  const lines = [];
  const code = runReopen({
    platform: "darwin",
    argv: ["https://127.0.0.1:3000"],
    env: { FINANCE_HUB_NO_BROWSER: "1" },
    deps: {
      detect: () => {
        called = true;
        return {};
      },
      osascript: () => {
        called = true;
        return { status: 0, stdout: "", stderr: "" };
      },
      openSystem: () => {
        called = true;
      },
      log: (line) => lines.push(line),
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.deepEqual(lines, ["Browser reopen skipped (FINANCE_HUB_NO_BROWSER=1)."]);
});

test("a failed browser script still opens the URL", () => {
  const opened = [];
  const warnings = [];
  const code = runReopen({
    platform: "darwin",
    argv: ["https://localhost:3000/"],
    env: {},
    deps: {
      detect: () => ({ bundleId: "company.thebrowser.browser" }),
      osascript: () => ({ status: 1, stdout: "", stderr: "Arc got an error" }),
      openSystem: (url) => opened.push(url),
      log: () => undefined,
      warn: (line) => warnings.push(line),
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(opened, ["https://localhost:3000/"]);
  assert.match(warnings[0], /system open command/);
});

test("the launcher reopens the browser only after a healthy cutover", () => {
  const source = fs.readFileSync(path.join(scriptDir, "launch-financial-bridge.sh"), "utf8");
  const promote = source.slice(source.indexOf("promote-start)"), source.indexOf("kill-port)"));
  const failed = promote.slice(promote.indexOf("if ! wait_for_health"), promote.indexOf('stop_pid "$STAGE_PID"'));
  assert.match(failed, /exit 1/);
  assert.doesNotMatch(failed, /reopen_bridge_browser/);
  assert.match(promote, /stop_pid "\$STAGE_PID"\n\s+reopen_bridge_browser/);
  assert.match(source, /FINANCE_HUB_NO_BROWSER/);
});

test("osascript accessibility errors are a hint, not a failed launch", () => {
  assert.deepEqual(interpretOsascriptResult({ status: 1, stdout: "", stderr: "osascript is not allowed assistive access." }), {
    ok: true,
    hint: ACCESSIBILITY_HINT,
  });
  assert.equal(interpretOsascriptResult({ status: 1, stdout: "", stderr: "syntax error" }).ok, false);
  assert.equal(interpretOsascriptResult({ status: 0, stdout: "OPEN_FAILED\n", stderr: "" }).ok, false);
});
