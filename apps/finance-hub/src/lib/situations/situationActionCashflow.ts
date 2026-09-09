import { sumMemberNets } from "@/lib/situations/formatSituationFill";
import type { SituationTreeNode } from "@/lib/situations/situationTree";
import { SITUATION_FILL_CASHFLOW_CLASS } from "@/lib/situations/situationPnlTone";

/**
 * Right-column cashflow on a CLOSE / LEG OUT action row: the BTC debit (or credit),
 * never realized G/L. UI must paint this with SITUATION_FILL_CASHFLOW_CLASS.
 */
export function situationActionCashflow(node: SituationTreeNode): number | null {
  if (node.kind === "leg") {
    const n = node.member.netAmount;
    return n != null && Number.isFinite(n) ? n : null;
  }
  if (node.kind === "close") return sumMemberNets(node.members);
  return null;
}

export function situationActionCashflowClass(): string {
  return SITUATION_FILL_CASHFLOW_CLASS;
}
