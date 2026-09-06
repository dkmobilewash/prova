import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WRITE_WINDOW_MS,
  advisoryLockKey,
  isRepeatOf,
  moneyPart,
  writeFingerprint,
} from "./duplicate-writes";
import { payApplicationFingerprint } from "./pay-application";

/**
 * The two decisions behind every #102 fix, executed rather than read.
 *
 * These are unit tests, so they answer "would the guard fire" and never
 * "did a second row appear" — that question needs Postgres and is answered
 * by duplicate-writes.dbtest.ts, which runs each action TWICE and counts.
 * Both suites exist on purpose: this one gates every push in a fraction of
 * a second, and the sort/normalisation logic below is where a guard would
 * silently stop firing with every other test still green.
 */

const now = new Date("2026-09-05T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("isRepeatOf", () => {
  it("is FALSE when there is no prior row — the ordinary first write", () => {
    // Backwards, this refuses every write in the app.
    expect(isRepeatOf(null, now)).toBe(false);
    expect(isRepeatOf(undefined, now)).toBe(false);
  });

  it("is true for a row written a second ago — the double-click", () => {
    expect(isRepeatOf(ago(1_000), now)).toBe(true);
  });

  it("is true across the 5-7 second lag #61 measured, and the re-read after it", () => {
    expect(isRepeatOf(ago(7_000), now)).toBe(true);
    expect(isRepeatOf(ago(45_000), now)).toBe(true);
  });

  it("is false once the window has passed — a deliberate second entry", () => {
    expect(isRepeatOf(ago(DUPLICATE_WRITE_WINDOW_MS), now)).toBe(false);
    expect(isRepeatOf(ago(10 * 60_000), now)).toBe(false);
  });

  it("treats the exact boundary as inside, and one past it as outside", () => {
    expect(isRepeatOf(ago(DUPLICATE_WRITE_WINDOW_MS - 1), now)).toBe(true);
    expect(isRepeatOf(ago(DUPLICATE_WRITE_WINDOW_MS), now)).toBe(false);
  });

  it("reads clock skew from the future as a repeat, not as ancient history", () => {
    expect(isRepeatOf(new Date(now.getTime() + 5_000), now)).toBe(true);
  });
});

describe("moneyPart — two spellings of the same money must be one key", () => {
  it("normalises the ways a form can post ten thousand dollars", () => {
    expect(moneyPart("10000")).toBe("10000.00");
    expect(moneyPart("10000.0")).toBe("10000.00");
    expect(moneyPart(10000)).toBe("10000.00");
    expect(moneyPart("10000.00")).toBe("10000.00");
  });

  it("keeps absent absent — an unpriced thing is not $0.00", () => {
    expect(moneyPart(null)).toBeNull();
    expect(moneyPart(undefined)).toBeNull();
    expect(moneyPart("")).toBeNull();
  });
});

describe("writeFingerprint", () => {
  it("cannot be fooled by moving a separator between fields", () => {
    // A joined string would make these two identical and silently
    // serialize unrelated writes together.
    expect(writeFingerprint("s", ["a", "b"])).not.toBe(writeFingerprint("s", ["a|b"]));
  });

  it("treats undefined and null as the same absence", () => {
    expect(writeFingerprint("s", [undefined])).toBe(writeFingerprint("s", [null]));
  });

  it("separates scopes, so two features never share a lock by accident", () => {
    expect(writeFingerprint("payment", ["x"])).not.toBe(writeFingerprint("timeEntry", ["x"]));
  });

  it("renders a Date by instant, not by object identity", () => {
    const a = new Date("2026-08-01T00:00:00.000Z");
    const b = new Date("2026-08-01T00:00:00.000Z");
    expect(writeFingerprint("s", [a])).toBe(writeFingerprint("s", [b]));
  });
});

describe("advisoryLockKey", () => {
  it("gives the same key to the same submission", () => {
    const parts = ["inv_1", "10000.00", "check"];
    expect(advisoryLockKey("payment", parts)).toBe(advisoryLockKey("payment", parts));
  });

  it("gives different keys to different submissions", () => {
    expect(advisoryLockKey("payment", ["inv_1", "10000.00"])).not.toBe(
      advisoryLockKey("payment", ["inv_2", "10000.00"]),
    );
  });

  it("stays inside signed 64-bit range — pg_advisory_xact_lock takes int8", () => {
    // Out of range is a runtime error on the busy path this protects, so
    // this is checked over many keys rather than one.
    for (let i = 0; i < 500; i++) {
      const key = advisoryLockKey("scope", [`row-${i}`, i]);
      expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
      expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
    }
  });
});

describe("payApplicationFingerprint — what makes two pay apps the same bill", () => {
  const rows = [
    { lineItemId: "b", thisPeriodBilled: 500, materialsStoredValue: 0 },
    { lineItemId: "a", thisPeriodBilled: 1200, materialsStoredValue: 300 },
  ];

  it("does not care what order the form posted the lines in", () => {
    expect(payApplicationFingerprint(rows)).toBe(payApplicationFingerprint([...rows].reverse()));
  });

  it("reads 1200 and '1200.00' as the same money", () => {
    expect(
      payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: "1200.00", materialsStoredValue: "0" }]),
    ).toBe(payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: 1200, materialsStoredValue: 0 }]));
  });

  it("changes when a single amount changes — a corrected bill is a new bill", () => {
    expect(
      payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: 1200, materialsStoredValue: 0 }]),
    ).not.toBe(
      payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: 1201, materialsStoredValue: 0 }]),
    );
  });

  it("distinguishes billed work from stored materials at the same total", () => {
    expect(
      payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: 1000, materialsStoredValue: 0 }]),
    ).not.toBe(
      payApplicationFingerprint([{ lineItemId: "a", thisPeriodBilled: 0, materialsStoredValue: 1000 }]),
    );
  });
});
