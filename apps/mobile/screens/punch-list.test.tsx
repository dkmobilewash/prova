import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceStore } from "./setup";
import { mount } from "./render";

/**
 * The punch list with no signal, rendered.
 *
 * The report that started all of this, from a jobsite on 2026-09-20: in
 * Airplane Mode this screen said **"Nothing outstanding on this job."** —
 * its empty state — on a job with plenty outstanding. Three fixes later
 * it was still showing no note, because each fix was verified by reading
 * the code rather than by mounting the screen.
 */

const listPunchListItems = vi.fn();

vi.mock("@/lib/api", () => ({
  listPunchListItems: (...args: unknown[]) => listPunchListItems(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const ITEM = {
  id: "item_1",
  description: "Grid out of level at column C4",
  area: "L3",
  status: "OPEN" as const,
  createdAt: "2026-09-20T12:00:00.000Z",
  photoCount: 0,
};

const OFFLINE = () => Promise.reject(new TypeError("Network request failed"));

beforeEach(() => {
  deviceStore.clear();
  listPunchListItems.mockReset();
  vi.resetModules();
});

async function open() {
  const { default: PunchListScreen } = await import("@/app/punch-list/[jobId]");
  return mount(<PunchListScreen />);
}

describe("the punch list on a phone with no signal", () => {
  it("shows the items this phone last loaded, and says they are last-loaded", async () => {
    listPunchListItems.mockResolvedValueOnce([ITEM]);
    const online = await open();
    expect(online.text()).toContain("Grid out of level at column C4");
    online.unmount();

    listPunchListItems.mockImplementation(OFFLINE);
    const offline = await open();

    expect(offline.text()).toContain("Grid out of level at column C4");
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    // THE SENTENCE THAT WAS THE BUG.
    expect(offline.text()).not.toContain("Nothing outstanding on this job");
    offline.unmount();
  });

  it("says it could not load rather than that the job is clear, with no cache", async () => {
    listPunchListItems.mockImplementation(OFFLINE);
    const screen = await open();
    expect(screen.text()).toMatch(/hasn't loaded it before/);
    expect(screen.text()).not.toContain("Nothing outstanding on this job");
    screen.unmount();
  });

  it("says nothing about connections when the server answered", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();
    expect(screen.text()).not.toMatch(/no connection/);
    screen.unmount();
  });
});
