"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { PRIVACY_COOKIE, type PrivacyMode, parsePrivacyCookie, privacyCookieValue } from "@/lib/privacy";

type PrivacyContextValue = {
  mode: PrivacyMode;
  masked: boolean;
  setMode: (m: PrivacyMode) => void;
  toggle: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (!p.startsWith(`${name}=`)) continue;
    return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function writeCookie(name: string, value: string) {
  // 1 year, lax, non-httpOnly so client can read it.
  const maxAge = 365 * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<PrivacyMode>("off");

  useEffect(() => {
    const t = setTimeout(() => {
      const v = readCookie(PRIVACY_COOKIE);
      setModeState(parsePrivacyCookie(v));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setMode = useCallback((m: PrivacyMode) => {
    setModeState(m);
    writeCookie(PRIVACY_COOKIE, privacyCookieValue(m));
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "on" ? "off" : "on");
  }, [mode, setMode]);

  const value = useMemo<PrivacyContextValue>(
    () => ({
      mode,
      masked: mode === "on",
      setMode,
      toggle,
    }),
    [mode, setMode, toggle],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}

