import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * THE CENSUS, RENDERED: every screen that reads a list, mounted twice —
 * once with the server answering, once with no signal — and asked what it
 * says.
 *
 * Three rounds of this bug were reported from a jobsite and each fix was
 * verified by reading code. The screens kept saying nothing. The reason
 * was never in the file being read: it was in what the screen was waiting
 * on, or in an empty state that claimed a clean job because the fetch had
 * failed. Only mounting it asks the question a foreman asks.
 *
 * The rule each case pins, in the words it is worth keeping:
 *   1. What this phone has is on screen, with no signal.
 *   2. It SAYS it is what the phone had, not what the server says now.
 *   3. When there is nothing at all, it says it could not load — never
 *      that there is nothing there.
 */

type Screen = {
  name: string;
  import: () => Promise<{ default: () => React.JSX.Element | null }>;
  /** What the server would answer, and what appears on screen from it. */
  online: () => void;
  shows: string;
  /** The sentence the screen must NOT say when it simply could not load. */
  falseEmpty: string;
};

const SCREENS: Screen[] = [
  {
    name: "field reports",
    import: () => import("@/app/reports/[jobId]"),
    online: () =>
      vi.mocked(api.listFieldReports).mockResolvedValue([
        {
          id: "fr_1",
          jobId: "job_1",
          reportDate: "2026-09-19",
          workPerformed: "Hung rock on levels 2 and 3",
          crewCount: 6,
          hoursWorked: "48",
        },
      ] as never),
    shows: "Hung rock on levels 2 and 3",
    falseEmpty: "No reports yet",
  },
  {
    name: "time",
    import: () => import("@/app/time/[jobId]"),
    online: () =>
      vi.mocked(api.listTimeEntries).mockResolvedValue([
        {
          id: "te_1",
          jobId: "job_1",
          date: "2026-09-19",
          hours: "8",
          payType: "REGULAR",
          note: "Hung rock, level 3",
          crewMemberName: "A. Rivera",
        },
      ] as never),
    shows: "Hung rock, level 3",
    falseEmpty: "No time logged",
  },
  {
    name: "materials",
    import: () => import("@/app/materials/[jobId]"),
    online: () => {
      vi.mocked(api.listMaterialOrders).mockResolvedValue([
        {
          id: "mo_1",
          jobId: "job_1",
          number: 7,
          description: "5/8 type X, 300 sheets",
          orderedOn: "2026-09-15",
          promisedFor: "2026-09-22",
          vendorId: "v_1",
          status: "ORDERED",
        },
      ] as never);
      vi.mocked(api.listVendors).mockResolvedValue([{ id: "v_1", name: "Westside Supply" }] as never);
    },
    shows: "5/8 type X, 300 sheets",
    falseEmpty: "Nothing on order",
  },
  {
    name: "safety",
    import: () => import("@/app/safety/[jobId]"),
    online: () => {
      vi.mocked(api.listToolboxTalks).mockResolvedValue([
        { id: "tt_1", jobId: "job_1", topic: "Ladder safety at the shaft", heldOn: "2026-09-19" },
      ] as never);
      vi.mocked(api.listIncidents).mockResolvedValue([] as never);
    },
    shows: "Ladder safety at the shaft",
    falseEmpty: "No talks logged",
  },
  {
    name: "photos",
    import: () => import("@/app/photos/[jobId]"),
    online: () =>
      vi.mocked(api.listMedia).mockResolvedValue([
        {
          id: "m_1",
          jobId: "job_1",
          url: "https://example.test/a.jpg",
          caption: "Corner bead at grid D",
          capturedAt: "2026-09-19T15:00:00.000Z",
          tags: [],
        },
      ] as never),
    shows: "Corner bead at grid D",
    falseEmpty: "No photos yet",
  },
  {
    name: "the schedule",
    import: () => import("@/app/schedule/[jobId]"),
    online: () =>
      vi.mocked(api.listSchedule).mockResolvedValue([
        { id: "cs_1", workDate: "2026-09-22", workerName: "A. Rivera", craft: "Taper", note: "Level 3 finish", hoursLogged: null },
      ] as never),
    shows: "A. Rivera",
    falseEmpty: "Nobody is scheduled on this job",
  },
  {
    name: "drawings",
    import: () => import("@/app/drawings/[jobId]"),
    online: () =>
      vi.mocked(api.listDrawings).mockResolvedValue([
        {
          id: "ds_1",
          name: "Architectural",
          notes: null,
          current: { id: "dr_1", number: 3, issuedOn: "2026-09-01", receivedOn: "2026-09-03", description: null, fileUrl: null, fileName: null },
          revisions: [
            { id: "dr_1", number: 3, issuedOn: "2026-09-01", receivedOn: "2026-09-03", description: null, fileUrl: null, fileName: null },
          ],
        },
      ] as never),
    shows: "Architectural",
    falseEmpty: "No drawing sets on this job",
  },
];

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

describe.each(SCREENS)("$name, with no signal", (screen) => {
  it("shows what this phone last loaded, and says that is what it is", async () => {
    screen.online();
    const Screen = (await screen.import()).default;
    const online = await mount(<Screen />);
    expect(online.text(), "the online case never rendered — the test is about the offline one").toContain(screen.shows);
    online.unmount();

    // Airplane Mode, between two mounts of the same screen. Deliberately
    // the same module instance: a reset here would hand the screen a
    // different set of mocks from the ones this test is holding.
    await goOffline();
    const offline = await mount(<Screen />);

    expect(offline.text()).toContain(screen.shows);
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    offline.unmount();
  });

  it("says it could not load, rather than that there is nothing here", async () => {
    const Screen = (await screen.import()).default;
    const screenWithNothing = await mount(<Screen />);
    expect(screenWithNothing.text()).toMatch(/Can't load .* right now\.|hasn't loaded it before/);
    expect(screenWithNothing.text()).not.toContain(screen.falseEmpty);
    screenWithNothing.unmount();
  });
});
