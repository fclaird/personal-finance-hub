function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type XOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getXOAuthConfig(): XOAuthConfig {
  return {
    clientId: requireEnv("X_CLIENT_ID"),
    clientSecret: requireEnv("X_CLIENT_SECRET"),
    redirectUri: requireEnv("X_REDIRECT_URI"),
  };
}

export function isXOAuthConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_REDIRECT_URI);
}

export const X_OAUTH_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
export const X_OAUTH_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
export const X_API_BASE = "https://api.twitter.com/2";
