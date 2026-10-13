/**
 * Full-width page column. Padding only — no centered max-width.
 * overflow-x is clip so a wide child cannot grow the window; vertical scroll stays on the shell.
 */
export const PAGE_FRAME =
  "box-border flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 overflow-x-clip py-6 pl-4 pr-5 sm:py-8 sm:pl-6 sm:pr-8 [&>*]:min-w-0 [&>*]:max-w-full";

/**
 * Draggable page panels. Each panel stays at least 420px and takes a share of the row.
 * A fixed minimum (not min(100%, …)) is what makes extra panels wrap instead of shrinking
 * until the page clips them. A layout nested inside one of these panels must use TILE_STACK.
 */
export const TILE_GRID =
  "grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(420px,1fr))] items-start gap-6 [&>*]:min-w-0 [&>*]:max-w-full";

/** Major page sections stacked at the full window width. Use this outside a nested panel grid. */
export const TILE_STACK = "flex w-full min-w-0 flex-col gap-6";

/** Structure tiles and similar cards. */
export const CARD_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start gap-4 [&>*]:min-w-0";

/** Compact stat cards. */
export const STAT_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-start gap-3 [&>*]:min-w-0";

/** Form fields that should stay a readable width and still fill the row. */
export const FIELD_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] items-end gap-3 [&>*]:min-w-0";
