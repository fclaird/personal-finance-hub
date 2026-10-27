/** Run `task` only when the previous run has finished. Overlapping callers are skipped. */
export function createTickGate() {
  let running = false;
  return async function runExclusive(task: () => Promise<void>): Promise<boolean> {
    if (running) return false;
    running = true;
    try {
      await task();
      return true;
    } finally {
      running = false;
    }
  };
}
