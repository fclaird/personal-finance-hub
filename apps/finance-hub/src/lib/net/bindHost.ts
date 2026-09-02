/** Host/port helpers for localhost vs VPN/LAN bind. */

export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
}

export function resolveListenPort(env: NodeJS.ProcessEnv = process.env, fallback = 3000): number {
  const n = Number(env.PORT ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

/** Non-loopback binds (0.0.0.0, Tailscale IP, LAN) require FINANCE_HUB_API_KEY. */
export function remoteBindBlockedReason(host: string, apiKey: string | undefined | null): string | null {
  if (isLoopbackBindHost(host)) return null;
  if (apiKey?.trim()) return null;
  return (
    `Refusing to bind ${host} without FINANCE_HUB_API_KEY. ` +
    `Loopback (127.0.0.1) is open by default; VPN/LAN bind requires a key. ` +
    `See docs/remote-desktop-vpn.md.`
  );
}
