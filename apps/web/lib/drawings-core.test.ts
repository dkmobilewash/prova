import { describe, expect, it } from "vitest";
import { byIssueDate, currentRevision, latestReceived, toDrawingSetRow } from "./drawings-core";

/**
 * Which drawing governs, and whether site has it.
 *
 * The question this answers is the one asked in front of a wall: am I
 * building from paper that has already been superseded? Everything here
 * is derived at read time — a stored "current" flag somebody forgot to
 * move would be exactly the failure it claims to prevent.
 */

const rev = (label: string, issuedOn: string, receivedOn: string | null = null) => ({
  id: label,
  label,
  issuedOn,
  receivedOn,
  description: null,
  fileUrl: null,
  fileName: null,
});

describe("which revision governs", () => {
  it("is the latest ISSUED, received or not", () => {
    const revisions = [rev("Rev 1", "2026-01-05", "2026-01-07"), rev("Rev 2", "2026-03-01")];
    // Rev 2 is not in the trailer, and it still governs. That gap is the
    // whole reason this screen exists.
    expect(currentRevision(revisions)?.label).toBe("Rev 2");
    expect(latestReceived(revisions)?.label).toBe("Rev 1");
  });

  it("orders newest first and breaks a same-day tie the same way every load", () => {
    const revisions = [rev("Rev A", "2026-03-01"), rev("Rev B", "2026-03-01"), rev("Rev 0", "2026-01-01")];
    expect(byIssueDate(revisions).map((r) => r.label)).toEqual(["Rev B", "Rev A", "Rev 0"]);
  });

  it("has no current revision for a set nobody has issued into yet", () => {
    // A real state: somebody names the set before the first issue lands.
    expect(currentRevision([])).toBeNull();
    expect(latestReceived([])).toBeNull();
  });
});

describe("the row the phone reads", () => {
  const set = {
    id: "set_1",
    name: "Architectural",
    description: "A-series",
    revisions: [
      {
        id: "r1",
        label: "Rev 1",
        issuedOn: new Date("2026-01-05T00:00:00.000Z"),
        receivedOn: new Date("2026-01-07T00:00:00.000Z"),
        description: "Issued for construction",
        fileUrl: "https://example.test/a.pdf",
        fileName: "A-series-rev1.pdf",
      },
      {
        id: "r2",
        label: "Rev 2",
        issuedOn: new Date("2026-03-01T00:00:00.000Z"),
        receivedOn: null,
        description: "Corridor ceilings revised",
        fileUrl: null,
        fileName: null,
      },
    ],
  };

  it("names the current revision and says it has not arrived", () => {
    const row = toDrawingSetRow(set);
    expect(row.currentRevisionId).toBe("r2");
    expect(row.currentNotReceived).toBe(true);
    // And what site IS working to, which is the useful half of that.
    expect(row.latestReceivedRevisionId).toBe("r1");
  });

  it("stops flagging once the current revision is received", () => {
    const received = {
      ...set,
      revisions: set.revisions.map((r) =>
        r.id === "r2" ? { ...r, receivedOn: new Date("2026-03-04T00:00:00.000Z") } : r,
      ),
    };
    const row = toDrawingSetRow(received);
    expect(row.currentNotReceived).toBe(false);
    expect(row.latestReceivedRevisionId).toBe("r2");
  });

  it("carries the file only where there is one", () => {
    const row = toDrawingSetRow(set);
    expect(row.revisions.map((r) => r.fileName)).toEqual([null, "A-series-rev1.pdf"]);
    // Dates cross the wire as ISO, because the phone renders them in UTC
    // like every other date in this product.
    expect(row.revisions[0].issuedOn).toBe("2026-03-01T00:00:00.000Z");
  });
});
