/**
 * Stale Financial Bridge processes only.
 * A node process on another port, or one whose command is not this app, is kept.
 */
export function selectHubPids(processes, { selfPid, root, port = 3000 }) {
  const rootText = String(root || "");
  const chosen = [];
  for (const proc of processes) {
    const pid = Number(proc.pid);
    if (!Number.isFinite(pid) || pid <= 1 || pid === selfPid) continue;
    const command = String(proc.command || "");
    const cwd = String(proc.cwd || "");
    const fromRepo =
      (rootText && (cwd === rootText || cwd.startsWith(`${rootText}/`) || command.includes(rootText))) ||
      false;
    const hubCommand = /next-server|\bnext[\s/]|\bnext$|scripts\/start\.mjs|scripts\/dev\.mjs|serve-production\.mjs/.test(
      command,
    );
    const onHubPort = Array.isArray(proc.ports) && proc.ports.includes(port);
    if (onHubPort && (fromRepo || hubCommand)) {
      chosen.push(pid);
      continue;
    }
    if (fromRepo && hubCommand) chosen.push(pid);
  }
  return [...new Set(chosen)];
}
