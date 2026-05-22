import { loadSecrets, saveSecrets } from "@/lib/secrets";

export type XToken = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  obtained_at: number;
  user_id?: string;
};

type TokenBag = {
  x?: XToken;
};

export function getXToken(passphrase: string): XToken | null {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  return tokens.x ?? null;
}

export function setXToken(passphrase: string, token: XToken) {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  tokens.x = token;
  saveSecrets(passphrase, { ...secrets, tokens });
}
