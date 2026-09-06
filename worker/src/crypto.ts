import { createDecipheriv } from "node:crypto";
import { requireEnv } from "./config.ts";

/**
 * Reading what the app encrypted.
 *
 * The dashboard stores LinkedIn passwords, TOTP secrets and proxy credentials
 * with AES-256-GCM under `ENCRYPTION_KEY`, in the format
 * `iv:authTag:ciphertext`, all hex. The worker only ever needs to read them,
 * so this is the decrypt half of `src/lib/encryption.ts` in the app repo and
 * deliberately has no encrypt counterpart: the worker writing a secret would
 * mean a secret exists in two places.
 *
 * The two files have to agree on the format. If the app's encryption changes,
 * this changes with it in the same commit.
 */

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  const raw = requireEnv("ENCRYPTION_KEY");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${buf.length}`
    );
  }
  return buf;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted value is not in iv:authTag:ciphertext form");
  }
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  // GCM accepts a truncated tag (4, 8, 12, 13, 14, 15 or 16 bytes), and a
  // shorter tag is proportionally easier to forge: at 4 bytes an attacker
  // succeeds once in 2^32 tries rather than once in 2^128. The tag arrives
  // inside the stored string, so its length is attacker-controlled and is
  // checked here rather than trusted. Matches src/lib/encryption.ts.
  const tag = Buffer.from(tagHex, "hex");
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Encrypted value is not in iv:authTag:ciphertext form");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex, "hex"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  let out = decipher.update(dataHex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}
