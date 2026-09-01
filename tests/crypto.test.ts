import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptCredential, encryptCredential } from "../src/lib/crypto.ts";

test("Moodle credentials use the versioned AES-GCM envelope without plaintext", async () => {
  const key = randomBytes(32).toString("base64");
  const token = "fixture-token-that-must-not-leak";
  const encrypted = await encryptCredential({ token }, key);
  assert.equal(encrypted.includes(token), false);
  const envelope = JSON.parse(encrypted) as { version: number; algorithm: string; iv: string; ciphertext: string };
  assert.equal(envelope.version, 1);
  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.ok(envelope.iv.length > 0 && envelope.ciphertext.length > 0);
  assert.deepEqual(await decryptCredential<{ token: string }>(encrypted, key), { token });
});

test("credential decryption fails with the wrong key without exposing plaintext", async () => {
  const encrypted = await encryptCredential({ token: "redacted" }, randomBytes(32).toString("base64"));
  await assert.rejects(() => decryptCredential(encrypted, randomBytes(32).toString("base64")), /decryption failed/i);
});
