/**
 * After a healthy cutover, close Bridge tabs in the default browser and open
 * one new full-screen window. Safari, Chrome, Arc, Brave, and Edge only.
 * Other tabs stay. FINANCE_HUB_NO_BROWSER=1 skips this.
 *
 * Full screen uses System Events (Accessibility). If that permission is
 * missing, the new window still opens and the caller logs one hint line.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export const ACCESSIBILITY_HINT =
  "Full screen skipped: grant Accessibility to the app running this launcher (System Settings → Privacy & Security → Accessibility).";

export const BROWSERS = {
  chrome: { appName: "Google Chrome", processName: "Google Chrome", family: "chrome" },
  brave: { appName: "Brave Browser", processName: "Brave Browser", family: "chrome" },
  edge: { appName: "Microsoft Edge", processName: "Microsoft Edge", family: "chrome" },
  arc: { appName: "Arc", processName: "Arc", family: "chrome" },
  safari: { appName: "Safari", processName: "Safari", family: "safari" },
};

const BUNDLE_IDS = {
  "com.google.chrome": "chrome",
  "com.brave.browser": "brave",
  "com.microsoft.edgemac": "edge",
  "company.thebrowser.browser": "arc",
  "com.apple.safari": "safari",
};

export function classifyBrowser({ bundleId = "", appPath = "" } = {}) {
  const id = bundleId.trim().toLowerCase();
  if (BUNDLE_IDS[id]) return BUNDLE_IDS[id];
  const normalized = appPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/google chrome.app")) return "chrome";
  if (normalized.includes("/brave browser.app")) return "brave";
  if (normalized.includes("/microsoft edge.app")) return "edge";
  if (/(^|\/)arc\.app(\/|$)/.test(normalized)) return "arc";
  if (/(^|\/)safari\.app(\/|$)/.test(normalized)) return "safari";
  return null;
}

export function bridgeOriginPrefixes(port) {
  const suffix = `:${String(port)}`;
  return ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"].map(
    (host) => `${host}${suffix}`,
  );
}

/** Same boundary rule the AppleScript uses: origin, then end, "/", "?", or "#". */
export function matchesBridgePrefix(raw, port) {
  if (typeof raw !== "string") return false;
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return false;
  for (const prefix of bridgeOriginPrefixes(port)) {
    if (!lowered.startsWith(prefix)) continue;
    if (lowered.length === prefix.length) return true;
    const next = lowered[prefix.length];
    if (next === "/" || next === "?" || next === "#") return true;
  }
  return false;
}

export function isBridgeTabUrl(raw, port = 3000) {
  if (typeof raw !== "string" || raw.trim() === "") return false;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return url.port === String(port);
}

