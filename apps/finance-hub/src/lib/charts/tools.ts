export type ChartTool =
  | "crosshair"
  | "trend"
  | "ray"
  | "hline"
  | "channel"
  | "fib"
  | "text"
  | "measure"
  | "delete";

export const TOOL_SHORTCUT: Record<ChartTool, string> = {
  crosshair: "Esc",
  trend: "Alt+T",
  ray: "Alt+R",
  hline: "Alt+H",
  channel: "Alt+P",
  fib: "Alt+F",
  text: "Alt+X",
  measure: "Alt+M",
  delete: "Delete",
};
