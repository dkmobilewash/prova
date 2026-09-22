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

const { clearCurrentJob, getCurrentJob, setCurrentJob } = await import("./current-job");

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
