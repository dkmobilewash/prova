// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScheduleProposals, type ScheduleProposalView } from "./ScheduleProposals";

/**
 * THE IMPORT BUTTON HAS TO BE ON THE SCREEN, AND ONLY ON THE RIGHT SCHEDULE.
 *
 * A RENDER test, not a census, for the reason `takeoffWallFinder.test.tsx`
 * states at length: #665 shipped a control that existed, called the right
 * action, sat in the right branch and appeared on no screen anybody used. Every
 * assertion a source census could make was true while the app was broken.
 *
 * The second half is what this adds. The button writes wall types into the
 * company's library from a table read by a model — so it appearing on a DOOR
 * schedule would offer to fill the partition library with doors, and a person
 * who pressed it would have no reason to doubt it.
 */

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

const proposal = (over: Partial<ScheduleProposalView> = {}): ScheduleProposalView => ({
  id: "prop_1",
  pageNumber: 12,
  sheetNumber: "A-601",
  kind: "PARTITION",
  title: "PARTITION TYPES",
  rows: [
    { mark: "A1", description: '3-5/8" STUD', size: '4 7/8"', quantity: null, notes: null },
    { mark: "B1", description: '6" STUD', size: '7 1/4"', quantity: null, notes: null },
  ],
  reason: "Column 1 is the mark, column 3 the thickness.",
  confidence: "HIGH",
  gridRowCount: 4,
  readRowCount: 2,
  ...over,
});

/**
 * A FRESH container each time, which is not tidiness.
 *
 * Calling `createRoot` twice on one element makes React warn and keep the first
 * root, so the second render can quietly be the FIRST one's output — and a test
 * asserting a button is absent would then be reading a tree that never
 * contained it. Vacuous for exactly the reason this file exists.
 */
function render(proposals: ScheduleProposalView[], canAddWallTypes = true) {
  host.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ScheduleProposals, { proposals, jobId: "job_1", canAddWallTypes }));
  });
  return host.textContent ?? "";
}

/** The button by its ROLE, as somebody clicking finds it — not by a class or a
 *  test id, either of which can be true of an element nothing renders. */
function importButton(): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("Add these as wall types"),
    ) ?? null
  );
}

describe("adding wall types from a partition schedule", () => {
  it("PUTS THE BUTTON ON A PARTITION SCHEDULE", () => {
    render([proposal()]);
    expect(importButton(), "an estimator cannot reach the import").not.toBeNull();
  });

  it("says how many rows it will take, so pressing it is not a leap", () => {
    render([proposal()]);
    expect(importButton()?.textContent).toContain("2 rows");
  });

  it("KEEPS IT OFF A DOOR SCHEDULE", () => {
    // A door schedule's rows are doors. Offering to turn them into wall types
    // would fill the partition library with nonsense somebody then prices.
    render([proposal({ kind: "DOOR", title: "DOOR SCHEDULE" })]);
    expect(importButton(), "a door schedule offered to make wall types").toBeNull();
  });

  it("keeps it off every other kind too", () => {
    for (const kind of ["WINDOW", "FINISH", "FIXTURE", "OTHER"]) {
      render([proposal({ kind })]);
      expect(importButton(), kind).toBeNull();
    }
  });

  it("keeps it off a partition schedule that read NO rows", () => {
    // Nothing to add, and a button that can only refuse is worse than no
    // button — it reads as a broken feature rather than an empty table.
    render([proposal({ rows: [], readRowCount: 0 })]);
    expect(importButton()).toBeNull();
  });

  it("KEEPS IT AWAY FROM SOMEBODY WHO MAY NOT WRITE THE LIBRARY", () => {
    // This tab withholds on VIEW_JOB_COSTS and the action demands
    // MANAGE_ESTIMATING, which is stricter — an accountant can open the tab.
    // A button that is always visible and sometimes refuses is a dead control,
    // so the capability decides whether it RENDERS and not merely whether it
    // works. `action-capability-guards.test.ts`'s MIXED_DOORS entry for this
    // action rests on exactly that, which is why it is asserted here.
    render([proposal()], false);
    expect(importButton(), "a button was shown to somebody the action refuses").toBeNull();
  });

  it("still shows that person the schedule itself", () => {
    // Withholding the WRITE is not withholding the reading. The rows are what
    // somebody checks against the drawing, and everyone on this tab may.
    const text = render([proposal()], false);
    expect(text).toContain("A1");
    expect(text).toContain("Partition schedule");
  });

  it("still shows the rows themselves, which are what gets checked", () => {
    const text = render([proposal()]);
    expect(text).toContain("A1");
    expect(text).toContain('4 7/8"');
    expect(text).toContain("Partition schedule");
  });
});

describe("the page that renders it computes the capability", () => {
  /**
   * ── A CENSUS, AND IT IS HERE BECAUSE THE RENDER TEST ABOVE CANNOT SEE IT ──
   *
   * The tests above prove the COMPONENT hides the button when told to. They say
   * nothing about whether the page TELLS it correctly, and `canAddWallTypes`
   * is a boolean prop: drop the expression and JSX reads a bare attribute as
   * `true`, so the button comes back for everybody with no error anywhere.
   * Mutation-tested exactly that way, and every test in the repo stayed green.
   *
   * This is the weaker half of the pair and it is worth naming which half:
   * a census proves the code is THERE, never that it runs — see CLAUDE.md's
   * expo-router entry. What makes the pair sufficient here is that the risk is
   * not delivery (a prop is not a framework feature) but DELETION, which is
   * exactly what a census does see.
   *
   * `action-capability-guards.test.ts`'s STRICTER_THAN_ITS_PAGE entry rests on
   * this control being hidden, and names this file as the thing that checks it.
   */
  const page = readFileSync(
    resolve(__dirname, "../app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"),
    "utf8",
  );

  it("passes canAddWallTypes from MANAGE_ESTIMATING, not from the tab's own capability", () => {
    expect(
      page,
      "the takeoff page no longer computes canAddWallTypes from MANAGE_ESTIMATING — a bare " +
        "attribute reads as true, so the button would return for everyone who can open the tab",
    ).toContain('canAddWallTypes={can(context, "MANAGE_ESTIMATING")}');
  });

  it("reads the page it thinks it is reading", () => {
    // The size assertion this repo asks of anything that greps: a path that
    // stops resolving, or a file that stops being the takeoff page, must fail
    // loudly rather than match nothing and pass everything downstream.
    expect(page).toContain("<ScheduleProposals");
    expect(page.length).toBeGreaterThan(2000);
  });
});
