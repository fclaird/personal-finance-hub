import crypto from "node:crypto";
import fs from "node:fs";

import { decryptJson, deriveKeyFromPassphrase, encryptJson, type EncryptedBlob } from "@/lib/crypto";
import { ensureDirSync, writeFileAtomicSync } from "@/lib/fs";
import { getAppDataDir, getSecretsPath } from "@/lib/paths";

const AAD = "finance-hub-secrets";
const SALT_LEN = 16;

type SecretsFile = {
  v: 1;
  salt_b64: string;
  blob: EncryptedBlob;
};

export type AppSecrets = {
  // Connectors will populate these.
  plaid?: {
    clientId: string;
    secret: string;
    env: "sandbox" | "development" | "production";
  };
  schwab?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  // Generic storage for access/refresh tokens by connector.
  tokens?: Record<string, unknown>;
};

export function loadSecrets(passphrase: string): AppSecrets {
  ensureDirSync(getAppDataDir());
  const secretsPath = getSecretsPath();
  if (!fs.existsSync(secretsPath)) return {};

  const raw = fs.readFileSync(secretsPath, "utf-8");
  const parsed = JSON.parse(raw) as SecretsFile;
  if (parsed.v !== 1) throw new Error("Unsupported secrets file version.");
  const salt = Buffer.from(parsed.salt_b64, "base64");
  const key = deriveKeyFromPassphrase(passphrase, salt);
  return decryptJson<AppSecrets>(key, parsed.blob, AAD);
}

export function saveSecrets(passphrase: string, secrets: AppSecrets) {
  ensureDirSync(getAppDataDir());
  const secretsPath = getSecretsPath();

  let salt: Buffer;
  if (fs.existsSync(secretsPath)) {
    const raw = fs.readFileSync(secretsPath, "utf-8");
    const parsed = JSON.parse(raw) as SecretsFile;
    salt = Buffer.from(parsed.salt_b64, "base64");
  } else {
    salt = crypto.randomBytes(SALT_LEN);
  }

  const key = deriveKeyFromPassphrase(passphrase, salt);
  const blob = encryptJson(key, secrets, AAD);
  const out: SecretsFile = { v: 1, salt_b64: salt.toString("base64"), blob };
  writeFileAtomicSync(secretsPath, JSON.stringify(out, null, 2));
}

