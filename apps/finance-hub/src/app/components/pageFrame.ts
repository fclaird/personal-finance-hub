/**
 * Full-width page column. Padding only — no centered max-width.
 * overflow-x is clip so a wide child cannot grow the window; vertical scroll stays on the shell.
 */
export const PAGE_FRAME =
  "box-border flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 overflow-x-clip py-6 pl-4 pr-5 sm:py-8 sm:pl-6 sm:pr-8 [&>*]:min-w-0 [&>*]:max-w-full";
