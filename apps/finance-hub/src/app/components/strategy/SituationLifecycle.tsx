"use client";

import { formatUsd2 } from "@/lib/format";
import type { SituationMemberView, SituationView } from "@/lib/situations/apiTypes";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";
import {
  buildAdjustmentHighlightParts,
  formatCurrentDteLabel,
  formatFillLine,
  sumMemberNets,
  type AdjustmentHighlightPart,
} from "@/lib/situations/formatSituationFill";
import {
  buildSituationTree,
  situationBlockFigures,
  type SituationTreeNode,
} from "@/lib/situations/situationTree";
import { pnlTone, SITUATION_ACTION_LINE_CLASS, SITUATION_FILL_CASHFLOW_CLASS } from "@/lib/situations/situationPnlTone";

export { pnlTone };

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

const ADJUSTMENT_CHANGED_CLASS =
  "rounded px-1 bg-amber-400/20 text-amber-100 ring-1 ring-amber-400/50";

function AdjustmentHeadlineParts({ parts }: { parts: AdjustmentHighlightPart[] }) {
  return (
    <span className={"ml-2 font-medium " + SITUATION_ACTION_LINE_CLASS}>
      {parts.map((p, i) =>
        p.kind === "token" && p.changed ? (
          <span key={i} className={ADJUSTMENT_CHANGED_CLASS}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** Shared width so open credit, fill cashflow, realized, and total form one column. */
const TREE_AMOUNT_CLASS = "w-[8.5rem] shrink-0 text-right tabular-nums";

function CashflowAmount({ net, masked }: { net: number | null; masked: boolean }) {
  return (
    <span className={TREE_AMOUNT_CLASS + " font-medium " + SITUATION_FILL_CASHFLOW_CLASS}>
      {usd(net, masked)}
    </span>
  );
}

function LabeledAmount({
  label,
  net,
  masked,
  toneClass,
  emphasize,
}: {
  label: string;
  net: number | null;
  masked: boolean;
  toneClass: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-baseline justify-end gap-2">
      <span className="text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className={TREE_AMOUNT_CLASS + " " + (emphasize ? "font-semibold " : "font-medium ") + toneClass}>
        {usd(net, masked)}
      </span>
    </div>
  );
}

/** Close/leg/open fill rows: description + debit/credit stay grey. Never posNeg. */
function CashflowFillRow({
  line,
  net,
  masked,
  indent,
}: {
  line: string;
  net: number | null;
  masked: boolean;
  indent?: boolean;
}) {
  return (
    <li className={"flex items-start gap-x-3 text-[11px] " + SITUATION_FILL_CASHFLOW_CLASS}>
      <span className={"min-w-0 flex-1 " + (indent ? "pl-3 " : "") + SITUATION_FILL_CASHFLOW_CLASS}>{line}</span>
      <CashflowAmount net={net} masked={masked} />
    </li>
  );
}

function OpenFillLines({ members, masked }: { members: SituationMemberView[]; masked: boolean }) {
  if (members.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {members.map((m) => (
        <CashflowFillRow
          key={m.transactionId + ":" + m.role}
          line={formatFillLine(m)}
          net={m.netAmount}
          masked={masked}
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
  return (
    <ul className="mt-1 space-y-1">
      {closeMembers.map((m) => (
        <CashflowFillRow
          key={"c:" + m.transactionId}
          line={"closed · " + formatFillLine(m)}
          net={m.netAmount}
          masked={masked}
          indent
        />
      ))}
      {openMembers.map((m) => (
        <CashflowFillRow
          key={"o:" + m.transactionId}
          line={"opened · " + formatFillLine(m)}
          net={m.netAmount}
          masked={masked}
          indent
        />
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
        <CashflowFillRow line={formatFillLine(m)} net={m.netAmount} masked={masked} />
      </ul>
    );
  }
  const combined = sumMemberNets(members);
  return (
    <ul className="mt-1 space-y-1">
      <CashflowFillRow line={members.length + " closes · net"} net={combined} masked={masked} />
      {members.map((m) => (
        <CashflowFillRow
          key={m.transactionId}
          line={formatFillLine(m)}
          net={m.netAmount}
          masked={masked}
          indent
        />
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
  const adjustmentParts =
    node.kind === "adjustment"
      ? buildAdjustmentHighlightParts(node.closeMembers, node.openMembers)
      : null;

  let headline = "";
  if (node.kind === "open") headline = "Initial open";
  else if (node.kind === "adjustment") headline = ""; // rendered via adjustmentParts
  else if (node.kind === "close")
    headline = node.members.length === 1 ? formatFillLine(node.members[0]!) : "Close · " + node.members.length + " fills";
  else if (node.kind === "current") {
    const dte = formatCurrentDteLabel(node.symbols);
    headline = dte ? `Current structure · ${dte}` : "Current structure";
  } else if (node.kind === "leg") headline = "Legged out · " + formatFillLine(node.member);
  else headline = "Step";

  const figures = situationBlockFigures(node);
  const openCreditTone = pnlTone(figures.openCredit, { realized: false });
  const realizedTone = pnlTone(figures.realized, { realized: true });
  const totalTone = pnlTone(figures.total, { realized: true });

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
          <div className="flex items-start justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <span className="font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                {kindTitle(node.kind)}
              </span>
              {adjustmentParts ? (
                <AdjustmentHeadlineParts parts={adjustmentParts} />
              ) : (
                <span className={"ml-2 font-medium " + SITUATION_ACTION_LINE_CLASS}>{headline}</span>
              )}
            </div>
            {figures.openCredit != null ? (
              <LabeledAmount
                label="Open credit"
                net={figures.openCredit}
                masked={masked}
                toneClass={openCreditTone}
              />
            ) : null}
          </div>
          {node.kind === "open" ? <OpenFillLines members={node.members} masked={masked} /> : null}
          {node.kind === "adjustment" ? (
            <AdjustmentFillLines
              closeMembers={node.closeMembers}
              openMembers={node.openMembers}
              masked={masked}
            />
          ) : null}
          {node.kind === "close" ? <CloseFillLines members={node.members} masked={masked} /> : null}
          {node.kind === "leg" ? (
            <ul className="mt-1 space-y-1">
              <CashflowFillRow line={formatFillLine(node.member)} net={node.member.netAmount} masked={masked} />
            </ul>
          ) : null}
          {figures.showRealizedStep ? (
            <div className="mt-1 space-y-0.5">
              <LabeledAmount
                label="Realized"
                net={figures.realized}
                masked={masked}
                toneClass={realizedTone}
                emphasize
              />
              {figures.total != null ? (
                <LabeledAmount
                  label="Total"
                  net={figures.total}
                  masked={masked}
                  toneClass={totalTone}
                  emphasize
                />
              ) : null}
            </div>
          ) : null}
          {node.kind === "current" ? (
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
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
      <div className="mb-3 flex max-w-3xl flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
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
        <p className="text-xs text-zinc-600 dark:text-zinc-300">No fills linked on this situation yet.</p>
      ) : (
        <ol className="max-w-3xl space-y-0">
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
