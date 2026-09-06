import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM encryption for sensitive data like API keys
// Uses a server-side secret key from environment variables

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Thrown when the environment cannot encrypt at all, as opposed to a request
 * being wrong. Callers surface this differently: it is our misconfiguration,
 * not the user's mistake, and "please try again" is useless advice for it.
 */
export class EncryptionNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Encryption is not configured on this environment: ${detail}`);
    this.name = "EncryptionNotConfiguredError";
  }
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new EncryptionNotConfiguredError("ENCRYPTION_KEY is not set");
  }
  // Must be exactly 32 bytes for AES-256. Buffer.from(..., "hex") silently
  // truncates at the first non-hex character, so a malformed value would
  // otherwise fail deep inside createCipheriv with "Invalid key length".
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new EncryptionNotConfiguredError(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${buf.length} bytes`
    );
  }
  return buf;
}

/**
 * Encrypts a string using AES-256-GCM
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string that was encrypted with encrypt()
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  // GCM accepts a truncated tag (4, 8, 12, 13, 14, 15 or 16 bytes), and a
  // shorter tag is proportionally easier to forge: at 4 bytes an attacker
  // succeeds once in 2^32 tries rather than once in 2^128. The length is
  // attacker-controlled here, because the tag arrives inside the ciphertext
  // string, so it is checked before it reaches setAuthTag rather than trusted.
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted text format");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Safely encrypts an API key, returns null if input is null/undefined
 */
export function encryptApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  return encrypt(apiKey);
}

/**
 * Safely decrypts an API key, returns null if input is null/undefined
 */
export function decryptApiKey(encryptedKey: string | null | undefined): string | null {
  if (!encryptedKey) return null;
  try {
    return decrypt(encryptedKey);
  } catch {
    // If decryption fails, the key might be corrupted or in old format
return null;
  }
}
