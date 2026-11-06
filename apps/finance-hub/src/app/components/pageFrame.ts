/**
 * Full-width page column. Padding only — no centered max-width.
 * overflow-x is clip so a wide child cannot grow the window; vertical scroll stays on the shell.
 */
export const PAGE_FRAME =
  "box-border flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 overflow-x-clip py-6 pl-4 pr-5 sm:py-8 sm:pl-6 sm:pr-8 [&>*]:min-w-0 [&>*]:max-w-full";

/** Page tiles. Two across from about 1280, then more as the window grows. */
export const TILE_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] items-start gap-6 [&>*]:min-w-0";

/** Structure tiles and similar cards. */
export const CARD_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start gap-4 [&>*]:min-w-0";

/** Compact stat cards. */
export const STAT_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-start gap-3 [&>*]:min-w-0";

/** Form fields that should stay a readable width and still fill the row. */
export const FIELD_GRID =
  "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] items-end gap-3 [&>*]:min-w-0";
