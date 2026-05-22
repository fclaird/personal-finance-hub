function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function getSecretsPassphrase(): string {
  return requireEnv("FINANCE_HUB_PASSPHRASE");
}

