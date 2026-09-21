import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { AlertRow } from "@/lib/types";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

/**
 * The phone's alert list — what a notification tap lands on. Copy-pinned
 * on purpose: the same three severity words the web badge uses, the same
 * empty/offline distinction every list screen keeps (an unloadable list
 * must never claim nothing is wrong), and the cached list must survive
 * no signal, because the notification that brought the person here is
 * usually the last thing that reached the phone.
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

async function open() {
  const { default: Alerts } = await import("@/app/alerts");
  return mount(<Alerts />);
}

function cacheAlerts(rows: unknown[]) {
  deviceStore.set(
    "prova.cache.alerts",
    JSON.stringify({ rows, at: "2026-09-21T12:00:00.000Z" }),
  );
}

const LICENCE: AlertRow = {
  key: "RENEWAL:lic_1:2026-11-30",
  kind: "RENEWAL",
  severity: "DUE_SOON",
  title: "Licence renews soon",
  detail: "California licence CA-123 expires on 2026-11-30.",
  href: "/alerts",
  dueOn: "2026-11-30",
  daysUntil: 3,
  amount: null,
};

describe("the alerts screen", () => {
  it("says nothing needs attention when the list is genuinely empty", async () => {
    vi.mocked(api.listAlerts).mockResolvedValue([]);
    const screen = await open();

    expect(screen.text()).toContain("Nothing needs attention");
    screen.unmount();
  });

  it("renders each alert with the web's own severity words", async () => {
    vi.mocked(api.listAlerts).mockResolvedValue([
      LICENCE,
      { ...LICENCE, key: "LIEN_DEADLINE:job_1:2026-10-01", severity: "OVERDUE", title: "Lien deadline passed" },
      { ...LICENCE, key: "WIP_VARIANCE:job_1", severity: "STANDING", title: "Job over contract" },
    ]);
    const screen = await open();

    const text = screen.text();
    expect(text).toContain("Licence renews soon");
    expect(text).toContain("Coming up");
    expect(text).toContain("Lien deadline passed");
    expect(text).toContain("Past due");
    expect(text).toContain("Job over contract");
    expect(text).toContain("Standing");
    screen.unmount();
  });

  it("never claims nothing is wrong when it could not load at all", async () => {
    const screen = await open();

    expect(screen.text()).toContain("Can't load the alerts right now.");
    expect(screen.text()).not.toContain("Nothing needs attention");
    screen.unmount();
  });

  it("still shows the cached list with no signal, and says it is stale", async () => {
    cacheAlerts([LICENCE]);
    const screen = await open();

    expect(screen.text()).toContain("Licence renews soon");
    expect(screen.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    screen.unmount();
  });
});
