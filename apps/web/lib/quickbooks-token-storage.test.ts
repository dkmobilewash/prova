import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetQuickBooksTokenStorageForTests,
  isSealedQuickBooksToken,
  openQuickBooksToken,
  sealQuickBooksToken,
} from "./quickbooks-token-storage";

/**
 * The seam every QuickBooks token now crosses (#353 finding 4).
 *
 * Three things have to be true at once or a live connection breaks: a token
 * sealed here opens here; a token written BEFORE this existed (plaintext)
 * still opens; and a deployment with no key stores the token rather than
 * throwing a digest at the person who just clicked Connect.
 */

const ORIGINAL_KEY = process.env.INTEGRATION_TOKEN_KEY;

beforeEach(() => {
  _resetQuickBooksTokenStorageForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = ORIGINAL_KEY;
});

describe("with INTEGRATION_TOKEN_KEY set", () => {
  beforeEach(() => {
    process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");
  });

  it("seals a token so the stored value is not the token, and opens it back", () => {
    const stored = sealQuickBooksToken("access-abc123");
    expect(stored).not.toContain("access-abc123");
    expect(isSealedQuickBooksToken(stored)).toBe(true);
    expect(openQuickBooksToken(stored)).toBe("access-abc123");
  });

  it("still opens a plaintext token written before this module existed", () => {
    // Intuit tokens are long opaque base64-ish strings with dots in some
    // formats; none of them starts with our version tag.
    for (const legacy of ["AB11758304...refresh", "eyJhbGciOi.eyJzdWIi.sig", "plain"]) {
      expect(isSealedQuickBooksToken(legacy)).toBe(false);
      expect(openQuickBooksToken(legacy)).toBe(legacy);
    }
  });

  it("produces a different envelope for the same token each time (fresh iv)", () => {
    expect(sealQuickBooksToken("same")).not.toBe(sealQuickBooksToken("same"));
  });
});

describe("with no key", () => {
  beforeEach(() => {
    delete process.env.INTEGRATION_TOKEN_KEY;
  });

  it("stores the token as-is and warns once, rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sealQuickBooksToken("access-abc123")).toBe("access-abc123");
    expect(sealQuickBooksToken("refresh-xyz")).toBe("refresh-xyz");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("INTEGRATION_TOKEN_KEY");
  });

  it("opens a plaintext token, and refuses to pretend an envelope is one", () => {
    expect(openQuickBooksToken("access-abc123")).toBe("access-abc123");
    // An envelope with no key to open it is a configuration error, and
    // saying so beats returning ciphertext to Intuit as a bearer token.
    expect(() => openQuickBooksToken("v1.aXY=.dGFn.Y2lwaGVy")).toThrow(/INTEGRATION_TOKEN_KEY/);
  });
});
