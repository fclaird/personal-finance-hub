export type PlaidEnv = "sandbox" | "development" | "production";

export type PlaidConfig = {
  clientId: string;
  secret: string;
  env: PlaidEnv;
};

export function getPlaidConfig(): PlaidConfig {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV ?? "sandbox") as PlaidEnv;

  if (!clientId) throw new Error("Missing env var: PLAID_CLIENT_ID");
  if (!secret) throw new Error("Missing env var: PLAID_SECRET");
  if (!env) throw new Error("Missing env var: PLAID_ENV");
  return { clientId, secret, env };
}

