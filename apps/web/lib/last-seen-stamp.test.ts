import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The one write this feature adds, and the three things it must never do:
 * write on every request, throw, or report success when it did neither.
 *
 * The third is the one this repo keeps paying for. CLAUDE.md: "a verifier
 * that cannot distinguish 'refuted' from 'never ran' reports clean and
 * means nothing." A stamp that returns void is exactly that shape — a
 * silently swallowed failure and a deliberate throttle look identical from
 * the outside, so `recordLastSeen` returns WHICH of the three happened and
 * this file asserts each one separately.
 */

let db = new FakeDb();

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

const { recordLastSeen } = await import("./last-seen-stamp");

const NOW = new Date("2026-09-13T12:00:00.000Z");
const MINUTE = 60 * 1000;

function seedUser(lastSeenAt: Date | null) {
  db.seed("user", { id: "user_1", email: "partner@example.com", lastSeenAt });
  return { id: "user_1", lastSeenAt };
}

function storedLastSeen() {
  return db.rows("user")[0]?.lastSeenAt ?? null;
}

beforeEach(() => {
  db = new FakeDb();
  vi.restoreAllMocks();
});

describe("recordLastSeen", () => {
  it("stamps a user who has never been seen", async () => {
    const user = seedUser(null);

    expect(await recordLastSeen(user, NOW)).toBe("stamped");
    expect(db.writes).toEqual(["user.update"]);
    expect(storedLastSeen()).toEqual(NOW);
  });

  it("stamps again once the stored value is older than the interval", async () => {
    const user = seedUser(new Date(NOW.getTime() - 60 * MINUTE));

    expect(await recordLastSeen(user, NOW)).toBe("stamped");
    expect(storedLastSeen()).toEqual(NOW);
  });

  it("writes NOTHING for a value inside the interval", async () => {
    // The cost control, asserted against the write log rather than the
    // return value: requireCompanyContext runs on every authenticated
    // request, so a stamp per call would put a database write behind every
    // page load in the app.
    const user = seedUser(new Date(NOW.getTime() - 2 * MINUTE));

    expect(await recordLastSeen(user, NOW)).toBe("throttled");
    expect(db.writes).toEqual([]);
  });

  it("swallows a database failure and says so, instead of breaking the page", async () => {
    // THE TEST THIS FILE EXISTS FOR. This write sits inside
    // requireCompanyContext, which every authenticated page in the app
    // awaits — so an unhandled rejection here is a 500 on every route
    // because telemetry could not record a timestamp. An app with no
    // usage instrument is strictly better than one that cannot be opened.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = seedUser(null);
    db.failNext = "user.update";

    expect(await recordLastSeen(user, NOW)).toBe("failed");

    // "failed" is distinguishable from "throttled": the write was
    // attempted and refused, and the swallow path actually ran rather
    // than the call never getting that far.
    expect(db.writes).toEqual(["user.update"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("last-seen");
  });

  it("does not reject even when the client itself is unusable", async () => {
    // A broken pool, a suspended Neon compute that never woke, a client
    // that throws on property access — the failure does not have to be
    // the update to reach this code path.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exploding = {
      get user(): never {
        throw new Error("Timed out fetching a new connection from the connection pool");
      },
    };
    vi.spyOn(db, "client").mockReturnValue(exploding as never);

    await expect(recordLastSeen({ id: "user_1", lastSeenAt: null }, NOW)).resolves.toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("defaults `now` to the real clock, so callers cannot forget to pass one", async () => {
    const before = Date.now();
    const user = seedUser(null);

    expect(await recordLastSeen(user)).toBe("stamped");

    const stored = storedLastSeen() as Date;
    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
