import { beforeEach, describe, expect, it, vi } from "vitest";

/** The job the phone is on — the thing Create and Camera act against. */

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

const { clearCurrentJob, getCurrentJob, onCurrentJobChange, setCurrentJob } = await import(
  "./current-job",
);

beforeEach(() => store.clear());

describe("remembering which job", () => {
  it("survives being written and read back", async () => {
    await setCurrentJob({ id: "job_1", name: "Riverside", status: "CONTRACTED" });
    expect(await getCurrentJob()).toEqual({ id: "job_1", name: "Riverside", status: "CONTRACTED" });
  });

  it("is nothing before a job has been chosen", async () => {
    expect(await getCurrentJob()).toBeNull();
  });

  it("forgets on request — the Leave button in Settings", async () => {
    await setCurrentJob({ id: "job_1", name: "Riverside", status: null });
    await clearCurrentJob();
    expect(await getCurrentJob()).toBeNull();
  });

  it("treats a half-written entry as no job rather than drawing it", async () => {
    // A header reading "undefined" is worse than one asking you to pick.
    store.set("prova.current-job", "{not json");
    expect(await getCurrentJob()).toBeNull();
    store.set("prova.current-job", JSON.stringify({ name: "No id here" }));
    expect(await getCurrentJob()).toBeNull();
  });

  it("fills in a missing name rather than refusing a real job", async () => {
    store.set("prova.current-job", JSON.stringify({ id: "job_9" }));
    expect(await getCurrentJob()).toEqual({ id: "job_9", name: "Job", status: null });
  });
});

/**
 * The half that a focus effect cannot do.
 *
 * The capture sheet takes its job from the TAB LAYOUT, which never loses
 * focus while you move between tabs. So on focus alone it never learned
 * that "Leave <job>" had happened, and went on offering Photo, Field
 * report and Time against a job the phone had left — a tap would have
 * filed real work against it. Found on a phone walking #427's
 * click-list; both readers were stale and agreed with each other, which
 * is exactly what no test here could see.
 */
describe("telling everyone the job changed", () => {
  it("announces a new job to whoever is listening", async () => {
    let calls = 0;
    const stop = onCurrentJobChange(() => {
      calls += 1;
    });
    await setCurrentJob({ id: "job_1", name: "Riverside", status: null });
    expect(calls).toBe(1);
    stop();
  });

  it("announces leaving a job — the case the sheet got wrong", async () => {
    await setCurrentJob({ id: "job_1", name: "Riverside", status: null });
    let calls = 0;
    const stop = onCurrentJobChange(() => {
      calls += 1;
    });
    await clearCurrentJob();
    expect(calls).toBe(1);
    stop();
  });

  it("reaches every listener, not just the first", async () => {
    const seen: string[] = [];
    const stopA = onCurrentJobChange(() => seen.push("a"));
    const stopB = onCurrentJobChange(() => seen.push("b"));
    await clearCurrentJob();
    expect(seen.sort()).toEqual(["a", "b"]);
    stopA();
    stopB();
  });

  it("stops talking to a listener that has unsubscribed", async () => {
    let calls = 0;
    const stop = onCurrentJobChange(() => {
      calls += 1;
    });
    stop();
    await setCurrentJob({ id: "job_2", name: "Oakwood", status: null });
    expect(calls).toBe(0);
  });
});
