import { loadSecrets, saveSecrets } from "@/lib/secrets";

export type SchwabToken = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  obtained_at: number; // epoch ms
};

type TokenBag = {
  schwab?: SchwabToken;
};

export function getSchwabToken(passphrase: string): SchwabToken | null {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  return tokens.schwab ?? null;
}

export function setSchwabToken(passphrase: string, token: SchwabToken) {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  tokens.schwab = token;
  saveSecrets(passphrase, { ...secrets, tokens });
}

/** Remove Schwab tokens so the app shows disconnected (e.g. after refresh_token auth failure). */
export function clearSchwabToken(passphrase: string) {
  const secrets = loadSecrets(passphrase);
  const bag = { ...(secrets.tokens ?? {}) } as Record<string, unknown>;
  delete bag.schwab;
  saveSecrets(passphrase, {
    ...secrets,
    tokens: Object.keys(bag).length > 0 ? bag : undefined,
  });
}

