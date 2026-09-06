"use client";

import { formatUsd2 } from "@/lib/format";
import type { SituationMemberView, SituationView } from "@/lib/situations/apiTypes";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";
import {
  formatAdjustmentSummary,
  formatCurrentDteLabel,
  formatFillLine,
  sumMemberNets,
} from "@/lib/situations/formatSituationFill";
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
      return "Leg out";
    default:
      return "Step";
  }
}

function usd(v: number | null | undefined, masked: boolean): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatUsd2(v, { mask: masked });
}

/**
 * Open/unrealized nets stay grey; realized steps use green/red by sign.
 * Credits on a still-open book are not "wins" yet.
 */
export function pnlTone(
  net: number | null | undefined,
  opts: { realized: boolean },
): string {
  if (net == null || !Number.isFinite(net) || net === 0) return "text-zinc-500";
  if (!opts.realized) return "text-zinc-400 dark:text-zinc-500";
  return posNegClass(net) || "text-zinc-500";
}

function FillRow({
  line,
  net,
  masked,
  realized,
}: {
  line: string;
  net: number | null;
  masked: boolean;
  realized: boolean;
}) {
  const rowClass = realized ? pnlTone(net, { realized: true }) : "text-zinc-600 dark:text-zinc-300";
  return (
    <li className={"flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] " + rowClass}>
      <span className="min-w-0 flex-1">{line}</span>
      <span className={"shrink-0 tabular-nums font-medium " + pnlTone(net, { realized })}>
        {usd(net, masked)}
      </span>
    </li>
  );
}

function OpenFillLines({ members, masked }: { members: SituationMemberView[]; masked: boolean }) {
  if (members.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {members.map((m) => (
        <FillRow
          key={m.transactionId + ":" + m.role}
          line={formatFillLine(m)}
          net={m.netAmount}
          masked={masked}
          realized={false}
        />
      ))}
    </ul>
  );
}

function AdjustmentFillLines({
  closeMembers,
  openMembers,
  masked,
}: {
  closeMembers: SituationMemberView[];
  openMembers: SituationMemberView[];
  masked: boolean;
}) {
  const summary = formatAdjustmentSummary(closeMembers, openMembers);
  return (
    <ul className="mt-1 space-y-1">
      <FillRow line={summary.label} net={summary.net} masked={masked} realized />
      {closeMembers.map((m) => (
        <li key={"c:" + m.transactionId} className="pl-3 text-[10px] text-zinc-500 dark:text-zinc-400">
          closed · {formatFillLine(m)}
        </li>
      ))}
      {openMembers.map((m) => (
        <li key={"o:" + m.transactionId} className="pl-3 text-[10px] text-zinc-500 dark:text-zinc-400">
          opened · {formatFillLine(m)}
        </li>
      ))}
    </ul>
  );
}

