import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The two tabs a day starts on.
 *
 * Home is the screen that was reported three times and fixed twice
 * before it was right, so it has a guard now rather than a memory of
 * having been checked.
 */

const JOB = { id: "job_1", name: "ZZQB-TEST", status: "IN_PROGRESS", contactName: "ZZQB Client" };

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

describe("Home, with no signal", () => {
  beforeEach(() => {
    deviceStore.set("prova.current-job", JSON.stringify({ id: "job_1", name: "ZZQB-TEST", status: "IN_PROGRESS" }));
  });

  it("says the day is what this phone last loaded, with how old that is", async () => {
    vi.mocked(api.listFieldReports).mockResolvedValue([] as never);
    vi.mocked(api.listPunchListItems).mockResolvedValue([
      { id: "p_1", jobId: "job_1", description: "Grid out of level", status: "OPEN", area: null, createdAt: "2026-09-19T12:00:00.000Z" },
    ] as never);
    vi.mocked(api.listMedia).mockResolvedValue([] as never);
    vi.mocked(api.listTimeEntries).mockResolvedValue([] as never);

    const { default: Home } = await import("@/app/(tabs)/index");
    const online = await mount(<Home />);
    expect(online.text()).toContain("Today");
    expect(online.text()).not.toMatch(/no connection/);
    online.unmount();

    await goOffline();
    const offline = await mount(<Home />);
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    offline.unmount();
  });

  it("does not describe a day it never loaded as an empty one", async () => {
    const { default: Home } = await import("@/app/(tabs)/index");
    const screen = await mount(<Home />);
    expect(screen.text()).toMatch(/hasn't loaded this job yet/);
    screen.unmount();
  });
});

describe("the Jobs tab, with no signal", () => {
  it("lists the jobs this phone last loaded, and says so", async () => {
    vi.mocked(api.listJobs).mockResolvedValue([JOB] as never);
    const { default: Jobs } = await import("@/app/(tabs)/jobs");
    const online = await mount(<Jobs />);
    expect(online.text()).toContain("ZZQB-TEST");
    online.unmount();

    await goOffline();
    const offline = await mount(<Jobs />);
    expect(offline.text()).toContain("ZZQB-TEST");
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    offline.unmount();
  });

  it("says it could not load rather than that there are no jobs", async () => {
    const { default: Jobs } = await import("@/app/(tabs)/jobs");
    const screen = await mount(<Jobs />);
    expect(screen.text()).toMatch(/Can't load the job list right now\./);
    expect(screen.text()).not.toContain("No jobs yet");
    screen.unmount();
  });
});
