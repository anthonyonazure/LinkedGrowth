import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";

const KEY = "3d6f45a5fd7b4b0e9c2a1f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1908f7e6";
process.env.ENCRYPTION_KEY = KEY;

import { decryptSecret } from "./crypto.ts";

/** The app's half of the format, so the worker is tested against real output. */
function encryptLikeTheApp(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "hex"), iv, {
    authTagLength: 16,
  });
  let out = cipher.update(text, "utf8", "hex");
  out += cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${out}`;
}

test("reads back what the app encrypted", () => {
  assert.equal(decryptSecret(encryptLikeTheApp("linkedin-password")), "linkedin-password");
});

test("null and empty pass through, they are not an error", () => {
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(undefined), null);
  assert.equal(decryptSecret(""), null);
});

test("a truncated authentication tag is refused, not accepted as shorter", () => {
  // GCM permits a 4-byte tag, forgeable a million times more easily than a
  // 16-byte one, and the tag arrives inside the stored value.
  const [iv, tag, data] = encryptLikeTheApp("secret").split(":") as [string, string, string];
  assert.throws(
    () => decryptSecret(`${iv}:${tag.slice(0, 8)}:${data}`),
    /iv:authTag:ciphertext/
  );
});

test("a tampered ciphertext is refused", () => {
  const [iv, tag, data] = encryptLikeTheApp("secret").split(":") as [string, string, string];
  const flipped = data.startsWith("0") ? `1${data.slice(1)}` : `0${data.slice(1)}`;
  assert.throws(() => decryptSecret(`${iv}:${tag}:${flipped}`));
});

test("a value with the wrong number of segments is refused", () => {
  assert.throws(() => decryptSecret("only:two"), /iv:authTag:ciphertext/);
  assert.throws(() => decryptSecret("a:b:c:d"), /iv:authTag:ciphertext/);
});
