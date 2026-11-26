"use client";

import type { ReactNode } from "react";

import type { ChartTool } from "@/lib/charts/tools";
import { TOOL_SHORTCUT } from "@/lib/charts/tools";
import type { DrawDash, DrawStyle } from "@/lib/charts/drawings";

const TOOLS: Array<{ id: ChartTool; label: string; icon: string }> = [
  { id: "crosshair", label: "Crosshair", icon: "+" },
  { id: "trend", label: "Trend line", icon: "╱" },
  { id: "ray", label: "Ray", icon: "→" },
  { id: "hline", label: "Horizontal line", icon: "―" },
  { id: "channel", label: "Parallel channel", icon: "═" },
  { id: "fib", label: "Fibonacci", icon: "φ" },
  { id: "text", label: "Text", icon: "T" },
  { id: "measure", label: "Measure", icon: "↔" },
];

export function ChartToolbar({
  tool,
  onTool,
  magnet,
  onMagnet,
  locked,
  onLocked,
  hidden,
  onHidden,
  onDelete,
  pen,
  onPen,
}: {
  tool: ChartTool;
  onTool: (tool: ChartTool) => void;
  magnet: boolean;
  onMagnet: (value: boolean) => void;
  locked: boolean;
  onLocked: (value: boolean) => void;
  hidden: boolean;
  onHidden: (value: boolean) => void;
  onDelete: () => void;
  pen: DrawStyle;
  onPen: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <div className="flex w-[76px] shrink-0 flex-col gap-1 border-r border-zinc-700 bg-zinc-950 p-1.5">
      {TOOLS.map((item) => (
        <ToolButton key={item.id} active={tool === item.id} label={`${item.label} (${TOOL_SHORTCUT[item.id]})`} onClick={() => onTool(item.id)}>
          {item.icon}
        </ToolButton>
      ))}
      <div className="my-1 h-px bg-zinc-700" />
      <ToolButton active={magnet} label="Magnet snap to OHLC (Alt+G)" onClick={() => onMagnet(!magnet)}>
        ⌖
      </ToolButton>
      <ToolButton active={locked} label="Lock drawings (Alt+L)" onClick={() => onLocked(!locked)}>
        {locked ? "🔒" : "🔓"}
      </ToolButton>
      <ToolButton active={hidden} label="Hide drawings (Alt+V)" onClick={() => onHidden(!hidden)}>
        {hidden ? "◌" : "◉"}
      </ToolButton>
      <ToolButton active={tool === "delete"} label="Delete drawing (Delete)" onClick={onDelete}>
        ⌫
      </ToolButton>
      <label className="mt-2 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
        Color
        <input
          type="color"
          aria-label="Drawing color"
          value={pen.color}
          onChange={(event) => onPen({ color: event.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-zinc-400 bg-zinc-900"
          style={{ colorScheme: "dark" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
        Width
        <select
          aria-label="Drawing width"
          value={pen.width}
          onChange={(event) => onPen({ width: Number(event.target.value) as DrawStyle["width"] })}
          className="h-8 rounded border border-zinc-400 bg-zinc-900 px-1 text-sm text-zinc-100"
          style={{ colorScheme: "dark" }}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
        Dash
        <select
          aria-label="Drawing dash"
          value={pen.dash}
          onChange={(event) => onPen({ dash: event.target.value as DrawDash })}
          className="h-8 rounded border border-zinc-400 bg-zinc-900 px-1 text-sm text-zinc-100"
          style={{ colorScheme: "dark" }}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dash</option>
          <option value="dotted">Dot</option>
        </select>
      </label>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={
        "flex h-9 w-full items-center justify-center rounded border text-sm text-zinc-100 " +
        (active ? "border-zinc-200 bg-zinc-800" : "border-zinc-400 bg-zinc-900 hover:bg-zinc-800")
      }
    >
      {children}
    </button>
  );
}
