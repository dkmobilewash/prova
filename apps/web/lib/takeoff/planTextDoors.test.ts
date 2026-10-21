import { describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));
vi.mock("@prova/integrations", () => ({ extractScheduleRows: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ aiGate: vi.fn() }));

const { doorsOnSheet, typedFeetOf } = await import("./planTextRead");
const { propagatedTag } = await import("./planTextTags");

const W = 1000;
const FPU = 100;

describe("joining a read schedule to a sheet", () => {
  it("places a scheduled mark printed beside a run, and lists the rows it could not place", () => {
    // One run along y=0.5; `101A` bare beside it, 1 ft off; `102` is only in
    // the schedule.
    const walls = [{ x1: 0.1, y1: 0.5, x2: 0.5, y2: 0.5, thicknessFeet: 0.4, lengthFeet: 40 }];
    const text = [{ str: "101A", x: 290, y: 494, width: 20, height: 8 }];
    const got = doorsOnSheet({
      segments: [],
      widthPt: W,
      text,
      walls,
      feetPerUnit: FPU,
      rows: [
        { mark: "101A", size: "3'-0\" x 7'-0\"", description: "office" },
        { mark: "102", size: null, description: null },
      ],
    });
    expect(got.rowsTotal).toBe(2);
    expect(got.placed.map((p) => [p.mark, p.widthFt, p.widthFrom, p.placedBy])).toEqual([["101A", 3, "schedule", "mark"]]);
    expect(got.unplaced).toEqual(["102"]);
  });
});

describe("feet by where the type came from", () => {
  it("splits tagged, propagated, note and untyped feet", () => {
    const run = { x1: 0, y1: 0, x2: 0.1, y2: 0, thicknessFeet: 0.4, lengthFeet: 10 };
    const typed = typedFeetOf([
      { inches: 4.875, runs: [run], feet: 10, source: { kind: "TAG", tag: "A" }, candidates: [] },
      { inches: 4.875, runs: [run], feet: 7, source: { kind: "TAG", tag: propagatedTag("A") }, candidates: [] },
      { inches: 4.875, runs: [run], feet: 5, source: { kind: "GENERAL_NOTE", note: "ALL PARTITIONS TYPE A U.N.O." }, candidates: [] },
      { inches: 4.875, runs: [run], feet: 3, source: { kind: "REMAINDER" }, candidates: [] },
    ]);
    expect(typed).toEqual({ taggedFeet: 10, propagatedFeet: 7, noteFeet: 5, untypedFeet: 3 });
  });
});
