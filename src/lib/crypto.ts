import { webcrypto } from "node:crypto";

interface CredentialEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

function keyBytes(base64Key: string): ArrayBuffer {
  const bytes = Uint8Array.from(Buffer.from(base64Key.trim(), "base64"));
  if (bytes.length !== 32) throw new Error("Encryption key must decode to 32 bytes");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptCredential(payload: Record<string, unknown>, base64Key: string): Promise<string> {
  const key = await webcrypto.subtle.importKey("raw", keyBytes(base64Key), "AES-GCM", false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)),
  );
  const envelope: CredentialEnvelope = {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
  return JSON.stringify(envelope);
}

export async function decryptCredential<T>(encrypted: string, base64Key: string): Promise<T> {
  const envelope = JSON.parse(encrypted) as CredentialEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") throw new Error("Unsupported encrypted credential format");
  const key = await webcrypto.subtle.importKey("raw", keyBytes(base64Key), "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(Buffer.from(envelope.iv, "base64")) },
      key,
      Uint8Array.from(Buffer.from(envelope.ciphertext, "base64")),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new Error("Credential decryption failed");
  }
}
