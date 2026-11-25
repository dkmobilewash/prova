import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundOnSheet } from "./findWallsOnSheet";
import { typeSource } from "./postingGate";
import { setUnoDefaults, stageTypeGroups } from "./stageGroups";
import { UNO_CODE_GUARDS, unoDefaults, unoDefaultType } from "./wallNotes";
import type { MatchableWallType } from "./wallTypeMatch";
import type { WallCandidate } from "./wallVectors";

// prereg-uno-default-type.md: the training sets' own sentences, verbatim as the census read them.
const row = (str: string, y = 100) => ({ str, x: 10, y, width: 0, height: 0 });
const codes = (...lines: string[]) => unoDefaults(lines.map((l, i) => row(l, 100 + 20 * i))).map((d) => d.code);

describe("a U.N.O. default-type sentence (TAKEOFF_UNO_DEFAULT)", () => {
  it("reads the training sets' forms: Wendell, 114026, Topeka, and Baker's sentence wrapped onto a second row", () => {
    expect(codes("7. ALL PARTITIONS TO BE TYPE 'S4' UNLESS NOTED OTHERWISE.")).toEqual(["S4"]);
    expect(codes("A. ALL INTERIOR PARTITION TO BE A1A TO BOTTOM OF DECK UNLESS OTHERWISE NOTED.")).toEqual(["A1A"]);
    expect(codes("ALL INTERIOR WALLS ARE TYPE P1, UNLESS NOTED", "ALL EXTERIOR WALLS ARE TYPE P30, UNLESS NOTED")).toEqual(["P1", "P30"]);
    expect(codes("PROVIDED ON SHEET A601. INTERIOR WALL ASSEMBLY TYPE TO BE", "S6B UNLESS NOTED OTHERWISE.")).toEqual(["S6B"]);
  });

  it("refuses what is not a wall type, and a default with no U.N.O. (the named guards)", () => {
    expect(codes("ALL WALLS TO BE PAINTED P-1 UNLESS NOTED")).toEqual([]);
    expect(codes("ALL WALLS ARE TO REST ON CONTINUOUS FOAM SILL SEALER UNLESS OTHERWISE NOTED")).toEqual([]);
    expect(codes("ALL NEW PARTITIONS SHALL BE TYPE WC, UNO")).toEqual([]);
    expect(codes("ALL PARTITIONS TO BE TYPE S4")).toEqual([]);
    expect(codes("ALL PARTITIONS TO BE A601 UNLESS NOTED")).toEqual([]);
    const refused = (c: string) => UNO_CODE_GUARDS.filter((g) => g.refuses(c)).map((g) => g.name);
    expect(refused("PAINTED")).toEqual(["not a designation"]);
    expect(refused("A601")).toEqual(["sheet reference"]);
    expect(["S4", "A1A", "S6B", "P30", "EXT-1"].flatMap(refused)).toEqual([]);
  });

  it("one code or none: the sheet's own first, else the set's; two codes give nothing", () => {
    const d = (code: string) => ({ code, note: `ALL PARTITIONS TO BE ${code} U.N.O.` });
    expect(unoDefaultType([d("S4")], [d("A1A")], [])?.type.code).toBe("S4");
    expect(unoDefaultType([], [d("A1A")], [])?.type).toMatchObject({ code: "A1A", thicknessIn: null });
    expect(unoDefaultType([], [d("P1"), d("P30")], [])).toBeNull();
    expect(unoDefaultType([d("P1"), d("P30")], [d("A1A")], [])).toBeNull();
    const lib: MatchableWallType[] = [{ id: "wt_s4", code: "S4", name: "S4", hasParts: true, thicknessIn: 4.875 }];
    expect(unoDefaultType([d("S4")], null, lib)?.type.id).toBe("wt_s4");
  });
});

describe("the stage settles untagged walls to the U.N.O. default, suggested as the note's", () => {
  afterEach(() => vi.unstubAllEnvs());
  const FPU = 288, W = 2592, FOOT = 1 / FPU;
  const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessFeet: 4.75 / 12 }) as WallCandidate;
  const plain = wall(0.2, 0.5, 0.3, 0.5);
  const tagged = wall(0.2, 0.2, 0.3, 0.2);
  const found = { walls: [plain, tagged], inUnits: [], groups: [] } as unknown as FoundOnSheet;
  const tag = { str: "B2", x: 0.25 * W, y: (0.2 + 0.5 * FOOT) * W, width: 0, height: 0 };
  const note = { str: "ALL PARTITIONS TO BE TYPE 'S4' UNLESS NOTED OTHERWISE.", x: 0.8 * W, y: 0.9 * W, width: 0, height: 0 };
  // The measured posture: no legend, an empty library, the printed codes as vocabulary.
  const base = { found, segmentsPt: [], widthPt: W, feetPerUnit: FPU, wallTypes: [], legendCodes: [], vocabulary: ["B2"], fromText: false, scanned: false, siblings: async () => [], readSibling: async () => null };
  const typed = (groups: Awaited<ReturnType<typeof stageTypeGroups>>, run: WallCandidate) => {
    const g = groups.find((x) => x.runs.includes(run))!;
    return g.source.kind === "TAG" ? `tag:${g.source.tag}` : (typeSource(g) === null ? "none" : `${typeSource(g)!.source}:${typeSource(g)!.type.code}`);
  };

  it("on: the untagged wall is the note's S4, the tagged wall keeps its tag; unset: nothing changes", async () => {
    const off = await stageTypeGroups({ ...base, textItems: [tag, note] });
    expect([typed(off, plain), typed(off, tagged)]).toEqual(["none", "tag:B2"]);
    vi.stubEnv("TAKEOFF_UNO_DEFAULT", "1");
    const on = await stageTypeGroups({ ...base, textItems: [tag, note] });
    expect([typed(on, plain), typed(on, tagged)]).toEqual(["note:S4", "tag:B2"]);
  });

  it("on: a sheet with no note works to the set's one default, read once per document; two defaults in the set, none", async () => {
    vi.stubEnv("TAKEOFF_UNO_DEFAULT", "1");
    let reads = 0;
    const doc = (...pages: string[]) => ({ pageCount: pages.length, pageText: async (n: number) => { reads += 1; return { items: [row(pages[n - 1]!)] }; } });
    const one = setUnoDefaults(doc("GENERAL NOTES", "A. ALL INTERIOR PARTITION TO BE A1A TO BOTTOM OF DECK UNLESS OTHERWISE NOTED."));
    const first = await stageTypeGroups({ ...base, textItems: [tag], setDefaults: one });
    await stageTypeGroups({ ...base, textItems: [tag], setDefaults: one });
    expect(typed(first, plain)).toBe("note:A1A");
    expect(reads).toBe(2);
    const two = setUnoDefaults(doc("ALL INTERIOR WALLS ARE TYPE P1, UNLESS NOTED", "ALL EXTERIOR WALLS ARE TYPE P30, UNLESS NOTED"));
    expect(typed(await stageTypeGroups({ ...base, textItems: [tag], setDefaults: two }), plain)).toBe("none");
  });
});
