import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceStore } from "./setup";
import { mount } from "./render";

/**
 * T&M tickets with no signal — the screen whose ONLY loader is the shared
 * `useSync`, which makes it the clean reproduction of the defect the
 * other screens only partly showed.
 *
 * Reported from the phone on 2026-09-20, third round: Home, Jobs,
 * drawings and the schedule showed "Showing what this phone last loaded —
 * no connection"; the punch list, field reports, time, photos, materials,
 * safety and T&M showed nothing at all. Same cache, same component, same
 * sentence. The difference was that those seven refreshed their list only
 * AFTER awaiting a token and a queue flush — and `flushQueue` hands every
 * caller the same in-flight promise, so one queued write that has not
 * come back holds every one of them.
 *
 * The second test here is that case, and it is the one that fails if the
 * ordering in lib/sync-order.ts is put back the way it was.
 */

const listTmTickets = vi.fn();
const createTmTicket = vi.fn();

vi.mock("@/lib/api", () => ({
  listTmTickets: (...args: unknown[]) => listTmTickets(...args),
  createTmTicket: (...args: unknown[]) => createTmTicket(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const TICKET = {
  id: "tm_1",
  number: 4,
  workDate: "2026-09-19",
  workDescription: "Extra header framing at grid C",
  signerName: "R. Diaz",
  signedAt: "2026-09-19T23:00:00.000Z",
  status: "SIGNED",
};

const OFFLINE = () => Promise.reject(new TypeError("Network request failed"));

beforeEach(() => {
  deviceStore.clear();
  listTmTickets.mockReset();
  createTmTicket.mockReset();
  vi.resetModules();
});

async function open() {
  const { default: TicketScreen } = await import("@/app/ticket/[jobId]");
  return mount(<TicketScreen />);
}

/** A write already sitting in this phone's queue, as the app stores it. */
function queue(op: Record<string, unknown>) {
  deviceStore.set("prova.field-queue", JSON.stringify([{ opId: "op_1", ...op }]));
}

describe("T&M tickets on a phone with no signal", () => {
  it("shows the tickets this phone last loaded, and says they are last-loaded", async () => {
    listTmTickets.mockResolvedValueOnce([TICKET]);
    const online = await open();
    expect(online.text()).toContain("Extra header framing at grid C");
    online.unmount();

    listTmTickets.mockImplementation(OFFLINE);
    const offline = await open();
    expect(offline.text()).toContain("Extra header framing at grid C");
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    expect(offline.text()).not.toContain("No T&M tickets");
    offline.unmount();
  });

  it("still says it, while a queued write is still trying to go up", async () => {
    // The device case. A ticket queued earlier is being flushed; that
    // request never comes back, because there is no network to fail
    // against quickly. The list and its note must not be behind it.
    listTmTickets.mockResolvedValueOnce([TICKET]);
    const online = await open();
    online.unmount();

    queue({
      type: "ticket:create",
      jobId: "job_1",
      clientOperationId: "op_a",
      workDate: "2026-09-20",
      workDescription: "Queued, not yet sent",
      signerName: "R. Diaz",
      signaturePath: "M0 0",
    });
    createTmTicket.mockImplementation(() => new Promise(() => {}));
    listTmTickets.mockImplementation(OFFLINE);

    const offline = await open();
    expect(offline.text()).toContain("Extra header framing at grid C");
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    offline.unmount();
  });

  it("says it could not load rather than that there are no tickets", async () => {
    listTmTickets.mockImplementation(OFFLINE);
    const screen = await open();
    expect(screen.text()).toMatch(/hasn't loaded it before/);
    expect(screen.text()).not.toContain("No T&M tickets");
    screen.unmount();
  });
});
