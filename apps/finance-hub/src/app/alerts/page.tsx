"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { DraggableColumnHeader, DRAGGABLE_COLUMN_HEADER_GRAB_CLASS } from "@/app/components/DraggableColumnHeader";
import { ColumnLabel } from "@/app/components/ColumnLabel";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatInt, formatNum, formatOptionIntExtPerShare, formatUsd2 } from "@/lib/format";
import { formatDisplayDateTime } from "@/lib/formatDate";
import { formatOptionSymbolDisplay } from "@/lib/formatOptionDisplay";
import { optionMarginRoiForRow } from "@/lib/options/optionMarginRoiDisplay";
import { optionPositionTheta } from "@/lib/options/optionPositionTheta";
import {
  optionMarkPerShare,
  optionPnlDollarsFromAvgPrice,
  optionPnlPctFromAvgPrice,
} from "@/lib/options/optionPnlFromAvgPrice";
import { posNegClass } from "@/lib/terminal/colors";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { usePersistedColumnOrder } from "@/lib/usePersistedColumnOrder";
import type { AlertRuleType } from "@/lib/alerts";
import type { OptionRiskPosition, OptionRiskSummary } from "@/lib/alerts/optionRisk";

type RuleConfig = Record<string, unknown>;
type Rule = { id: string; type: AlertRuleType; enabled: boolean; config: RuleConfig };
type EventRow = { id: string; occurred_at: string; severity: string; title: string; details_json: string | null; rule_type: string };

type OptionContractRow = {
  positionId: string;
  accountId: string;
  accountName: string;
  symbol: string;
  securityType: string;
  underlyingSymbol: string | null;
  effectiveUnderlyingSymbol?: string | null;
  optionExpiration: string | null;
  optionRight: "C" | "P" | null;
  optionStrike: number | null;
  quantity: number;
  averagePrice?: number | null;
  price: number | null;
  marketValue: number | null;
  dte: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
  theta: number | null;
};

const DTE_THRESHOLD = 30;
/** Extrinsic must be strictly less than this fraction of intrinsic (intrinsic &gt; 0). */
const EXTRINSIC_VS_INTRINSIC_MAX = 0.1;

const OPTION_COLUMN_IDS = [
  "account",
  "symbol",
  "qty",
  "price",
  "tradePrice",
  "marketValue",
  "marginSecured",
  "roi",
  "annualizedRoi",
  "pnlPct",
  "pnlPctPct",
  "intrinsic",
  "extrinsic",
  "extrinsicPctIntrinsic",
  "dte",
  "positionTheta",
] as const;
type OptionColumnId = (typeof OPTION_COLUMN_IDS)[number];

const EVENT_COLUMN_IDS = ["when", "severity", "title", "rule"] as const;
type EventColumnId = (typeof EVENT_COLUMN_IDS)[number];

const OPTION_COLUMN_TABLE_KEY = "alerts:optionContractColumns";
const EVENT_COLUMN_TABLE_KEY = "alerts:recentEventsColumns";

const OPTION_COLUMN_LABEL: Record<OptionColumnId, string> = {
  account: "Account",
  symbol: "Symbol",
  qty: "Qty",
  price: "Spot",
  tradePrice: "Trade",
  marketValue: "Market value",
  marginSecured: "Margin $ secured",
  roi: "ROI",
  annualizedRoi: "Ann. ROI",
  pnlPct: "P/L",
  pnlPctPct: "P/L %",
  intrinsic: "Intrinsic",
  extrinsic: "Extrinsic",
  extrinsicPctIntrinsic: "% extrinsic",
  dte: "DTE",
  positionTheta: "Pos theta",
};

const EVENT_COLUMN_LABEL: Record<EventColumnId, string> = {
  when: "When",
  severity: "Severity",
  title: "Title",
  rule: "Rule",
};

function optionEntryPricePerShare(r: Pick<OptionContractRow, "averagePrice" | "price">): number | null {
  const entry = r.averagePrice;
  return entry != null && Number.isFinite(entry) ? entry : null;
}

