import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption at rest for integration credentials.
 *
 * THIS IS THE FIRST ENCRYPTION IN THIS CODEBASE, not a reuse of an existing
 * pattern. There was none to reuse: the only other uses of node:crypto are
 * `randomBytes` for unguessable e-sign and portal links, and a deliberately
 * non-cryptographic digest for QuickBooks idempotency keys. Worth saying
 * plainly, because "reuse the existing pattern" is only good advice when one
 * exists, and inventing a second one later is the actual thing to avoid — so
 * anything that needs to encrypt a secret from here on should call this
 * rather than reach for node:crypto again.
 *
 * AES-256-GCM, which is authenticated: decryption FAILS on a tampered or
 * truncated ciphertext rather than returning plausible garbage. That matters
 * for a token — silently decrypting to the wrong bytes would produce an
 * authentication failure at the provider that looks like an expired
 * credential, and someone would spend a day re-authorising.
 *
 * THE KEY IS ITS OWN VARIABLE, deliberately. Reusing a key that already
 * signs or encrypts something else means rotating it for one reason breaks
 * the other, which is how a key stops being rotated at all.
 *
 * WHY IT IS READ LAZILY AND NOT AT IMPORT TIME. Nothing in this phase has a
 * credential to store — the sandbox provider holds none — so the variable is
 * legitimately absent today, and throwing at import would break the build
 * for a key nothing uses yet. Missing it fails LOUDLY at the moment a real
 * token would be written instead. The one outcome ruled out completely is
 * the dangerous one: there is no code path here that stores a value
 * unencrypted because the key was not configured.
 */

const ENV_VAR = "INTEGRATION_TOKEN_KEY";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for.
const VERSION = "v1";

/**
 * Never run in a browser. `apps/web` has no `server-only` package, so this
 * is the same guard `packages/db` uses — a bundler that pulled this into a
 * client component would ship the key-reading code to a browser, and this
 * turns that into an immediate, obvious failure instead of a quiet one.
 */
function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/crypto.ts was loaded in a browser. Integration tokens are server-only.");
  }
}

function key(): Buffer {
  assertServer();
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set, so an integration credential cannot be stored. ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    // A short key is the failure worth naming precisely: base64 of the wrong
    // length decodes without complaint and would otherwise surface as an
    // opaque OpenSSL error.
    throw new Error(
      `${ENV_VAR} must be ${KEY_BYTES} bytes base64-encoded (got ${decoded.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

/** Whether a credential could be stored right now. For diagnostics only. */
export function integrationEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * `v1.<iv>.<authTag>.<ciphertext>`, all base64.
 *
 * Versioned so the algorithm or key can change later without guessing what
 * an old row was written with — an unversioned envelope makes rotation a
 * migration nobody can verify.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Stored credential is not a recognised encrypted envelope.");
  }
  const [, iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Constant-time compare, for verifying a webhook signature once a provider
 * that has one exists. Here rather than in that phase's file because the
 * mistake it prevents — comparing signatures with `===`, which leaks the
 * answer through timing — is made by reaching for the obvious operator, and
 * the obvious operator is what is there when nothing else is.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
