import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

import { getPlaidConfig } from "@/lib/plaid/config";

export function getPlaidClient(): PlaidApi {
  const cfg = getPlaidConfig();
  const env = PlaidEnvironments[cfg.env];
  const configuration = new Configuration({
    basePath: env,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": cfg.clientId,
        "PLAID-SECRET": cfg.secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

