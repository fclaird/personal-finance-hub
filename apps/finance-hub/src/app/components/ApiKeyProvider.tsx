"use client";

import { useEffect, useState, type ReactNode } from "react";

import { getStoredApiKey, setStoredApiKey } from "@/lib/apiFetch";

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKeyRequired, setApiKeyRequired] = useState(false);
  const [draft, setDraft] = useState("");
  const [unlocked, setUnlocked] = useState(() => Boolean(getStoredApiKey()));
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const stored = getStoredApiKey();
      if (!stored) return originalFetch(input, init);
      const headers = new Headers(init?.headers);
      if (!headers.has("authorization")) {
        headers.set("Authorization", `Bearer ${stored}`);
      }
      return originalFetch(input, { ...init, headers });
    };

    void originalFetch("/api/auth/config")
      .then((r) => r.json())
      .then((j: { apiKeyRequired?: boolean }) => {
        setApiKeyRequired(Boolean(j.apiKeyRequired));
      })
      .catch(() => null)
      .finally(() => setChecked(true));

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  function saveKey() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setStoredApiKey(trimmed);
    setUnlocked(true);
    window.location.reload();
  }

  const showGate = checked && apiKeyRequired && !unlocked && !getStoredApiKey();

  if (showGate) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">API key required</h1>
        <p className="max-w-md text-center text-sm text-zinc-600 dark:text-zinc-400">
          This server has LAN/VPN protection enabled. Enter the <code className="font-mono">FINANCE_HUB_API_KEY</code>{" "}
          value from the host&apos;s <code className="font-mono">.env.local</code>.
        </p>
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="API key"
          className="h-10 w-full max-w-sm rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-white/20 dark:bg-zinc-950"
          onKeyDown={(e) => {
            if (e.key === "Enter") saveKey();
          }}
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={!draft.trim()}
          className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Continue
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
