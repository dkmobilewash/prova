import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  integrationEncryptionConfigured,
  safeEqual,
} from "./crypto";

// A real 32-byte key, generated for this test and used nowhere else.
const KEY = Buffer.alloc(32, 7).toString("base64");
const TOKEN = "ya29.a0AfB_pretend-oauth-access-token";

describe("integration credential encryption", () => {
  const original = process.env.INTEGRATION_TOKEN_KEY;
  beforeEach(() => {
    process.env.INTEGRATION_TOKEN_KEY = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
    else process.env.INTEGRATION_TOKEN_KEY = original;
  });

  it("round-trips a token", () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it("never leaves the plaintext in the envelope", () => {
    // The point of the whole file. If this fails, everything else is theatre.
    const envelope = encryptSecret(TOKEN);
    expect(envelope).not.toContain(TOKEN);
    expect(envelope).not.toContain("ya29");
    expect(Buffer.from(envelope, "utf8").includes(TOKEN)).toBe(false);
  });

  it("produces a different envelope every time", () => {
    // A fresh IV per encryption. Identical ciphertext for identical input
    // would tell an observer that two companies connected the same account.
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN));
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    // GCM is authenticated, and this is why it was chosen: a silently wrong
    // decryption reads at the provider as an expired credential, which sends
    // someone re-authorising a connection that was never broken.
    const [v, iv, tag, ciphertext] = encryptSecret(TOKEN).split(".");
    const flipped = Buffer.from(ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("refuses an envelope it did not write", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow(/recognised encrypted envelope/);
    expect(() => decryptSecret(`v2.a.b.c`)).toThrow(/recognised encrypted envelope/);
  });

  it("will not encrypt without a key, and says how to make one", () => {
    delete process.env.INTEGRATION_TOKEN_KEY;
    expect(integrationEncryptionConfigured()).toBe(false);
    // Loud at the moment a token would be written — never a silent fallback
    // to storing it in the clear.
    expect(() => encryptSecret(TOKEN)).toThrow(/openssl rand -base64 32/);
  });

  it("rejects a key of the wrong length instead of failing obscurely", () => {
    process.env.INTEGRATION_TOKEN_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptSecret(TOKEN)).toThrow(/must be 32 bytes/);
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("returns false on a length mismatch rather than throwing", () => {
    // timingSafeEqual throws on unequal lengths; a signature check that
    // throws on a short input is a 500 where a 401 belongs.
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
