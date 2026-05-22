import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { normTickerSymbol, symbolPageHref } from "@/lib/symbolPage";

export function SymbolLink({
  symbol,
  children,
  className = "",
  title,
  style,
  /** Use inside another link (e.g. news headline); renders a span to avoid nested `<a>`. */
  asText = false,
}: {
  symbol: string;
  children?: ReactNode;
  className?: string;
  title?: string;
  style?: CSSProperties;
  asText?: boolean;
}) {
  const href = symbolPageHref(symbol);
  const t = title ?? `Open ${normTickerSymbol(symbol)} in Terminal`;
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
    >
      {children ?? normTickerSymbol(symbol)}
    </Link>
  );
}
