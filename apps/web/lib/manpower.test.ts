import { describe, expect, it } from "vitest";
import { manpowerLine, summarizeManpower } from "./manpower";

const e = (who: string, hours: string, craft: string | null) => ({
  hours,
  employeeUserId: who.startsWith("u") ? who : null,
  crewMemberId: who.startsWith("c") ? who : null,
  craftClassification: craft ? { name: craft } : null,
});

describe("manpower from time entries", () => {
  it("counts people, not entries, and splits by craft", () => {
    const m = summarizeManpower([
      e("u1", "8", "Carpenter JM"),
      e("c1", "4", "Carpenter JM"),
      e("c1", "4", "Carpenter JM"), // same person, second cost code
      e("c2", "8", "Carpenter App"),
    ]);
    expect(m).toEqual({
      headcount: 3,
      hours: 24,
      byCraft: [
        { craft: "Carpenter JM", headcount: 2, hours: 16 },
        { craft: "Carpenter App", headcount: 1, hours: 8 },
      ],
    });
    expect(manpowerLine(m)).toBe("3 people · 24h — Carpenter JM 2 · 16h, Carpenter App 1 · 8h");
  });

  it("puts untagged hours last and says so plainly when there are none", () => {
    const m = summarizeManpower([e("u1", "2", null), e("u2", "8", "Laborer")]);
    expect(m.byCraft.map((c) => c.craft)).toEqual(["Laborer", "No craft"]);
    expect(manpowerLine(summarizeManpower([]))).toBe("No hours logged for this day");
    expect(manpowerLine(summarizeManpower([e("u1", "8", null)]))).toBe("1 person · 8h");
  });
});
