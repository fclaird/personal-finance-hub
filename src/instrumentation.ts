/**
 * Server bootstrap hooks. Loaded for both Edge and Node; keep this file Edge-safe —
 * Node-only imports live in `./instrumentation-node` and load only when
 * NEXT_RUNTIME is nodejs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNodeInstrumentation } = await import("./instrumentation-node");
  registerNodeInstrumentation();
}
