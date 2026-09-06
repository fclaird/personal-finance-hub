"use client";

import { formatUsd2 } from "@/lib/format";
import type { SituationMemberView, SituationView } from "@/lib/situations/apiTypes";
import {
  buildSituationTree,
  type SituationTreeNode,
} from "@/lib/situations/situationTree";
import { posNegClass } from "@/lib/terminal/colors";

function kindDotClass(kind: SituationTreeNode["kind"]): string {
  switch (kind) {
    case "open":
      return "bg-sky-500";
    case "adjustment":
      return "bg-amber-500";
    case "close":
      return "bg-emerald-500";
    case "current":
      return "bg-violet-500";
    default:
      return "bg-zinc-400 dark:bg-zinc-500";
  }
}

function kindTitle(kind: SituationTreeNode["kind"]): string {
  switch (kind) {
    case "open":
      return "Initial";
    case "adjustment":
      return "Adjustment";
    case "close":
      return "Close";
    case "current":
      return "Current";
    case "leg":
      return "Leg";
    default:
      return "Step";
  }
}

function usd(v: number | null | undefined, masked: boolean): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatUsd2(v, { mask: masked });
}

function MemberLines({
  members,
  masked,
  tone,
}: {
  members: SituationMemberView[];
  masked: boolean;
  tone?: "close" | "open";
}) {
  if (members.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      {members.map((m) => (
        <li key={`${m.transactionId}:${m.role}`} className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            <span className="font-mono text-zinc-600 dark:text-zinc-300">{m.symbol ?? m.transactionId}</span>
            {tone === "close" ? " · closed" : tone === "open" ? " · opened" : ""}
            {m.tradeDate ? ` · ${m.tradeDate}` : ""}
            {m.instruction ? ` · ${m.instruction}` : ""}
          </span>
          <span className={m.netAmount == null ? "" : posNegClass(m.netAmount) || ""}>
            {usd(m.netAmount, masked)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TreeNodeView({
  node,
  masked,
  isLast,
  depth,
}: {
  node: SituationTreeNode;
  masked: boolean;
  isLast: boolean;
  depth: number;
}) {
  const hasKids = node.children.length > 0;
  return (
    <li className="relative">
      <div className="flex gap-3">
        <div className="relative flex w-4 flex-col items-center">
          {depth > 0 ? (
            <span
              className="absolute -top-2 left-1/2 h-2 w-px -translate-x-1/2 bg-zinc-200 dark:bg-white/15"
              aria-hidden
            />
          ) : null}
          <span className={"relative z-[1] mt-1 h-2.5 w-2.5 rounded-full " + kindDotClass(node.kind)} />
          {hasKids || !isLast ? (
            <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-white/15" aria-hidden />
          ) : null}
        </div>

        <div className={"min-w-0 flex-1 " + (hasKids ? "pb-3" : "pb-1")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {kindTitle(node.kind)}
              </span>
              <span className="ml-2 font-medium text-zinc-800 dark:text-zinc-100">
                {node.kind === "open"
                  ? node.members.map((m) => m.symbol ?? m.transactionId).join(" + ") || "Open"
                  : node.kind === "adjustment"
                    ? [
                        node.closeMembers.length
                          ? `close ${node.closeMembers.map((m) => m.symbol ?? "?").join(", ")}`
                          : null,
                        node.openMembers.length
                          ? `open ${node.openMembers.map((m) => m.symbol ?? "?").join(", ")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" → ")
                    : node.kind === "close"
                      ? node.members.map((m) => m.symbol ?? m.transactionId).join(" + ")
                      : node.kind === "current"
                        ? node.symbols.join(" + ") || "still open"
                        : node.member.symbol ?? node.member.transactionId}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-3 text-right">
              {"stepNet" in node ? (
                <span className={node.stepNet == null ? "text-zinc-500" : posNegClass(node.stepNet) || ""}>
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-400">Step</span>
                  {usd(node.stepNet, masked)}
                </span>
              ) : null}
              <span
                className={
                  "font-semibold " +
                  (node.cumulativeNet == null ? "text-zinc-500" : posNegClass(node.cumulativeNet) || "")
                }
              >
                <span className="mr-1 text-[10px] font-normal uppercase tracking-wide text-zinc-400">Cum</span>
                {usd(node.cumulativeNet, masked)}
              </span>
            </div>
          </div>

          {node.kind === "open" ? <MemberLines members={node.members} masked={masked} /> : null}
          {node.kind === "adjustment" ? (
            <>
              <MemberLines members={node.closeMembers} masked={masked} tone="close" />
              <MemberLines members={node.openMembers} masked={masked} tone="open" />
            </>
          ) : null}
          {node.kind === "close" ? <MemberLines members={node.members} masked={masked} tone="close" /> : null}
          {node.kind === "leg" ? <MemberLines members={[node.member]} masked={masked} /> : null}
          {node.kind === "current" ? (
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Live structure at the tip of this book — mark-to-market is on Live holdings above.
            </p>
          ) : null}

          {hasKids ? (
            <ol className="mt-2 space-y-0">
              {node.children.map((child, idx) => (
                <TreeNodeView
                  key={child.id}
                  node={child}
                  masked={masked}
                  isLast={idx === node.children.length - 1}
                  depth={depth + 1}
                />
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function SituationLifecycle({
  row,
  privacyMasked,
}: {
  row: SituationView;
  privacyMasked: boolean;
}) {
  const tree = buildSituationTree(row.members, { status: row.status });

  return (
    <div className="border-t border-zinc-100 px-3 py-3 dark:border-white/10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          Trade tree · {row.members.length} fill{row.members.length === 1 ? "" : "s"}
          {row.closedOn ? ` · closed ${row.closedOn}` : " · still open"}
        </span>
        <span className={row.netPremium == null ? "" : posNegClass(row.netPremium) || ""}>
          Net {row.netPremium == null ? "—" : formatUsd2(row.netPremium, { mask: privacyMasked })}
        </span>
      </div>

      {tree.length === 0 ? (
        <p className="text-xs text-zinc-500">No fills linked on this situation yet.</p>
      ) : (
        <ol className="space-y-0">
          {tree.map((node, idx) => (
            <TreeNodeView
              key={node.id}
              node={node}
              masked={privacyMasked}
              isLast={idx === tree.length - 1}
              depth={0}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