export function normalizeOpenUrl(raw) {
  const url = new URL(String(raw ?? "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bridge URL must be http or https");
  }
  if (!url.port) throw new Error("Bridge URL must include a port");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function appleQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function handlers(port) {
  const prefixes = bridgeOriginPrefixes(port).map(appleQuote).join(", ");
  return `
on toLower(rawText)
  set upperChars to "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  set lowerChars to "abcdefghijklmnopqrstuvwxyz"
  set out to ""
  repeat with i from 1 to (length of rawText)
    set c to character i of rawText
    set n to offset of c in upperChars
    if n is greater than 0 then
      set out to out & character n of lowerChars
    else
      set out to out & c
    end if
  end repeat
  return out
end toLower

on isBridgeTab(rawUrl)
  if rawUrl is missing value then return false
  try
    set lowered to my toLower(rawUrl as text)
  on error
    return false
  end try
  if lowered is "" then return false
  set prefixes to {${prefixes}}
  repeat with prefixRef in prefixes
    set prefix to prefixRef as text
    if lowered starts with prefix then
      set prefixLen to length of prefix
      if (length of lowered) is prefixLen then return true
      set nxt to character (prefixLen + 1) of lowered
      if nxt is "/" or nxt is "?" or nxt is "#" then return true
    end if
  end repeat
  return false
end isBridgeTab
`;
}

function closeTabsBlock(appName) {
  const quoted = appleQuote(appName);
  return `
try
if application ${quoted} is running then
  tell application ${quoted}
    set windowCount to count of windows
    repeat with w from windowCount to 1 by -1
      try
        set tabCount to count of tabs of window w
      on error
        set tabCount to 0
      end try
      repeat with t from tabCount to 1 by -1
        set tabUrl to ""
        try
          set tabUrl to URL of tab t of window w
        end try
        if my isBridgeTab(tabUrl) then
          try
            close tab t of window w
          end try
        end if
      end repeat
      try
        if (count of tabs of window w) is 0 then close window w
      end try
    end repeat
  end tell
end if
end try
`;
}

function screenBoundsBlock() {
  return `
set targetBounds to {0, 0, 1440, 900}
try
  tell application "Finder" to set targetBounds to bounds of window of desktop
end try
`;
}

function openOrFail(tellBlock) {
  return `
set openedWindow to false
try
${tellBlock}
set openedWindow to true
end try
if openedWindow is false then return "OPEN_FAILED"
`;
}

function chromeOpenBlock(appName, openUrl) {
  const quotedApp = appleQuote(appName);
  const quotedUrl = appleQuote(openUrl);
  return openOrFail(`
tell application ${quotedApp}
  activate
  set newWin to make new window
  set URL of active tab of newWin to ${quotedUrl}
  try
    set bounds of newWin to targetBounds
  end try
  try
    set index of newWin to 1
  end try
end tell
`);
}

function chromeFullscreenBlock(processName) {
  const quoted = appleQuote(processName);
  return `
set fullscreenResult to "OK"
try
  tell application "System Events"
    tell process ${quoted}
      set frontmost to true
      delay 0.3
      keystroke "f" using {control down, command down}
    end tell
  end tell
on error
  try
    tell application "System Events"
      tell process ${quoted}
        set frontmost to true
        set value of attribute "AXFullScreen" of window 1 to true
      end tell
    end tell
  on error
    set fullscreenResult to "NO_ACCESSIBILITY"
  end try
end try
return fullscreenResult
`;
}

function safariOpenBlock(openUrl) {
  const quotedUrl = appleQuote(openUrl);
  return openOrFail(`
tell application "Safari"
  activate
  set newDoc to make new document with properties {URL:${quotedUrl}}
  try
    set bounds of window 1 to targetBounds
  end try
end tell
`);
}

function safariFullscreenBlock() {
  return `
set fullscreenResult to "OK"
try
  tell application "System Events"
    tell process "Safari"
      set frontmost to true
      delay 0.3
      set value of attribute "AXFullScreen" of window 1 to true
    end tell
  end tell
on error
  set fullscreenResult to "NO_ACCESSIBILITY"
end try
return fullscreenResult
`;
}

export function appleScriptForBrowser(browserId, openUrl) {
  const browser = BROWSERS[browserId];
  if (!browser) throw new Error(`Unsupported browser "${browserId}"`);
  const canonical = normalizeOpenUrl(openUrl);
  const port = new URL(canonical).port;
  const body =
    browser.family === "safari"
      ? `${screenBoundsBlock()}\n${closeTabsBlock(browser.appName)}\n${safariOpenBlock(canonical)}\n${safariFullscreenBlock()}`
      : `${screenBoundsBlock()}\n${closeTabsBlock(browser.appName)}\n${chromeOpenBlock(browser.appName, canonical)}\n${chromeFullscreenBlock(browser.processName)}`;
  return `${handlers(port)}\n${body}`;
}

export function interpretOsascriptResult({ status, stdout = "", stderr = "" }) {
  if (stdout.includes("OPEN_FAILED")) return { ok: false, hint: null };
  const blob = `${stdout}\n${stderr}`;
  if (/NO_ACCESSIBILITY|assistive access|not authorized to send Apple events to System Events|errAEEventNotPermitted|-1743/i.test(blob)) {
    return { ok: true, hint: ACCESSIBILITY_HINT };
  }
  if (status !== 0) return { ok: false, hint: null };
  return { ok: true, hint: null };
}

const DETECT_SCRIPT = `use framework "AppKit"
set ws to current application's NSWorkspace's sharedWorkspace()
set sample to current application's NSURL's URLWithString:"https://localhost/"
set appURL to ws's URLForApplicationToOpenURL:sample
if appURL is missing value then return ""
set appPath to (appURL's |path|() as text)
set bundleId to ""
set bundle to current application's NSBundle's bundleWithURL:appURL
if bundle is not missing value then
  set ident to bundle's bundleIdentifier()
  if ident is not missing value then set bundleId to ident as text
end if
return appPath & tab & bundleId
`;

function osascript(source) {
  const result = spawnSync("osascript", ["-"], { input: source, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function detectBrowser() {
  const result = osascript(DETECT_SCRIPT);
  if (result.status !== 0) return { bundleId: "", appPath: "" };
  const [appPath, bundleId] = result.stdout.trim().split("\t");
  return { appPath: appPath ?? "", bundleId: bundleId ?? "" };
}

function openSystem(url) {
  spawnSync("open", [url], { encoding: "utf8" });
}

export function runReopen({ platform, argv, env, deps }) {
  const log = deps.log ?? ((line) => console.log(line));
  const warn = deps.warn ?? ((line) => console.error(line));
  if (env.FINANCE_HUB_NO_BROWSER === "1") {
    log("Browser reopen skipped (FINANCE_HUB_NO_BROWSER=1).");
    return 0;
  }
  let openUrl;
  try {
    openUrl = normalizeOpenUrl(argv[0]);
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    return 0;
  }
  if (platform !== "darwin") {
    log("Browser reopen is macOS-only.");
    return 0;
  }
  const browserId = classifyBrowser(deps.detect());
  if (!browserId) {
    deps.openSystem(openUrl);
    log(`Default browser is not Safari, Chrome, Arc, Brave, or Edge. Opened ${openUrl} without closing tabs.`);
    return 0;
  }
  const script = appleScriptForBrowser(browserId, openUrl);
  const interpreted = interpretOsascriptResult(deps.osascript(script));
  const appName = BROWSERS[browserId].appName;
  if (!interpreted.ok) {
    deps.openSystem(openUrl);
    warn(`Browser script failed. Opened ${openUrl} with the system open command.`);
    return 0;
  }
  log(`Opened ${openUrl} in a new ${appName} window.`);
  if (interpreted.hint) log(interpreted.hint);
  return 0;
}

function isDirectRun() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry.endsWith(`${path.sep}reopenBridgeBrowser.mjs`);
}

if (isDirectRun()) {
  process.exit(
    runReopen({
      platform: process.platform,
      argv: process.argv.slice(2),
      env: process.env,
      deps: { detect: detectBrowser, osascript, openSystem },
    }),
  );
}
