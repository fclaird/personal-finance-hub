"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LiveStatusBanner } from "@/app/components/LiveStatusBanner";
import { SidebarNav } from "@/app/components/SidebarNav";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/app/lib/sidebarNav";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readSidebarCollapsed());
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="relative flex h-dvh overflow-hidden">
      {!collapsed ? (
        <SidebarNav collapsed={false} onToggleCollapse={toggleCollapse} />
      ) : null}
      {collapsed ? (
        <button
          type="button"
          onClick={toggleCollapse}
          aria-expanded={false}
          aria-label="Expand sidebar"
          className="fixed left-0 top-1/2 z-40 hidden -translate-y-1/2 rounded-r-lg border border-l-0 border-zinc-300 bg-white/90 px-1.5 py-4 text-sm font-semibold text-zinc-600 shadow-sm backdrop-blur hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950/90 dark:text-zinc-300 dark:hover:bg-white/10 md:block"
          title="Expand sidebar"
        >
          »
        </button>
      ) : null}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <LiveStatusBanner />
        {children}
      </main>
    </div>
  );
}
