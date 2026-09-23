/**
 * True when production (plain HTTP) is already answering on loopback.
 * Dev is HTTPS, so this does not treat `next dev` as a healthy `next start`.
 */
export async function loopbackHealthOk(port, timeoutMs = 5000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    try {
      await resp.body?.cancel();
    } catch {
      /* ignore */
    }
    return resp.status === 200;
  } catch {
    return false;
  }
}
