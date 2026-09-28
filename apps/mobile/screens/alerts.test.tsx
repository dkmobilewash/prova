import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { AlertRow } from "@/lib/types";
import { deviceStore, goOffline, setCanGoBack, stackScreenOptions } from "./setup";
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

/**
 * THE WAY OUT OF A SCREEN NOTHING NAVIGATED TO.
 *
 * Reported from a phone on 2026-09-28, the first time anyone reached this
 * screen at all: "once the alerts page opens that is the only page that is
 * available, there is no option to return to the home or other jobs."
 *
 * `/alerts` has no route into it except a notification tap — no tab, no
 * link, no button anywhere in the app — and a tap that launches the app
 * COLD leaves it as the only entry on the stack. No back chevron, because
 * there is genuinely nothing behind it, and no tab bar, because it lives
 * outside `(tabs)`. The alert list was a room with the door bricked up.
 *
 * What is askable here and what is not: `<Stack.Screen>` renders null and
 * the header is drawn by a navigator that does not exist in this
 * environment, so these assert what the screen REQUESTED. That the button
 * itself works is `HeaderHomeButton`'s own test.
 */
describe("getting out of the alerts screen", () => {
  it("offers a way home when a cold tap left nothing to go back to", async () => {
    stackScreenOptions.length = 0;
    setCanGoBack(false);
    await open();

    // Counted as "at least one", not "exactly one": the screen re-renders
    // when its load resolves, so the number of times it states its options
    // is a fact about React rather than about the header.
    const withHeader = stackScreenOptions.filter((o) => "headerLeft" in o);
    expect(
      withHeader.length,
      "stranded on /alerts with no back chevron and no tab bar — the dead end reported from the phone",
    ).toBeGreaterThan(0);
    expect(typeof withHeader[0].headerLeft).toBe("function");
  });

  it("leaves the ordinary Back alone when there IS history behind it", async () => {
    // A WARM tap pushes this on top of whatever the person was doing, and
    // that Back is the right way out. Two competing ways out of one screen
    // is its own small confusion — this is the control that keeps the fix
    // from applying itself everywhere.
    stackScreenOptions.length = 0;
    setCanGoBack(true);
    await open();

    expect(
      stackScreenOptions.filter((o) => "headerLeft" in o),
      "overrode the back chevron on a screen that already had one",
    ).toEqual([]);
  });
});
