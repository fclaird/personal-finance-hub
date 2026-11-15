/**
 * Coalesce concurrent callers onto one in-flight promise.
 * The assignment is synchronous, so a second caller cannot start a duplicate run.
 */
export function createSingleFlight<T>() {
  let inflight: Promise<T> | null = null;
  let started = 0;

  return {
    get started() {
      return started;
    },
    get pending() {
      return inflight != null;
    },
    run(fn: () => Promise<T>): Promise<T> {
      if (inflight) return inflight;
      started += 1;
      const p = Promise.resolve().then(fn);
      let wrapped: Promise<T>;
      wrapped = p.finally(() => {
        if (inflight === wrapped) inflight = null;
      });
      inflight = wrapped;
      return wrapped;
    },
  };
}
