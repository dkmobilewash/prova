import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the outbox says about a queued write.
 *
 * The line that has to be right is the one naming the WORK: a foreman
 * looking at "3 waiting" cannot act on it, and a foreman looking at
 * "8 hours · ZZQB-TEST · Fri 19 Sep" can. So every op type this queue can
 * hold must be describable, and the last test below is the census that
 * makes sure none is missing — a blank line in an outbox is the same
 * class of lie as an empty list with no note.
 *
 * THE ENGLISH BELOW IS THE DICTIONARY'S, NOT THIS FILE'S. `outbox.ts`
 * spends `outbox.op.*` and `outbox.tried.*` keys now, so these strings are
 * what `lib/strings/en.ts` says and the Spanish half is checked key for key
 * by strings-census.test.ts. Asserting the sentence rather than the key is
 * deliberate: a key wired to the wrong entry type-checks perfectly, and the
 * only thing that catches it is reading the sentence a foreman gets.
 */

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));
vi.mock("./photo-store", () => ({
  discardQueuedPhoto: () => {},
  queuedPhotoExists: () => true,
  uploadQueuedPhoto: async () => ({ status: 201, body: "{}" }),
}));
vi.mock("./api", () => ({ ApiError: class extends Error {} }));

const { describeOp, statusOf, triesLeft, toOutboxItem } = await import("./outbox");
const { MAX_ATTEMPTS } = await import("./sync-queue");

const NAMES = { job_1: "ZZQB-TEST" };

describe("what a queued write is called", () => {
  it("names the work, the job and the day — not the op type", async () => {
    expect(
      describeOp(
        { type: "time:create", jobId: "job_1", clientOperationId: "o", date: "2026-09-18", hours: "8", payType: "REGULAR" },
        NAMES,
      ),
    ).toMatchObject({ title: "8 hours" });
    expect(
      describeOp({ type: "punch-list:create", jobId: "job_1", clientOperationId: "o", description: "Grid out of level" }, NAMES)
        .title,
    ).toBe("Grid out of level");
    expect(describeOp({ type: "punch-list:status", jobId: "job_1", itemId: "i", status: "READY_FOR_REVIEW" }, NAMES).title).toBe(
      "Punch item marked ready",
    );
  });

  it("says the job by name when this phone knows it, and does not invent one when it does not", () => {
    const op = { type: "punch-list:create", jobId: "job_1", clientOperationId: "o", description: "Grid" } as const;
    expect(describeOp(op, NAMES).detail).toContain("ZZQB-TEST");
    expect(describeOp(op, {}).detail).toContain("this job");
  });

  it("leaves the words that are somebody's own alone", () => {
    // The half of the sentence that must NEVER be translated: the topic a
    // foreman typed and the name a person signed under are records, and a
    // Spanish phone showing a translated version of either would be
    // showing something that is on no record anywhere.
    expect(
      describeOp({ type: "toolbox-talk:create", jobId: "job_1", clientOperationId: "o", topic: "Fall protection", heldOn: "2026-09-18" }, NAMES)
        .title,
    ).toBe("Fall protection");
    expect(
      describeOp({ type: "signoff:create", jobId: "job_1", clientOperationId: "o", date: "2026-09-18", signerName: "Ana Reyes", signaturePath: "M0 0L0 0" }, NAMES)
        .title,
    ).toContain("Ana Reyes");
  });
});

describe("what the outbox says is happening to it", () => {
  const item = (over: Partial<ReturnType<typeof toOutboxItem>> = {}) => ({
    opId: "op_1",
    title: "8 hours",
    detail: "ZZQB-TEST",
    attempts: 0,
    ...over,
  });

  it("calls the ordinary case what it is: waiting, not failing", () => {
    // The common state by far — no signal, nothing wrong. Calling it
    // "failed" would teach people to ignore the word.
    expect(statusOf(item())).toBe("Waiting for signal");
  });

  it("quotes the server rather than saying 'failed'", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const said = statusOf(
      item({ attempts: 2, lastError: "Something went wrong", nextTryAt: "2026-09-20T12:00:30.000Z" }),
      now,
    );
    expect(said).toContain("Tried 2 times");
    expect(said).toContain("Something went wrong");
    expect(said).toContain("in 30s");
  });

  it("does not put the word 'no' in the server's mouth when nothing came back", () => {
    // The old fallback was literally `lastError ?? "no"`, which rendered as
    // `the server said "no"` — a refusal the server never gave, on the one
    // line a foreman is supposed to act on. A missing message now says it
    // is missing.
    const said = statusOf(item({ attempts: 1 }));
    expect(said).toContain("no reason given");
    expect(said, "still quoting the server as answering 'no'").not.toMatch(/said\s*[“"]no[”"]/);
  });

  it("counts down to being set aside, before it happens rather than after", () => {
    expect(triesLeft(item({ attempts: 1 }))).toBe(MAX_ATTEMPTS - 1);
    expect(triesLeft(item({ attempts: MAX_ATTEMPTS }))).toBe(0);
  });
});

describe("the census: every kind of queued write can be described", () => {
  it("has a case for each op type the queue defines", () => {
    // Derived from the type union in sync-queue.ts rather than restated,
    // so adding an op type and forgetting the outbox fails here. The
    // switch is also exhaustive at compile time (`never`), and this is the
    // half that survives someone adding a `default`.
    const source = readFileSync(join(__dirname, "sync-queue.ts"), "utf8");
    const types = [...source.matchAll(/^\s+type: "([a-z-]+:[a-z-]+)";$/gm)].map((match) => match[1]);
    expect(types.length, "the walk over sync-queue.ts found no op types").toBeGreaterThan(8);

    const described = readFileSync(join(__dirname, "outbox.ts"), "utf8");
    const missing = types.filter((type) => !described.includes(`case "${type}":`));
    expect(missing, `no outbox wording for: ${missing.join(", ")}`).toEqual([]);
  });
});
