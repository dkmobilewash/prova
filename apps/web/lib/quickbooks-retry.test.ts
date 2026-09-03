import { describe, expect, it } from "vitest";
// The retry rules live in the integrations package, because the decision is
// made inside its fetch loop and a package cannot import from an app. Tested
// from here because this is where vitest lives — same arrangement as
// db-target.test.ts and packages/db.
import {
  MAX_ATTEMPTS,
  backoffMs,
  isRetryableStatus,
  parseRetryAfter,
} from "../../../packages/integrations/src/quickbooks-retry";

describe("what may be retried", () => {
  it("NEVER retries a write that might already have landed", () => {
    // The whole point. A 500 or a 504 on a POST means QuickBooks may have
    // created the document and lost the response, and from here those two
    // are indistinguishable. Retrying makes a second invoice — the exact
    // failure this integration exists to prevent.
    expect(isRetryableStatus(500, "write")).toBe(false);
    expect(isRetryableStatus(502, "write")).toBe(false);
    expect(isRetryableStatus(504, "write")).toBe(false);
  });

  it("retries a write only when QuickBooks refused it before doing work", () => {
    expect(isRetryableStatus(429, "write")).toBe(true);
    expect(isRetryableStatus(503, "write")).toBe(true);
  });

  it("retries a read on anything transient, because a repeat cannot harm", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status, "read")).toBe(true);
    }
  });

  it("never retries a refusal that will never change", () => {
    // A bad payload, a dead token or a missing record fails identically
    // every time; retrying only delays the message a person needs.
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryableStatus(status, "read")).toBe(false);
      expect(isRetryableStatus(status, "write")).toBe(false);
    }
  });

  it("gives up rather than hammering", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe("backoff", () => {
  it("obeys Retry-After over its own curve", () => {
    // Guessing shorter than a rate limiter asked earns another 429.
    expect(backoffMs(1, { retryAfterSeconds: 4, random: () => 0.5 })).toBe(4000);
  });

  it("caps a hostile Retry-After rather than sleeping a whole function timeout", () => {
    expect(backoffMs(1, { retryAfterSeconds: 3600, random: () => 0.5 })).toBe(8000);
  });

  it("grows, and stops growing", () => {
    const fixed = { random: () => 1 };
    expect(backoffMs(1, fixed)).toBe(500);
    expect(backoffMs(2, fixed)).toBe(1000);
    expect(backoffMs(3, fixed)).toBe(2000);
    expect(backoffMs(20, fixed)).toBe(8000);
  });

  it("jitters, so a batch that failed together does not retry together", () => {
    // A fixed backoff rebuilds the exact burst that hit the rate limit.
    const low = backoffMs(3, { random: () => 0 });
    const high = backoffMs(3, { random: () => 1 });
    expect(low).toBeLessThan(high);
    // And never effectively immediate.
    expect(low).toBeGreaterThan(0);
  });
});

describe("Retry-After parsing", () => {
  it("reads plain seconds", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("  7 ")).toBe(7);
  });

  it("reads an HTTP date relative to now", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    expect(parseRetryAfter("Tue, 01 Sep 2026 12:00:45 GMT", now)).toBe(45);
  });

  it("treats a date already past as no wait, not a negative one", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    expect(parseRetryAfter("Tue, 01 Sep 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("falls back to the curve on anything unparseable rather than to zero", () => {
    // A garbled header must not become an immediate retry loop.
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
  });
});
