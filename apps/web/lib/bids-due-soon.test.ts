import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bidsDueSoon, bidsView, daysLeftLabel } from "./bids-due-soon";

const bid = (id: string, status: string, due: string | null) => ({
  id,
  projectName: id,
  status,
  dueDate: due ? new Date(`${due}T00:00:00.000Z`) : null,
  contact: { name: "Halvorsen" },
});

// The ux round 4 data: the history listed newest-created first, so the
// soonest bid was not on top, and a submitted one sat among the invited.
const BIDS = [
  bid("Pell Riverfront Tower", "INVITED", "2026-11-01"),
  bid("Sellwood Clinic", "SUBMITTED", "2026-10-20"),
  bid("Alder Street Retail", "INVITED", "2026-10-28"),
  bid("Far off", "INVITED", "2026-11-20"),
  bid("Already passed", "INVITED", "2026-10-01"),
  bid("No date", "INVITED", null),
  bid("Today", "INVITED", "2026-10-12"),
];

describe("bids due soon", () => {
  it("is the invited bids due in the next 30 days, soonest first, with days left", () => {
    expect(bidsDueSoon(BIDS, "2026-10-12").map((b) => [b.id, b.daysLeft])).toEqual([
      ["Today", 0],
      ["Alder Street Retail", 16],
      ["Pell Riverfront Tower", 20],
    ]);
    expect(daysLeftLabel(0)).toBe("Due today");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(16)).toBe("16 days left");
  });

  it("opens on Due soon when something is due and no history filter is set", () => {
    expect(bidsView(undefined, 2, false)).toBe("due");
    expect(bidsView(undefined, 0, false)).toBe("all");
    expect(bidsView(undefined, 2, true)).toBe("all");
    expect(bidsView("all", 2, false)).toBe("all");
    expect(bidsView("due", 0, false)).toBe("due");
  });

  it("is what /bids renders", () => {
    const page = readFileSync(`${process.cwd()}/app/(app)/bids/page.tsx`, "utf8");
    expect(page).toContain("bidsView(viewParam, dueSoon.length, isFiltered)");
    expect(page).toContain('data-bids="due-soon"');
  });
});
