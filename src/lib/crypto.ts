import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// AES-256-GCM encrypt/decrypt for storing third-party session tokens.
// Format: base64(iv):base64(authTag):base64(ciphertext) — same layout used
// by the sync script (scripts/sync.mjs) so both sides stay compatible.
export function encrypt(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("Encryption key must decode to 32 bytes");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(encrypted: string, base64Key: string): string {
  const key = Buffer.from(base64Key.trim(), "base64");
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt — the encryption key does not match the one used to encrypt this value"
    );
  }
}
