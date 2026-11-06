/** In-process hook for a newly stored alert. No email, push, or OS notification channel is connected. */

export type AlertNotice = {
  title: string;
  severity: "info" | "warning" | "critical";
  body?: string;
};

type AlertHook = (notice: AlertNotice) => void;

const hooks = new Set<AlertHook>();

export function onAlertNotice(hook: AlertHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

export function emitAlertNotice(notice: AlertNotice): void {
  for (const hook of hooks) hook(notice);
}
