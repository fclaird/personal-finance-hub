"use client";

import Link from "next/link";

import { STRATEGY_TAB_META, type StrategyTabSlug } from "@/lib/strategy/strategyCategories";
import { STRATEGY_TAB_GROUPS } from "@/lib/strategy/strategyTabGroups";

export function StrategyTabBar({ category }: { category: StrategyTabSlug }) {
  return (
    <div className="flex flex-col gap-2">
      {STRATEGY_TAB_GROUPS.map((g, i) => (
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
      ))}
    </div>
  );
}