function CloseFillLines({ members, masked }: { members: SituationMemberView[]; masked: boolean }) {
  if (members.length === 0) return null;
  if (members.length === 1) {
    const m = members[0]!;
    return (
      <ul className="mt-1 space-y-1">
        <FillRow line={formatFillLine(m)} net={m.netAmount} masked={masked} realized />
      </ul>
    );
  }
  const combined = sumMemberNets(members);
  return (
    <ul className="mt-1 space-y-1">
      <FillRow line={members.length + " closes · net"} net={combined} masked={masked} realized />
      {members.map((m) => (
        <li key={m.transactionId} className="pl-3 text-[10px] text-zinc-500 dark:text-zinc-400">
          {formatFillLine(m)} · {usd(m.netAmount, masked)}
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
  situationOpen,
}: {
  node: SituationTreeNode;
  masked: boolean;
  isLast: boolean;
  depth: number;
  situationOpen: boolean;
}) {
  const hasKids = node.children.length > 0;
  let headline = "";
  if (node.kind === "open") headline = "Initial open";
  else if (node.kind === "adjustment") headline = formatAdjustmentSummary(node.closeMembers, node.openMembers).label;
  else if (node.kind === "close")
    headline = node.members.length === 1 ? formatFillLine(node.members[0]!) : "Close · " + node.members.length + " fills";
  else if (node.kind === "current") {
    const dte = formatCurrentDteLabel(node.symbols);
    headline = dte ? `Current structure · ${dte}` : "Current structure";
  } else if (node.kind === "leg") headline = "Legged out · " + formatFillLine(node.member);
  else headline = "Step";

  // Open tip / initial open while book still open → unrealized (grey).
  // Adjustments, closes, legs → realized on that step.
  const stepRealized =
    node.kind === "adjustment" || node.kind === "close" || node.kind === "leg";
  const cumRealized =
    node.kind === "close" || (node.kind === "adjustment" && !situationOpen)
      ? true
      : node.kind === "current" || node.kind === "open"
        ? false
        : !situationOpen;

  const stepForColor =
    node.kind === "adjustment" || node.kind === "close" || node.kind === "leg"
      ? "stepNet" in node
        ? node.stepNet
        : null
      : node.kind === "open"
        ? node.stepNet
        : null;

  return (
    <li className="relative">
      <div className="flex gap-3">
        <div className="relative flex w-4 flex-col items-center">
          {depth > 0 ? (
            <span className="absolute -top-2 left-1/2 h-2 w-px -translate-x-1/2 bg-zinc-300 dark:bg-white/25" aria-hidden />
          ) : null}
          <span className={"relative z-[1] mt-1 h-2.5 w-2.5 rounded-full " + kindDotClass(node.kind)} />
          {hasKids || !isLast ? (
            <span className="mt-1 w-px flex-1 bg-zinc-300 dark:bg-white/25" aria-hidden />
          ) : null}
        </div>
        <div
          className={
            "min-w-0 max-w-3xl flex-1 border-b border-zinc-200 pb-2 dark:border-white/25 " +
            (hasKids ? "mb-2" : "mb-1")
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <div className="min-w-0">
              <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {kindTitle(node.kind)}
              </span>
              <span
                className={
                  "ml-2 font-medium " +
                  (stepForColor != null
                    ? pnlTone(stepForColor, { realized: stepRealized })
                    : "text-zinc-800 dark:text-zinc-100")
                }
              >
                {headline}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              {"stepNet" in node ? (
                <span className={pnlTone(node.stepNet, { realized: stepRealized })}>
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-400">Step</span>
                  {usd(node.stepNet, masked)}
                </span>
              ) : null}
              <span className={"font-semibold " + pnlTone(node.cumulativeNet, { realized: cumRealized })}>
                <span className="mr-1 text-[10px] font-normal uppercase tracking-wide text-zinc-400">Cum</span>
                {usd(node.cumulativeNet, masked)}
              </span>
            </div>
          </div>
          {node.kind === "open" ? <OpenFillLines members={node.members} masked={masked} /> : null}
          {node.kind === "adjustment" ? (
            <AdjustmentFillLines closeMembers={node.closeMembers} openMembers={node.openMembers} masked={masked} />
          ) : null}
          {node.kind === "close" ? <CloseFillLines members={node.members} masked={masked} /> : null}
          {node.kind === "leg" ? (
            <ul className="mt-1 space-y-1">
              <FillRow line={formatFillLine(node.member)} net={node.member.netAmount} masked={masked} realized />
            </ul>
          ) : null}
          {node.kind === "current" ? (
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Live structure at the tip of this book. Mark-to-market is on the snapshot legs above.
              {formatCurrentDteLabel(node.symbols) ? ` · ${formatCurrentDteLabel(node.symbols)}` : ""}
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
                  situationOpen={situationOpen}
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
  const clumped = clumpPartialFills(row.members);
  const tree = buildSituationTree(clumped, { status: row.status });
  const situationOpen = row.status === "open";
  const netRealized = !situationOpen;
  return (
    <div className="border-t border-zinc-200 px-3 py-3 dark:border-white/25">
      <div className="mb-3 flex max-w-3xl flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          Trade tree · {clumped.length} fill{clumped.length === 1 ? "" : "s"}
          {row.members.length !== clumped.length
            ? ` (${row.members.length} partials clumped)`
            : ""}
          {row.closedOn ? " · closed " + row.closedOn : " · still open"}
          {row.accountName ? " · " + row.accountName : ""}
        </span>
        <span className={pnlTone(row.netPremium, { realized: netRealized })}>
          Net {row.netPremium == null ? "—" : formatUsd2(row.netPremium, { mask: privacyMasked })}
        </span>
      </div>
      {tree.length === 0 ? (
        <p className="text-xs text-zinc-500">No fills linked on this situation yet.</p>
      ) : (
        <ol className="max-w-3xl space-y-0">
          {tree.map((node, idx) => (
            <TreeNodeView
              key={node.id}
              node={node}
              masked={privacyMasked}
              isLast={idx === tree.length - 1}
              depth={0}
              situationOpen={situationOpen}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
