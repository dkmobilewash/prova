import { describe, expect, it } from "vitest";
import { scheduledOpenings } from "./doorsWindows";

describe("scheduled openings from stored rows", () => {
  it("reads the width out of the size column and drops rows with no mark", () => {
    const rows = scheduledOpenings([
      { mark: "101", size: `3'-0" x 7'-0"`, description: "CONFERENCE to HALLWAY" },
      { mark: "108", size: `6'-0" x 7'-0"` },
      { mark: " ", size: `3'-0"` },
      { mark: "E105A", size: `3' - 6" x 6' - 8"`, description: null },
    ]);
    expect(rows.map((r) => [r.mark, r.widthFt])).toEqual([["101", 3], ["108", 6], ["E105A", 3.5]]);
    expect(rows[0]!.heightFt).toBe(7);
  });
});
