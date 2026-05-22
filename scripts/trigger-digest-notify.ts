/**
 * POST /api/internal/allocation-digest/notify (same machine or tunnel).
 *
 * Env: CRON_SECRET, PUBLIC_APP_URL (optional, default http://127.0.0.1:3000)
 */
async function main() {
  const base = (process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("CRON_SECRET required");
    process.exit(1);
  }

  const resp = await fetch(`${base}/api/internal/allocation-digest/notify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const text = await resp.text();
  console.log(resp.status, text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