function optionMarkPricePerShare(
  r: Pick<OptionContractRow, "price" | "marketValue" | "quantity">,
): number | null {
  if (r.price != null && Number.isFinite(r.price)) return Math.abs(r.price);
  return optionMarkPerShare(r.marketValue, r.quantity);
}

function optionPnlInputs(r: OptionContractRow) {
  return {
    price: optionEntryPricePerShare(r),
    marketValue: r.marketValue,
    quantity: r.quantity,
  };
}

/** Short call (sold call) — covered-style margin display on Alerts. */
function isSoldCallRow(r: Pick<OptionContractRow, "securityType" | "quantity" | "optionRight">): boolean {
  return r.securityType === "option" && r.quantity < 0 && r.optionRight === "C";
}

const SOLD_CALL_ROW_CLASS =
  "bg-orange-100/90 dark:bg-orange-500/20 border-orange-300/70 dark:border-orange-500/35";

/** Extrinsic as a percentage of intrinsic (position totals from API; ratio equals per-contract). */
function formatExtrinsicPctOfIntrinsic(intrinsic: number | null, extrinsic: number | null): string {
  if (intrinsic == null || extrinsic == null) return "—";
  if (!Number.isFinite(intrinsic) || !Number.isFinite(extrinsic) || intrinsic <= 0) return "—";
  const pct = (extrinsic / intrinsic) * 100;
  return `${formatNum(pct, 1)}%`;
}

type OptionContractTotals = {
  quantity: number;
  marketValue: number | null;
  marginSecured: number | null;
  pnlDollars: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
  positionTheta: number | null;
};

function nFinite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function computeOptionContractTotals(rows: OptionContractRow[]): OptionContractTotals {
  let quantity = 0;
  let marketValue = 0;
  let marketValueAny = false;
  let marginSecured = 0;
  let marginAny = false;
  let pnlDollars = 0;
  let pnlAny = false;
  let intrinsic = 0;
  let intrinsicAny = false;
  let extrinsic = 0;
  let extrinsicAny = false;
  let positionTheta = 0;
  let positionThetaAny = false;

  for (const r of rows) {
    quantity += r.quantity;
    const mv = nFinite(r.marketValue);
    if (mv != null) {
      marketValue += mv;
      marketValueAny = true;
    }
    if (!isSoldCallRow(r)) {
      const m = optionMarginRoiForRow(r);
      if (m != null) {
        marginSecured += m.marginSecured;
        marginAny = true;
      }
    }
    const pnl = optionPnlDollarsFromAvgPrice(optionPnlInputs(r));
    if (pnl != null) {
      pnlDollars += pnl;
      pnlAny = true;
    }
    const intVal = nFinite(r.intrinsic);
    if (intVal != null) {
      intrinsic += intVal;
      intrinsicAny = true;
    }
    const extVal = nFinite(r.extrinsic);
    if (extVal != null) {
      extrinsic += extVal;
      extrinsicAny = true;
    }
    const theta = optionPositionTheta(r);
    if (theta != null) {
      positionTheta += theta;
      positionThetaAny = true;
    }
  }

  return {
    quantity,
    marketValue: marketValueAny ? marketValue : null,
    marginSecured: marginAny ? marginSecured : null,
    pnlDollars: pnlAny ? pnlDollars : null,
    intrinsic: intrinsicAny ? intrinsic : null,
    extrinsic: extrinsicAny ? extrinsic : null,
    positionTheta: positionThetaAny ? positionTheta : null,
  };
}

function AccountHeaderContent() {
  return (
    <>
      <ColumnLabel
        tableKey={OPTION_COLUMN_TABLE_KEY}
        columnId="account"
        defaultLabel={OPTION_COLUMN_LABEL.account}
        className="font-medium text-zinc-600 dark:text-zinc-400"
      />
      <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Nickname</div>
    </>
  );
}

