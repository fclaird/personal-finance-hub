"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSidebarNavIndex, readSidebarNavOrder } from "@/app/lib/sidebarNav";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function NavigationShortcuts() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nav = readSidebarNavOrder();
          const i = getSidebarNavIndex(pathname, nav);
          const next = (i + 1) % nav.length;
          router.push(nav[next]!.href);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const nav = readSidebarNavOrder();
          const i = getSidebarNavIndex(pathname, nav);
          const next = (i - 1 + nav.length) % nav.length;
          router.push(nav[next]!.href);
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          router.back();
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          router.forward();
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return null;
}
