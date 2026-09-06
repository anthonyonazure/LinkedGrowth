import { test } from "node:test";
import assert from "node:assert/strict";

// A fixed key, so the suite does not encrypt under whatever ENCRYPTION_KEY the
// developer's shell happens to hold. Assigning after the import is fine: the
// key is read inside each call, not at module load.
process.env.ENCRYPTION_KEY =
  "3d6f45a5fd7b4b0e9c2a1f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1908f7e6";

import { encrypt, decrypt, encryptApiKey, decryptApiKey } from "./encryption";

test("a secret survives the round trip", () => {
  const secret = "sk-live-0123456789";
  assert.equal(decrypt(encrypt(secret)), secret);
});

test("the same secret encrypts differently every time", () => {
  // A fresh IV per call. Identical ciphertext for identical input would let
  // anyone holding the database tell which accounts share a password.
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("the stored form is iv:authTag:ciphertext, with a full 16-byte tag", () => {
  const parts = encrypt("value").split(":");
  assert.equal(parts.length, 3);
  assert.equal(Buffer.from(parts[0], "hex").length, 16);
  assert.equal(Buffer.from(parts[1], "hex").length, 16);
});

test("a truncated authentication tag is refused, not accepted as shorter", () => {
  // GCM itself permits a 4-byte tag, which an attacker can forge a million
  // times more easily than a 16-byte one. The tag arrives inside the stored
  // string, so its length is attacker-controlled and must be checked.
  const [iv, tag, data] = encrypt("value").split(":");
  const truncated = `${iv}:${tag.slice(0, 8)}:${data}`;
  assert.throws(() => decrypt(truncated), /Invalid encrypted text format/);
});

test("a tampered ciphertext is refused", () => {
  const [iv, tag, data] = encrypt("value").split(":");
  const flipped = data.startsWith("0") ? `1${data.slice(1)}` : `0${data.slice(1)}`;
  assert.throws(() => decrypt(`${iv}:${tag}:${flipped}`));
});

test("a tag from one message does not authenticate another", () => {
  const [ivA, , dataA] = encrypt("message A").split(":");
  const [, tagB] = encrypt("message B").split(":");
  assert.throws(() => decrypt(`${ivA}:${tagB}:${dataA}`));
});

test("a value with the wrong number of segments is refused", () => {
  assert.throws(() => decrypt("only:two"), /Invalid encrypted text format/);
  assert.throws(() => decrypt("a:b:c:d"), /Invalid encrypted text format/);
});

test("the api key helpers pass null through untouched", () => {
  assert.equal(encryptApiKey(null), null);
  assert.equal(encryptApiKey(""), null);
  assert.equal(decryptApiKey(null), null);
  const stored = encryptApiKey("sk-abc");
  assert.ok(stored);
  assert.equal(decryptApiKey(stored), "sk-abc");
});
