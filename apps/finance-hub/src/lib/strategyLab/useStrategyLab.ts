"use client";

import { useCallback, useMemo, useState } from "react";

import type { OptionChain } from "@/lib/optionChain/chain";
import {
  createLab,
  editLab,
  evaluateLab,
  type LabEdit,
  type LabEvaluation,
  type LabScenario,
} from "@/lib/strategyLab/lab";

type ChainBody =
  | { ok: true; chain: OptionChain }
  | { ok: false; error: string; hint?: string };

export function useStrategyLab() {
  const [chain, setChain] = useState<OptionChain | null>(null);
  const [lab, setLab] = useState<LabScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async (symbol: string, refresh = false) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setError("Enter a ticker symbol.");
      return;
    }
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const q = new URLSearchParams({ symbol: sym });
      if (refresh) q.set("refresh", "1");
      const resp = await fetch(`/api/strategy-lab/chain?${q.toString()}`, { cache: "no-store" });
      const body = (await resp.json()) as ChainBody;
      if (!body.ok) {
        setError(body.error);
        setHint(body.hint ?? null);
        return;
      }
      setChain(body.chain);
      setLab((prev) => (prev && prev.symbol === body.chain.symbol ? prev : createLab(body.chain)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the chain.");
    } finally {
      setLoading(false);
    }
  }, []);

  const edit = useCallback(
    (next: LabEdit | readonly LabEdit[]) => {
      setLab((prev) => {
        if (!prev || !chain) return prev;
        return editLab(prev, next, chain);
      });
    },
    [chain],
  );

  const replace = useCallback((next: LabScenario) => {
    setLab((prev) => {
      if (!chain || next.symbol !== chain.symbol) return prev;
      return next;
    });
  }, [chain]);

  const evaluation: LabEvaluation | null = useMemo(
    () => (lab && chain ? evaluateLab(lab, chain) : null),
    [lab, chain],
  );

  return { chain, lab, evaluation, loading, error, hint, load, edit, replace };
}
