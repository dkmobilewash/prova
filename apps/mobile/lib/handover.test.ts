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

const { getHandover, startHandover, endHandover, pinAccepted, isValidPin } = await import("./handover");

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
