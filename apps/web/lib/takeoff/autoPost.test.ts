import { describe, expect, it } from "vitest";
import { AUTO_DOORS_LABEL, AUTO_MARK, BAR, EVIDENCE, autoLabel, autoPosts, clearsBar, doorAutoPosts, isAutoLabel, queueHeader } from "./autoPost";
import { POSTS, SOURCE_WORDS } from "./postingGate";

describe("auto-post: a source posts itself only past both bars", () => {
  const row = { trainingFt: 500, heldOutFt: 500, measured: "2026-11-08", trainingSheets: 9, heldOutSheets: 7 };
  it("needs ≥97% training AND ≥95% held-out, and a held-out measurement at all", () => {
    expect(clearsBar({ ...row, trainingPct: BAR.trainingPct, heldOutPct: BAR.heldOutPct })).toBe(true);
    expect(clearsBar({ ...row, trainingPct: 96.9, heldOutPct: 100 })).toBe(false);
    expect(clearsBar({ ...row, trainingPct: 100, heldOutPct: 94.9 })).toBe(false);
    expect(clearsBar({ ...row, trainingPct: 100, heldOutPct: null })).toBe(false);
  });

  it("no source clears it on the 2026-11-08 measurement, so nothing posts", () => {
    for (const source of Object.keys(EVIDENCE) as (keyof typeof EVIDENCE)[]) {
      expect(autoPosts(source)).toBe(false);
      expect(POSTS[source]).toBe(false);
    }
    // Every source the gate knows has a measured row.
    expect(Object.keys(EVIDENCE).sort()).toEqual(Object.keys(SOURCE_WORDS).sort());
  });

  it("labels an auto-posted run with its source, and reads the label back", () => {
    const label = autoLabel("C6", SOURCE_WORDS.tag);
    expect(label).toBe("C6 wall (auto, from printed tag)");
    expect(isAutoLabel(label)).toBe(true);
    expect(label.includes(AUTO_MARK)).toBe(true);
    expect(isAutoLabel("C6 wall")).toBe(false);
    expect(isAutoLabel("C6 wall (U.N.O.)")).toBe(false);
    expect(isAutoLabel(null)).toBe(false);
  });

  it("the queue header says the feet and the groups left, and nothing when nothing posted", () => {
    expect(queueHeader(312.4, 4)).toBe("312 ft posted automatically · 4 groups need you");
    expect(queueHeader(1250, 1)).toBe("1,250 ft posted automatically · 1 group needs you");
    expect(queueHeader(0, 4)).toBeNull();
  });

  it("doors: a marked door clears the bar and posts itself; every door found does not", () => {
    expect(doorAutoPosts("door-marked")).toBe(true);
    expect(doorAutoPosts("door-any")).toBe(false);
    // The count's label is read back by Undo and the queue the same way a wall's is.
    expect(isAutoLabel(AUTO_DOORS_LABEL)).toBe(true);
    expect(queueHeader(0, 3, 14)).toBe("14 doors posted automatically · 3 groups need you");
    expect(queueHeader(312, 4, 1)).toBe("312 ft and 1 door posted automatically · 4 groups need you");
  });
});
