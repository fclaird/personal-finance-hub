"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSidebarNavIndex, NAV } from "@/app/lib/sidebarNav";

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
          const i = getSidebarNavIndex(pathname);
          const next = (i + 1) % NAV.length;
          router.push(NAV[next].href);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const i = getSidebarNavIndex(pathname);
          const next = (i - 1 + NAV.length) % NAV.length;
          router.push(NAV[next].href);
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
