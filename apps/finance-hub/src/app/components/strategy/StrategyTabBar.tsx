"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { STRATEGY_TAB_META, type StrategyTabSlug } from "@/lib/strategy/strategyCategories";
import { isSecondaryStrategySlug, STRATEGY_TAB_GROUPS } from "@/lib/strategy/strategyTabGroups";

export function StrategyTabBar({ category }: { category: StrategyTabSlug }) {
  const [showMore, setShowMore] = useState(() => isSecondaryStrategySlug(category));

  useEffect(() => {
    if (isSecondaryStrategySlug(category)) setShowMore(true);
  }, [category]);

  return (
    <div className="flex flex-col gap-2">
      {STRATEGY_TAB_GROUPS.map((g, i) => {
        const secondary = g.slugs.every((s) => isSecondaryStrategySlug(s));
        if (secondary && !showMore) return null;
        return (
          <div key={g.label ?? `g${i}`} className="flex flex-wrap items-center gap-2">
            {g.label ? (
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{g.label}</span>
            ) : null}
            {g.slugs.map((slug) => {
              const label = STRATEGY_TAB_META.find((t) => t.slug === slug)?.label ?? slug;
              return (
                <Link
                  key={slug}
                  href={`/strategies/${slug}`}
                  className={
                    "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                    (slug === category
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/5")
                  }
                >
                  {label}
                </Link>
              );
            })}
          </div>
        );
      })}
      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-[11px] font-medium text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          {showMore ? "Hide long / uncategorized" : "More: LEAPs, long options, uncategorized"}
        </button>
      </div>
    </div>
  );
}