function AccountCell({
  accountName,
  nickname,
}: {
  accountName: string;
  nickname: string | null | undefined;
}) {
  const n = (nickname ?? "").trim();
  return (
    <td className="whitespace-nowrap py-2 pr-6 align-top">
      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{accountName}</div>
      <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">{n || "—"}</div>
    </td>
  );
}

function OptionContractsRedTile({
  title,
  description,
  badgeCount,
  rows,
  nickByAccountId,
  privacy,
  emptyMessage,
  optionColumnOrder,
  moveOptionColumn,
  showTotalsRow = false,
}: {
  title: string;
  description: ReactNode;
  badgeCount: number;
  rows: OptionContractRow[];
  nickByAccountId: Map<string, string | null>;
  privacy: ReturnType<typeof usePrivacy>;
  emptyMessage: string;
  optionColumnOrder: OptionColumnId[];
  moveOptionColumn: (from: number, to: number) => void;
  showTotalsRow?: boolean;
}) {
  const nCols = optionColumnOrder.length;
  const totals = showTotalsRow && rows.length > 0 ? computeOptionContractTotals(rows) : null;

  function optionHeader(col: OptionColumnId) {
    const grab = `whitespace-nowrap py-2 pr-6 font-medium ${DRAGGABLE_COLUMN_HEADER_GRAB_CLASS}`;
    if (col === "account") {
      return (
        <DraggableColumnHeader
          key={col}
          colId={col}
          columnOrder={optionColumnOrder}
          moveColumn={moveOptionColumn}
          className={`whitespace-nowrap py-2 pr-6 text-left align-bottom ${DRAGGABLE_COLUMN_HEADER_GRAB_CLASS}`}
        >
          <AccountHeaderContent />
        </DraggableColumnHeader>
      );
    }
    if (col === "extrinsicPctIntrinsic") {
      return (
        <DraggableColumnHeader
          key={col}
          colId={col}
          columnOrder={optionColumnOrder}
          moveColumn={moveOptionColumn}
          className={`whitespace-nowrap py-2 pr-6 text-right align-bottom font-medium ${DRAGGABLE_COLUMN_HEADER_GRAB_CLASS}`}
        >
          <ColumnLabel
            tableKey={OPTION_COLUMN_TABLE_KEY}
            columnId={col}
            defaultLabel={OPTION_COLUMN_LABEL[col]}
          />
          <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            of intrinsic
          </div>
        </DraggableColumnHeader>
      );
    }
    const alignRight = col !== "symbol";
    return (
      <DraggableColumnHeader
        key={col}
        colId={col}
        columnOrder={optionColumnOrder}
        moveColumn={moveOptionColumn}
        className={`${grab} ${alignRight ? "text-right" : ""}`}
      >
        <ColumnLabel tableKey={OPTION_COLUMN_TABLE_KEY} columnId={col} defaultLabel={OPTION_COLUMN_LABEL[col]} />
      </DraggableColumnHeader>
    );
  }

  function optionCell(col: OptionColumnId, r: OptionContractRow) {
    switch (col) {
      case "account":
        return (
          <AccountCell
            key={col}
            accountName={r.accountName}
            nickname={nickByAccountId.get(r.accountId)}
          />
        );
      case "symbol":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 font-medium text-zinc-900 dark:text-zinc-100">
            <SymbolLink symbol={symbolPageTargetFromInstrument(r)}>
              <span
                className={
                  r.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {formatOptionSymbolDisplay(r)}
              </span>
            </SymbolLink>
          </td>
        );
      case "qty":
        return (
          <td key={col} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.quantity)}>
            {formatInt(r.quantity)}
          </td>
        );
      case "price":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums">
            {(() => {
              const spot = optionMarkPricePerShare(r);
              return spot == null ? "—" : formatUsd2(spot, { mask: privacy.masked });
            })()}
          </td>
        );
      case "tradePrice":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums">
            {(() => {
              const entry = optionEntryPricePerShare(r);
              return entry == null ? "—" : formatUsd2(entry, { mask: privacy.masked });
            })()}
          </td>
        );
      case "marketValue":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (r.marketValue == null ? "" : posNegClass(r.marketValue))
            }
          >
            {r.marketValue == null ? "—" : formatUsd2(r.marketValue, { mask: privacy.masked })}
          </td>
        );
      case "marginSecured": {
        if (isSoldCallRow(r)) {
          return (
            <td
              key={col}
              className="whitespace-nowrap py-2 pr-6 text-right text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300"
            >
              covered
            </td>
          );
        }
        const m = optionMarginRoiForRow(r);
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
            {m == null ? "—" : formatUsd2(m.marginSecured, { mask: privacy.masked })}
          </td>
        );
      }
      case "roi": {
        const m = optionMarginRoiForRow(r);
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
            {m == null ? "—" : `${formatNum(m.roiPct, 2)}%`}
          </td>
        );
      }
      case "annualizedRoi": {
        const m = optionMarginRoiForRow(r);
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
            {m == null ? "—" : `${formatNum(m.annualizedRoiPct, 2)}%`}
          </td>
        );
      }
      case "pnlPct": {
        const pnl = optionPnlDollarsFromAvgPrice(optionPnlInputs(r));
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (pnl == null ? "text-zinc-600 dark:text-zinc-400" : posNegClass(pnl) || "text-zinc-800 dark:text-zinc-200")
            }
          >
            {pnl == null ? "—" : formatUsd2(pnl, { mask: privacy.masked })}
          </td>
        );
      }
      case "pnlPctPct": {
        const pct = optionPnlPctFromAvgPrice(optionPnlInputs(r));
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (pct == null ? "text-zinc-600 dark:text-zinc-400" : posNegClass(pct) || "text-zinc-800 dark:text-zinc-200")
            }
          >
            {pct == null ? "—" : `${formatNum(pct, 2)}%`}
          </td>
        );
      }
      case "intrinsic":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200"
          >
            {formatOptionIntExtPerShare(r.intrinsic, r.quantity, { mask: privacy.masked })}
          </td>
        );
      case "extrinsic":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200"
          >
            {formatOptionIntExtPerShare(r.extrinsic, r.quantity, { mask: privacy.masked })}
          </td>
        );
      case "extrinsicPctIntrinsic":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200"
          >
            {formatExtrinsicPctOfIntrinsic(r.intrinsic, r.extrinsic)}
          </td>
        );
      case "dte":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-red-700 dark:text-red-300"
          >
            {r.dte == null ? "—" : formatInt(r.dte)}
          </td>
        );
      case "positionTheta": {
        const posTheta = optionPositionTheta(r);
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (posTheta == null ? "text-zinc-600 dark:text-zinc-400" : posNegClass(posTheta))
            }
          >
            {posTheta == null ? "—" : formatUsd2(posTheta, { mask: privacy.masked })}
          </td>
        );
      }
      default: {
        const _exhaustive: never = col;
        return _exhaustive;
      }
    }
  }

  function optionTotalCell(col: OptionColumnId, t: OptionContractTotals) {
    switch (col) {
      case "account":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 align-top font-semibold text-zinc-900 dark:text-zinc-100">
            Total
          </td>
        );
      case "symbol":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-zinc-600 dark:text-zinc-400">
            {rows.length} contract{rows.length === 1 ? "" : "s"}
          </td>
        );
      case "qty":
        return (
          <td key={col} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold " + posNegClass(t.quantity)}>
            {formatInt(t.quantity)}
          </td>
        );
      case "marketValue":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold " +
              (t.marketValue == null ? "" : posNegClass(t.marketValue))
            }
          >
            {t.marketValue == null ? "—" : formatUsd2(t.marketValue, { mask: privacy.masked })}
          </td>
        );
      case "marginSecured":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
            {t.marginSecured == null ? "—" : formatUsd2(t.marginSecured, { mask: privacy.masked })}
          </td>
        );
      case "pnlPct":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold " +
              (t.pnlDollars == null ? "text-zinc-600 dark:text-zinc-400" : posNegClass(t.pnlDollars))
            }
          >
            {t.pnlDollars == null ? "—" : formatUsd2(t.pnlDollars, { mask: privacy.masked })}
          </td>
        );
      case "intrinsic":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
            {t.intrinsic == null ? "—" : formatUsd2(t.intrinsic, { mask: privacy.masked })}
          </td>
        );
      case "extrinsic":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
            {t.extrinsic == null ? "—" : formatUsd2(t.extrinsic, { mask: privacy.masked })}
          </td>
        );
      case "extrinsicPctIntrinsic":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-zinc-800 dark:text-zinc-200">
            {formatExtrinsicPctOfIntrinsic(t.intrinsic, t.extrinsic)}
          </td>
        );
      case "positionTheta":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold " +
              (t.positionTheta == null ? "text-zinc-600 dark:text-zinc-400" : posNegClass(t.positionTheta))
            }
          >
            {t.positionTheta == null ? "—" : formatUsd2(t.positionTheta, { mask: privacy.masked })}
          </td>
        );
      case "price":
      case "tradePrice":
      case "roi":
      case "annualizedRoi":
      case "pnlPctPct":
      case "dte":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
            —
          </td>
        );
      default: {
        const _exhaustive: never = col;
        return _exhaustive;
      }
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-100/90 via-amber-50/40 to-white dark:from-amber-600/18 dark:via-amber-950/35 dark:to-zinc-950"
        aria-hidden
      />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">
            {badgeCount} contract{badgeCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto pb-1">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-amber-200/80 text-left text-zinc-600 dark:border-amber-500/20 dark:text-zinc-400">
                {optionColumnOrder.map((col) => optionHeader(col))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.positionId}
                  className={
                    "border-b " +
                    (isSoldCallRow(r)
                      ? SOLD_CALL_ROW_CLASS
                      : "border-zinc-200/80 dark:border-white/10")
                  }
                >
                  {optionColumnOrder.map((col) => optionCell(col, r))}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={nCols} className="py-8 text-center text-zinc-600 dark:text-zinc-400">
                    {emptyMessage}
                  </td>
                </tr>
              ) : null}
              {totals ? (
                <tr className="border-t-2 border-amber-300/90 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/30">
                  {optionColumnOrder.map((col) => optionTotalCell(col, totals))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function isLowExtrinsicVsIntrinsic(row: OptionContractRow): boolean {
  if (row.securityType !== "option") return false;
  if ((row.quantity ?? 0) >= 0) return false;
  const int = row.intrinsic;
  const ext = row.extrinsic;
  if (typeof int !== "number" || !Number.isFinite(int) || int <= 0) return false;
  if (typeof ext !== "number" || !Number.isFinite(ext)) return false;
  return ext < EXTRINSIC_VS_INTRINSIC_MAX * int;
}

export default function AlertsPage() {
  const privacy = usePrivacy();
  const { order: optionColumnOrder, moveColumn: moveOptionColumn } = usePersistedColumnOrder(
    "alerts:optionContractColumns",
    OPTION_COLUMN_IDS,
  );
  const { order: eventColumnOrder, moveColumn: moveEventColumn } = usePersistedColumnOrder(
    "alerts:recentEventsColumns",
    EVENT_COLUMN_IDS,
  );
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [expiringOptions, setExpiringOptions] = useState<OptionContractRow[]>([]);
  const [lowExtrinsicOptions, setLowExtrinsicOptions] = useState<OptionContractRow[]>([]);
  const [optionRisk, setOptionRisk] = useState<OptionRiskSummary | null>(null);
  const [nickByAccountId, setNickByAccountId] = useState<Map<string, string | null>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [includeSynthetic, setIncludeSynthetic] = useState(true);

  async function load() {
    setError(null);
    const [rResp, eResp, pResp, aResp, riskResp] = await Promise.all([
      fetch("/api/alerts/rules"),
      fetch("/api/alerts/events?limit=50"),
      fetch("/api/positions", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
      fetch("/api/option-risk", { cache: "no-store" }),
    ]);
    const rJson = (await rResp.json()) as { ok: boolean; rules?: Rule[]; error?: string };
    if (!rJson.ok) throw new Error(rJson.error ?? "Failed to load rules");
    setRules(rJson.rules ?? []);
    const eJson = (await eResp.json()) as { ok: boolean; events?: EventRow[]; error?: string };
    if (!eJson.ok) throw new Error(eJson.error ?? "Failed to load events");
    setEvents(eJson.events ?? []);

    const aJson = (await aResp.json()) as {
      ok: boolean;
      accounts?: Array<{ id: string; nickname: string | null }>;
      error?: string;
    };
    const nickMap = new Map<string, string | null>();
    if (aJson.ok) {
      for (const a of aJson.accounts ?? []) nickMap.set(a.id, a.nickname ?? null);
    }
    setNickByAccountId(nickMap);

    const riskJson = (await riskResp.json()) as (OptionRiskSummary & { ok?: boolean }) | { ok: false };
    if (riskJson && "ok" in riskJson && riskJson.ok) {
      setOptionRisk(riskJson as OptionRiskSummary);
    } else {
      setOptionRisk(null);
    }

    const pJson = (await pResp.json()) as { ok: boolean; positions?: OptionContractRow[]; error?: string };
    if (pJson.ok) {
      const all = pJson.positions ?? [];
      const exp = all.filter(
        (row) =>
          row.securityType === "option" &&
          typeof row.dte === "number" &&
          Number.isFinite(row.dte) &&
          row.dte < DTE_THRESHOLD,
      );
      exp.sort((a, b) => (a.dte ?? 999) - (b.dte ?? 999));
      setExpiringOptions(exp);

      const lowEx = all.filter(isLowExtrinsicVsIntrinsic);
      lowEx.sort((a, b) => {
        const ra = a.intrinsic! > 0 ? (a.extrinsic ?? 0) / a.intrinsic! : 1;
        const rb = b.intrinsic! > 0 ? (b.extrinsic ?? 0) / b.intrinsic! : 1;
        return ra - rb;
      });
      setLowExtrinsicOptions(lowEx);
    } else {
      setExpiringOptions([]);
      setLowExtrinsicOptions([]);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function saveRule(type: Rule["type"], enabled: boolean, config: RuleConfig) {
    await fetch("/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, enabled, config }),
    });
    await load();
  }

  async function runNow() {
    setRunning(true);
    try {
      await fetch(`/api/alerts/run?synthetic=${includeSynthetic ? "1" : "0"}`, { method: "POST" });
      await load();
    } finally {
      setRunning(false);
    }
  }

  const drift = rules.find((r) => r.type === "drift");
  const conc = rules.find((r) => r.type === "concentration");
  const undefinedRisk = rules.find((r) => r.type === "undefined-risk");
  const nakedShort = rules.find((r) => r.type === "naked-short");
  const deltaBand = rules.find((r) => r.type === "delta-band");
  const optionDte = rules.find((r) => r.type === "option-dte");
  const marginPressure = rules.find((r) => r.type === "margin-pressure");
  const assignment = rules.find((r) => r.type === "assignment");
  const riskPositions: OptionRiskPosition[] = (optionRisk?.positions ?? []).filter(
    (p) => p.flags.undefinedRisk || p.flags.nakedShort,
  );
  const driftThresholdPct = (() => {
    const raw = drift?.config?.thresholdPct;
    return typeof raw === "number" ? raw : 0.05;
  })();
  const concMaxSingleUnderlyingPct = (() => {
    const raw = conc?.config?.maxSingleUnderlyingPct;
    return typeof raw === "number" ? raw : 0.25;
  })();

  const positionsBlurb = (
    <>
      From your latest position snapshots (same data as{" "}
      <Link href="/positions" className="font-medium underline-offset-4 hover:underline">
        Positions
      </Link>
      ).
    </>
  );

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <EditablePageHeading pageId="alerts" defaultTitle="Alerts" />
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            In-app alert events generated from your latest data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rebalancing"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Rebalancing
          </Link>
        </div>
      </div>

      <DraggableTileLayout
        storageKey="fh.alerts.tiles.v1"
        defaultOrder={["expiring-options", "low-extrinsic", "undefined-risk", "alert-rules", "recent-events"]}
        tiles={{
          "expiring-options": {
            title: `Options expiring within ${DTE_THRESHOLD} days`,
            bodyClassName: "relative p-4 sm:p-6",
            children: (
              <OptionContractsRedTile
                title={`Options expiring within ${DTE_THRESHOLD} days`}
                description={positionsBlurb}
                badgeCount={expiringOptions.length}
                rows={expiringOptions}
                nickByAccountId={nickByAccountId}
                privacy={privacy}
                emptyMessage={`No option positions under ${DTE_THRESHOLD} DTE in the latest snapshots.`}
                optionColumnOrder={optionColumnOrder}
                moveOptionColumn={moveOptionColumn}
                showTotalsRow
              />
            ),
          },
          "low-extrinsic": {
            title: "Low extrinsic vs intrinsic",
            bodyClassName: "relative p-4 sm:p-6",
            children: (
              <OptionContractsRedTile
                title="Low extrinsic vs intrinsic"
                description={
                  <>
                    Short option positions (negative qty) where extrinsic is under {(EXTRINSIC_VS_INTRINSIC_MAX * 100).toFixed(0)}%
                    of intrinsic (intrinsic must be positive). {positionsBlurb}
                  </>
                }
                badgeCount={lowExtrinsicOptions.length}
                rows={lowExtrinsicOptions}
                nickByAccountId={nickByAccountId}
                privacy={privacy}
                emptyMessage="No short option positions match this extrinsic / intrinsic relationship in the latest snapshots."
                optionColumnOrder={optionColumnOrder}
                moveOptionColumn={moveOptionColumn}
              />
            ),
          },
          "undefined-risk": {
            title: "Undefined-risk shorts",
            bodyClassName: "relative p-4 sm:p-6",
            children: (
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Naked short calls and short strangles have <strong>unbounded</strong> max loss. Naked puts are flagged
                  with defined max loss (strike × 100 × contracts). Live from latest snapshots +{" "}
                  <span className="font-mono text-xs">option_greeks</span>.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                        <th className="py-2 pr-4 font-medium">Underlying</th>
                        <th className="py-2 pr-4 font-medium">Structure</th>
                        <th className="py-2 pr-4 font-medium">Max loss</th>
                        <th className="py-2 pr-4 font-medium">|Δ|</th>
                        <th className="py-2 pr-4 font-medium">DTE</th>
                        <th className="py-2 pr-4 font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskPositions.map((p) => (
                        <tr key={p.positionId} className="border-b border-zinc-200 dark:border-white/20">
                          <td className="py-2 pr-4 font-semibold">{p.underlying}</td>
                          <td className="py-2 pr-4 capitalize">{p.flags.structure.replace(/-/g, " ")}</td>
                          <td className="py-2 pr-4">
                            {p.flags.maxLoss === "unbounded" ? (
                              <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-semibold text-red-950 dark:bg-red-900/70 dark:text-red-50">
                                UNBOUNDED
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Defined</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {p.flags.absDelta == null ? "—" : p.flags.absDelta.toFixed(2)}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{p.dte ?? "—"}</td>
                          <td className="py-2 pr-4 text-xs text-zinc-600 dark:text-zinc-400">
                            {[
                              p.flags.deltaOffBand ? "Δ off 0.15" : null,
                              p.flags.shortDte ? "short DTE" : null,
                              p.flags.itm ? "ITM" : p.flags.assignmentNear ? "near strike" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                      {riskPositions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                            No naked short puts/calls/strangles in the latest snapshots.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          },
          "alert-rules": {
            title: "Alert rules",
            children: (
              <>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={includeSynthetic}
              onChange={(e) => setIncludeSynthetic(e.target.checked)}
              className="h-4 w-4 accent-zinc-900 dark:accent-white"
            />
            Include synthetic (Delta) exposure
          </label>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {running ? "Running…" : "Run rules now"}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Drift rule</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => saveRule("drift", !(drift?.enabled ?? false), drift?.config ?? { thresholdPct: 0.05 })}
              >
                {drift?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Threshold (%):{" "}
              <input
                className="ml-2 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-zinc-950"
                value={(driftThresholdPct * 100).toFixed(2)}
                onChange={(e) => saveRule("drift", drift?.enabled ?? true, { thresholdPct: Number(e.target.value) / 100 })}
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Concentration rule</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() =>
                  saveRule(
                    "concentration",
                    !(conc?.enabled ?? false),
                    conc?.config ?? { maxSingleUnderlyingPct: 0.25 },
                  )
                }
              >
                {conc?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Max single underlying (%):{" "}
              <input
                className="ml-2 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-zinc-950"
                value={(concMaxSingleUnderlyingPct * 100).toFixed(2)}
                onChange={(e) =>
                  saveRule("concentration", conc?.enabled ?? true, { maxSingleUnderlyingPct: Number(e.target.value) / 100 })
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Undefined-risk shorts</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => saveRule("undefined-risk", !(undefinedRisk?.enabled ?? false), undefinedRisk?.config ?? {})}
              >
                {undefinedRisk?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Naked short calls and strangles (unbounded max loss).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Naked short puts/calls</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => saveRule("naked-short", !(nakedShort?.enabled ?? false), nakedShort?.config ?? {})}
              >
                {nakedShort?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">All uncovered short options, including puts.</p>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">|Δ| ≈ 0.15 band</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() =>
                  saveRule("delta-band", !(deltaBand?.enabled ?? false), deltaBand?.config ?? { targetAbsDelta: 0.15, deltaBand: 0.05 })
                }
              >
                {deltaBand?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Alert when short-option |delta| leaves 0.10–0.20 (from option_greeks).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Short DTE</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => saveRule("option-dte", !(optionDte?.enabled ?? false), optionDte?.config ?? { maxDte: 21 })}
              >
                {optionDte?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Short options at or under 21 DTE.</p>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Margin / BP pressure</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() =>
                  saveRule(
                    "margin-pressure",
                    !(marginPressure?.enabled ?? false),
                    marginPressure?.config ?? { maxMarginPct: 0.25 },
                  )
                }
              >
                {marginPressure?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Cash-secured-style short notional vs latest account equity (≥ 25%).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Assignment proximity</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() =>
                  saveRule("assignment", !(assignment?.enabled ?? false), assignment?.config ?? { nearStrikePct: 0.02 })
                }
              >
                {assignment?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Short options ITM or within 2% of strike.</p>
          </div>
        </div>
              </>
            ),
          },
          "recent-events": {
            title: "Recent events",
            children: (
              <>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                {eventColumnOrder.map((col) => {
                  const c = `py-2 pr-4 font-medium ${DRAGGABLE_COLUMN_HEADER_GRAB_CLASS}`;
                  return (
                    <DraggableColumnHeader
                      key={col}
                      colId={col}
                      columnOrder={eventColumnOrder}
                      moveColumn={moveEventColumn}
                      className={c}
                    >
                      <ColumnLabel
                        tableKey={EVENT_COLUMN_TABLE_KEY}
                        columnId={col}
                        defaultLabel={EVENT_COLUMN_LABEL[col]}
                      />
                    </DraggableColumnHeader>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-zinc-200 dark:border-white/20">
                  {eventColumnOrder.map((col) => {
                    switch (col) {
                      case "when":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {formatDisplayDateTime(e.occurred_at)}
                          </td>
                        );
                      case "severity":
                        return (
                          <td key={col} className="py-2 pr-4 font-medium">
                            {e.severity}
                          </td>
                        );
                      case "title":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {e.title}
                          </td>
                        );
                      case "rule":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {e.rule_type}
                          </td>
                        );
                      default: {
                        const _e: never = col;
                        return _e;
                      }
                    }
                  })}
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={eventColumnOrder.length} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No events yet. Enable a rule and run it.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
              </>
            ),
          },
        }}
      />
    </div>
  );
}
