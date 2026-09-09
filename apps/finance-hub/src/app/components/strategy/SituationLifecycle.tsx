"use client";

import { formatSignedUsd2, formatUsd2 } from "@/lib/format";
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
  flattenSituationTree,
  situationBlockFigures,
  type SituationTreeNode,
} from "@/lib/situations/situationTree";
import { pnlTone, SITUATION_ACTION_LINE_CLASS, SITUATION_FILL_CASHFLOW_CLASS } from "@/lib/situations/situationPnlTone";

export { pnlTone };

/** Book title and each adjustment heading: `net   credits $…   gain $…`. */
export function SituationHeadingTotals({
  openCredit,
  realized,
  privacyMasked,
}: {
  openCredit: number | null;
  realized: number | null;
  privacyMasked: boolean;
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-4 text-base">
      <span className={"text-base font-medium " + SITUATION_FILL_CASHFLOW_CLASS}>net</span>
      <span className={"inline-flex items-baseline gap-1.5 text-base font-medium tabular-nums " + SITUATION_FILL_CASHFLOW_CLASS}>
        <span className="text-base font-medium">credits</span>
        <span className="text-base font-medium tabular-nums">
          {openCredit == null ? "—" : formatUsd2(openCredit, { mask: privacyMasked })}
        </span>
      </span>
      <span className={"inline-flex items-baseline gap-1.5 text-base font-bold tabular-nums " + pnlTone(realized, { realized: true })}>
        <span className="text-base font-bold">gain</span>
        <span className="text-base font-bold tabular-nums">
          {realized == null ? "—" : formatSignedUsd2(realized, { mask: privacyMasked })}
        </span>
      </span>
    </div>
  );
}

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

/** Two-column tree: identity on the left, heading totals + fill cashflow on the right. */
const TREE_GRID_CLASS = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5";
const TREE_AMOUNT_CLASS = "w-[8.5rem] shrink-0 text-right tabular-nums";

function CashflowAmount({ net, masked }: { net: number | null; masked: boolean }) {
  return (
    <span className={TREE_AMOUNT_CLASS + " justify-self-end font-medium " + SITUATION_FILL_CASHFLOW_CLASS}>
      {usd(net, masked)}
    </span>
  );
}

/** Close/leg/open fill rows: description left, debit/credit right. Never posNeg. */
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
    <li className="contents">
      <span className={"min-w-0 text-[11px] " + (indent ? "pl-3 " : "") + SITUATION_FILL_CASHFLOW_CLASS}>{line}</span>
      <CashflowAmount net={net} masked={masked} />
    </li>
  );
}

function OpenFillLines({ members, masked }: { members: SituationMemberView[]; masked: boolean }) {
  if (members.length === 0) return null;
  return (
    <ul className="contents">
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
    <ul className="contents">
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
      <ul className="contents">
        <CashflowFillRow line={formatFillLine(m)} net={m.netAmount} masked={masked} />
      </ul>
    );
  }
  const combined = sumMemberNets(members);
  return (
    <ul className="contents">
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
  isFirst,
  isLast,
}: {
  node: SituationTreeNode;
  masked: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
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

  return (
    <li className="relative">
      <div className="flex gap-3">
        <div className="relative flex w-4 flex-col items-center">
          {!isFirst ? (
            <span className="absolute -top-2 left-1/2 h-2 w-px -translate-x-1/2 bg-zinc-300 dark:bg-white/25" aria-hidden />
          ) : null}
          <span className={"relative z-[1] mt-1 h-2.5 w-2.5 rounded-full " + kindDotClass(node.kind)} />
          {!isLast ? (
            <span className="mt-1 w-px flex-1 bg-zinc-300 dark:bg-white/25" aria-hidden />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 border-b border-zinc-200 pb-2 pt-0.5 dark:border-white/25">
          <div className={TREE_GRID_CLASS}>
            <div className="min-w-0 text-xs">
              <span className="font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                {kindTitle(node.kind)}
              </span>
              {adjustmentParts ? (
                <AdjustmentHeadlineParts parts={adjustmentParts} />
              ) : (
                <span className={"ml-2 font-medium " + SITUATION_ACTION_LINE_CLASS}>{headline}</span>
              )}
            </div>
            <SituationHeadingTotals
              openCredit={figures.openCredit}
              realized={figures.total}
              privacyMasked={masked}
            />
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
              <ul className="contents">
                <CashflowFillRow line={formatFillLine(node.member)} net={node.member.netAmount} masked={masked} />
              </ul>
            ) : null}
            {figures.showRealizedStep ? (
              <>
                <span aria-hidden />
                <span
                  className={
                    "inline-flex items-baseline justify-end gap-1.5 justify-self-end text-base font-semibold tabular-nums " +
                    pnlTone(figures.realized, { realized: true })
                  }
                  title="Realized G/L locked in by this step"
                >
                  <span className="text-base font-semibold">realized</span>
                  <span className="text-base font-semibold tabular-nums">
                    {figures.realized == null ? "—" : formatSignedUsd2(figures.realized, { mask: masked })}
                  </span>
                </span>
              </>
            ) : null}
          {node.kind === "current" ? (
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
              Live structure at the tip of this book. Mark-to-market is on the snapshot legs above.
              {formatCurrentDteLabel(node.symbols) ? ` · ${formatCurrentDteLabel(node.symbols)}` : ""}
            </p>
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
  const rows = flattenSituationTree(tree);
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
      </div>
      {tree.length === 0 ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">No fills linked on this situation yet.</p>
      ) : (
        <ol className="max-w-3xl space-y-0">
          {rows.map((node, idx) => (
            <TreeNodeView
              key={node.id}
              node={node}
              masked={privacyMasked}
              isFirst={idx === 0}
              isLast={idx === rows.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
