import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { noWallsMessage } from "./noWallsMessage";

/**
 * WHAT THE FOUND-WALLS PANEL SAYS WHEN IT HAS NOTHING LEFT TO SHOW.
 *
 * A user walk on 2026-10-19: "Find the walls" found two groups, both were
 * added to the measurements, and the panel then said "No walls found… 176
 * lines… none of it paired up as a wall" — directly under the walls it had
 * just found. Accepting a group removes it from the panel, so an empty panel
 * has two meanings: nothing paired, or everything that paired has been moved
 * onto the measurements. Only the first is "no walls found".
 */
describe("the found-walls panel's empty state", () => {
  it("says every found wall is on the measurements once they have all been added", () => {
    const message = noWallsMessage({ strokesSeen: 176, groupsAdded: 2 });
    expect(message).toContain("Every wall found here is on your measurements");
    expect(message).not.toContain("No walls found");
    expect(message).not.toContain("paired up");
  });

  it("counts what was added, in the singular when it is one", () => {
    expect(noWallsMessage({ strokesSeen: 176, groupsAdded: 1 })).toContain("1 group added");
    expect(noWallsMessage({ strokesSeen: 176, groupsAdded: 2 })).toContain("2 groups added");
  });

  it("still says nothing paired when nothing was found and nothing added", () => {
    const message = noWallsMessage({ strokesSeen: 176, groupsAdded: 0 });
    expect(message).toContain("No walls found");
    expect(message).toContain("176 lines");
    expect(message).toContain("none of it paired up as a wall");
  });

  it("still says a sheet with no line work is an image", () => {
    expect(noWallsMessage({ strokesSeen: 0, groupsAdded: 0 })).toContain("no line work at all");
  });

  it("is what the viewer renders, and the viewer counts accepted groups per sheet", () => {
    // The panel is behind `found !== null && found.length === 0`, which no DOM
    // render can reach without opening a real PDF — the same bound the wall
    // finder's own render test states. So the wiring is pinned off the source.
    const source = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(source, "the viewer no longer renders the shared empty-state sentence").toContain(
      "noWallsMessage({ strokesSeen, groupsAdded })",
    );
    expect(source, "the hard-coded 'none of it paired up' sentence is back in the viewer").not.toContain(
      "none of it paired up as a wall",
    );
    expect(source, "accepting a group no longer counts towards this sheet's total").toMatch(
      /setGroupsAdded\(\(current\) => current \+ 1\)/,
    );
    expect(source, "a fresh find no longer clears the count of groups added").toMatch(
      /setFound\(null\); setGroupsAdded\(0\);/,
    );
  });
});
