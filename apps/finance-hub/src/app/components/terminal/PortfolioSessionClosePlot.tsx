import type { ReactNode } from "react";

export function PortfolioSessionCloseHeadline({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] font-medium leading-4 text-zinc-500 dark:text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

export function PortfolioSessionClosePlot({ referencePrice }: { referencePrice: number | null }) {
  const price = referencePrice != null && Number.isFinite(referencePrice) ? String(referencePrice) : "";
  const label = price ? `Previous close ${price}` : "Previous close";
  return (
    <svg
      data-portfolio-plot="session-close"
      data-reference-price={price}
      role="img"
      aria-label={label}
      className="h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <line
        data-portfolio-mark="reference"
        x1="0"
        x2="100"
        y1="50"
        y2="50"
        stroke="#a1a1aa"
        strokeWidth="1.25"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
