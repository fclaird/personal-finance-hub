import crypto from "node:crypto";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended

export type EncryptedBlob = {
  v: 1;
  alg: "aes-256-gcm";
  iv_b64: string;
  tag_b64: string;
  ct_b64: string;
};

export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer) {
  // Scrypt params tuned for local app use; can be adjusted later.
  return crypto.scryptSync(passphrase, salt, KEY_LEN) as Buffer;
}

export function encryptJson(
  key: Buffer,
  plaintext: unknown,
  aad: string,
): EncryptedBlob {
  if (key.length !== KEY_LEN) throw new Error("Invalid key length.");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf-8"));
  const pt = Buffer.from(JSON.stringify(plaintext), "utf-8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv_b64: iv.toString("base64"),
    tag_b64: tag.toString("base64"),
    ct_b64: ct.toString("base64"),
  };
}

export function decryptJson<T>(
  key: Buffer,
  blob: EncryptedBlob,
  aad: string,
): T {
  if (blob.v !== 1 || blob.alg !== "aes-256-gcm") {
    throw new Error("Unsupported secrets format.");
  }
  const iv = Buffer.from(blob.iv_b64, "base64");
  const tag = Buffer.from(blob.tag_b64, "base64");
  const ct = Buffer.from(blob.ct_b64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf-8"));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf-8")) as T;
}

