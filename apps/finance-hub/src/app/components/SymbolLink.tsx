import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { chartPageHref, normTickerSymbol, symbolPageHref } from "@/lib/symbolPage";

export function SymbolLink({
  symbol,
  children,
  className = "",
  title,
  style,
  /** Use inside another link (e.g. news headline); renders a span to avoid nested `<a>`. */
  asText = false,
  /** Positions open the underlying chart. Other links stay on the terminal page. */
  to = "terminal",
}: {
  symbol: string;
  children?: ReactNode;
  className?: string;
  title?: string;
  style?: CSSProperties;
  asText?: boolean;
  to?: "terminal" | "chart";
}) {
  const href = to === "chart" ? chartPageHref(symbol) : symbolPageHref(symbol);
  const t = title ?? (to === "chart" ? `Open ${normTickerSymbol(symbol)} chart` : `Open ${normTickerSymbol(symbol)} in Terminal`);
  const linkClass = `text-inherit no-underline hover:underline underline-offset-4 ${className}`.trim();
  if (!href) {
    return (
      <span className={className} style={style}>
        {children ?? "—"}
      </span>
    );
  }
  if (asText) {
    return (
      <span className={linkClass} style={style} title={t}>
        {children ?? normTickerSymbol(symbol)}
      </span>
    );
  }
  return (
    <Link
      href={href}
      prefetch={false}
      style={style}
      className={linkClass}
      title={t}
      onClick={to === "chart" ? (event) => event.stopPropagation() : undefined}
    >
      {children ?? normTickerSymbol(symbol)}
    </Link>
  );
}
