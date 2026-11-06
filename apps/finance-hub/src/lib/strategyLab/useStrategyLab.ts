"use client";

import { useCallback, useMemo, useRef, useState } from "react";

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
  const chainRef = useRef<OptionChain | null>(null);
  const inflight = useRef<{ symbol: string; promise: Promise<OptionChain | null> } | null>(null);

  const load = useCallback(async (symbol: string, refresh = false): Promise<OptionChain | null> => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setError("Enter a ticker symbol.");
      return null;
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
        return null;
      }
      chainRef.current = body.chain;
      setChain(body.chain);
      setLab((prev) => (prev && prev.symbol === body.chain.symbol ? prev : createLab(body.chain)));
      return body.chain;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the chain.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureUnderlying = useCallback(
    (symbol: string) => {
      const sym = symbol.trim().toUpperCase();
      if (!sym) return Promise.resolve(null);
      if (chainRef.current?.symbol === sym) return Promise.resolve(chainRef.current);
      if (inflight.current?.symbol === sym) return inflight.current.promise;
      const promise = load(sym).finally(() => {
        if (inflight.current?.promise === promise) inflight.current = null;
      });
      inflight.current = { symbol: sym, promise };
      return promise;
    },
    [load],
  );

  const edit = useCallback((next: LabEdit | readonly LabEdit[]) => {
    const active = chainRef.current;
    setLab((prev) => {
      if (!active) return prev;
      const base = prev && prev.symbol === active.symbol ? prev : createLab(active);
      return editLab(base, next, active);
    });
  }, []);

  const replace = useCallback((next: LabScenario) => {
    const active = chainRef.current;
    if (!active || next.symbol !== active.symbol) return;
    setLab(next);
  }, []);

  const evaluation: LabEvaluation | null = useMemo(
    () => (lab && chain ? evaluateLab(lab, chain) : null),
    [lab, chain],
  );

  return { chain, lab, evaluation, loading, error, hint, load, ensureUnderlying, edit, replace };
}
