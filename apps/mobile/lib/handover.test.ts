import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone in somebody else's hands.
 *
 * The rules worth pinning are the ones about getting OUT of it: a crew
 * member who wants to poke around the foreman's app would force-quit,
 * and a flag held in React state would let them.
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

const { getHandover, startHandover, endHandover, pinAccepted, isValidPin, recordHandoverEntry } =
  await import("./handover");

const ANA = { crewMemberId: "cm_1", name: "Ana Reyes", jobId: "job_1", jobName: "ZZQB-TEST" };

beforeEach(() => store.clear());

describe("handing the phone to a crew member", () => {
  it("survives the app being force-quit, which is the point of keeping it on disk", async () => {
    await startHandover(ANA);
    // A relaunch is a fresh read of the same store — no React state.
    const restored = await getHandover();
    expect(restored).toMatchObject({ crewMemberId: "cm_1", name: "Ana Reyes", jobId: "job_1" });
  });

  it("is over only when it is ended", async () => {
    await startHandover(ANA);
    await endHandover();
    expect(await getHandover()).toBeNull();
  });

  it("never renders a nameless handover", async () => {
    // A half-written entry from an older build would otherwise log hours
    // against "undefined" on somebody's timesheet.
    store.set("prova.handover", JSON.stringify({ crewMemberId: "cm_1", jobId: "job_1" }));
    expect(await getHandover()).toMatchObject({ name: "This crew member", jobName: "this job" });

    store.set("prova.handover", JSON.stringify({ name: "Ana" }));
    expect(await getHandover()).toBeNull();

    store.set("prova.handover", "{not json");
    expect(await getHandover()).toBeNull();
  });
});

describe("handing the phone back", () => {
  it("is open when no PIN was set — the foreman standing there is the protection", async () => {
    await startHandover(ANA);
    const handover = (await getHandover())!;
    expect(pinAccepted(handover, "")).toBe(true);
  });

  it("needs the foreman's PIN when there is one", async () => {
    await startHandover({ ...ANA, pin: "2468" });
    const handover = (await getHandover())!;
    expect(pinAccepted(handover, "1234")).toBe(false);
    expect(pinAccepted(handover, "")).toBe(false);
    expect(pinAccepted(handover, "2468")).toBe(true);
  });

  it("ignores a stored PIN that is not four digits, rather than locking the phone", async () => {
    // A lock nobody can open is worse than no lock: this is the foreman's
    // own phone and there is no support desk on a jobsite.
    store.set("prova.handover", JSON.stringify({ ...ANA, pin: "no", startedAt: "2026-09-20T12:00:00.000Z" }));
    const handover = (await getHandover())!;
    expect(handover.pin).toBeUndefined();
    expect(pinAccepted(handover, "")).toBe(true);
  });

  it("knows what a PIN looks like", () => {
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("12")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
  });
});

describe("the hours already put in survive a force-quit (issue #482)", () => {
  /**
   * WHAT WAS WRONG. The rows were React state, so relaunching the app — which
   * this module exists to survive, and which somebody wanting out of the
   * handover screen will do — showed none of them while the queue still held
   * the hours. `Sign and finish` needs one row to be live, so the screen's only
   * offer was entering the hours again: a second `time:create`, a duplicate
   * day's pay, on the one screen whose whole purpose is that the hours are
   * right.
   *
   * WHY NOT JUST READ THE QUEUE BACK, which is the obvious fix and the one the
   * issue proposed: `useQueueDrain` flushes every 20 seconds while the app is
   * foregrounded and does not skip a handover, so with signal the op is gone
   * from the queue within seconds. That fixes the basement and leaves the yard
   * broken — the worse half, because the yard is where it looks like nothing
   * happened.
   */
  const row = (id: string, hours: string) => ({ clientOperationId: id, hours, at: "2026-09-26T15:00:00.000Z" });

  it("comes back after a relaunch, which is the whole bug", async () => {
    await startHandover(ANA);
    await recordHandoverEntry(row("op_1", "8"));

    // A relaunch is exactly this: nothing in memory, everything from disk.
    const reopened = await getHandover();
    expect(reopened?.entries).toEqual([row("op_1", "8")]);
  });

  it("keeps them in the order they were entered", async () => {
    await startHandover(ANA);
    await recordHandoverEntry(row("op_1", "8"));
    await recordHandoverEntry(row("op_2", "1.5"));
    expect((await getHandover())?.entries?.map((e) => e.hours)).toEqual(["8", "1.5"]);
  });

  it("counts one entry once, however many times it is recorded", async () => {
    // A double-tap or a retried write must not make one set of hours look like
    // two — on the screen where two rows reading "8 hours" is the defect.
    await startHandover(ANA);
    await recordHandoverEntry(row("op_1", "8"));
    const after = await recordHandoverEntry(row("op_1", "8"));
    expect(after).toHaveLength(1);
    expect((await getHandover())?.entries).toHaveLength(1);
  });

  it("returns the whole list, so a caller can render what is on disk", async () => {
    await startHandover(ANA);
    await recordHandoverEntry(row("op_1", "8"));
    expect(await recordHandoverEntry(row("op_2", "2"))).toEqual([row("op_1", "8"), row("op_2", "2")]);
  });

  it("goes when the handover goes", async () => {
    // The receipt is about THIS handover. Leaving it behind would show the next
    // crew member somebody else's hours.
    await startHandover(ANA);
    await recordHandoverEntry(row("op_1", "8"));
    await endHandover();
    await startHandover({ ...ANA, crewMemberId: "cm_2", name: "Luis Ortega" });
    expect((await getHandover())?.entries ?? []).toEqual([]);
  });

  it("records nothing once the phone is back with the foreman", async () => {
    expect(await recordHandoverEntry(row("op_1", "8"))).toEqual([]);
  });

  it("reads a handover stored before this existed", async () => {
    // Back-compat: an open handover on a phone that updates mid-shift has no
    // `entries` key at all.
    store.set("prova.handover", JSON.stringify({ ...ANA, startedAt: "2026-09-26T14:00:00.000Z" }));
    const open = await getHandover();
    expect(open?.crewMemberId).toBe("cm_1");
    expect(open?.entries ?? []).toEqual([]);
  });

  it("drops a malformed row instead of failing the parse — which would unlock the phone", async () => {
    // A null parse reads as "no handover open" in app/_layout.tsx, which hands
    // the foreman's whole app to whoever is holding the phone. Losing one
    // receipt line costs a re-entry; that costs the company.
    store.set(
      "prova.handover",
      JSON.stringify({
        ...ANA,
        startedAt: "2026-09-26T14:00:00.000Z",
        entries: [row("op_1", "8"), { hours: "4" }, null, "nonsense"],
      }),
    );
    const open = await getHandover();
    expect(open, "a bad receipt row must not close the handover").not.toBeNull();
    expect(open?.entries).toEqual([row("op_1", "8")]);
  });
});
