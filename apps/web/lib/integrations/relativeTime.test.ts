import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("relativeTime", () => {
  it("calls anything under a minute 'just now'", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(44), NOW)).toBe("just now");
  });

  it("does not say a sync happened in the future", () => {
    // Clock skew between Neon and the app can stamp lastSyncedAt slightly
    // ahead of the render. "in 4 seconds" reads as a bug in the product.
    expect(relativeTime(new Date(NOW.getTime() + 4000), NOW)).toBe("just now");
  });

  it("singularises", () => {
    expect(relativeTime(ago(60), NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(3600), NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(86400), NOW)).toBe("1 day ago");
  });

  it("steps up through the units", () => {
    expect(relativeTime(ago(5 * 60), NOW)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3600), NOW)).toBe("3 hours ago");
    expect(relativeTime(ago(3 * 86400), NOW)).toBe("3 days ago");
    expect(relativeTime(ago(21 * 86400), NOW)).toBe("3 weeks ago");
    expect(relativeTime(ago(120 * 86400), NOW)).toBe("4 months ago");
    expect(relativeTime(ago(800 * 86400), NOW)).toBe("2 years ago");
  });

  it("rolls a unit up instead of printing its own ceiling", () => {
    // The bug this shape exists to prevent: comparing raw seconds against a
    // boundary lets 59m59s test as "under an hour" and then round to
    // "60 minutes ago".
    expect(relativeTime(ago(3599), NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(86399), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(3540), NOW)).toBe("59 minutes ago");
    expect(relativeTime(ago(23 * 3600), NOW)).toBe("23 hours ago");
  });

  it("never renders a zero", () => {
    // Rounding at a unit boundary can produce "0 hours ago", which reads as
    // broken. Every step below its unit's floor must fall to the finer one.
    for (const seconds of [45, 89, 90, 5399, 5400, 86399, 86400]) {
      expect(relativeTime(ago(seconds), NOW)).not.toMatch(/^0 /);
    }
  });
});
