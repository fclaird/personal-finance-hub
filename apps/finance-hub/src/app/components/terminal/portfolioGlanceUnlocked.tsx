"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";

type PortfolioGlanceUnlockContextValue = {
  unlocked: boolean;
  editing: boolean;
  draft: string;
  error: boolean;
  setDraft: (v: string) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  tryUnlock: () => void;
  lock: () => void;
};

const PortfolioGlanceUnlockContext = createContext<PortfolioGlanceUnlockContextValue | null>(null);

/** Portfolio dollar amounts follow the global privacy mask (no separate client password). */
export function PortfolioGlanceUnlockProvider({ children }: { children: ReactNode }) {
  const privacy = usePrivacy();

  const value = useMemo(
    (): PortfolioGlanceUnlockContextValue => ({
      unlocked: !privacy.masked,
      editing: false,
      draft: "",
      error: false,
      setDraft: () => {},
      startEditing: () => {
        privacy.setMode("off");
      },
      cancelEditing: () => {},
      tryUnlock: () => {
        privacy.setMode("off");
      },
      lock: () => {
        privacy.setMode("on");
      },
    }),
    [privacy],
  );

  return (
    <PortfolioGlanceUnlockContext.Provider value={value}>{children}</PortfolioGlanceUnlockContext.Provider>
  );
}

export function usePortfolioGlanceUnlocked(): PortfolioGlanceUnlockContextValue {
  const ctx = useContext(PortfolioGlanceUnlockContext);
  if (!ctx) {
    throw new Error("usePortfolioGlanceUnlocked requires PortfolioGlanceUnlockProvider");
  }
  return ctx;
}

/** Safe hook for tooltips outside the provider (returns locked). */
export function usePortfolioGlanceUnlockedOptional(): Pick<PortfolioGlanceUnlockContextValue, "unlocked"> {
  const ctx = useContext(PortfolioGlanceUnlockContext);
  return { unlocked: ctx?.unlocked ?? false };
}
