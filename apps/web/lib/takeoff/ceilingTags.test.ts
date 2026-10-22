import { describe, expect, it } from "vitest";
import { areaByFamily, assignCeilings, ceilingHeightFacts, pairTagsToRoomTags, readCeilingDefaults, readCeilingLegend, readCeilingTags, readKeynoteCeilings, readSetLegendPage, roomTagsUnderCeilingCodes } from "./ceilingTags";
import type { PositionedText } from "./roomTags";

const W = 2592;
const t = (str: string, x: number, y: number, height = 9.6): PositionedText => ({ str, x: x * W, y: y * W, width: str.length * 5, height });

describe("readCeilingTags", () => {
  it("reads Baker's stack — type over height — and Murray's one-item tag", () => {
    const tags = readCeilingTags(
      [t("STORAGE", 0.52, 0.32), t("GB", 0.52, 0.326), t("10'-0\" A.F.F.", 0.513, 0.332), t("8'-0\" ACT", 0.7, 0.4), t("10'-6\" GWB", 0.72, 0.42)],
      W,
    );
    expect(tags.map((x) => [x.code, x.heightFeet, x.family])).toEqual([
      ["ACT", 8, "ACT"],
      ["GWB", 10.5, "GYP"],
      ["GB", 10, "GYP"],
    ]);
    expect(tags[2].roomName, "the line over Baker's code is the room").toBe("STORAGE");
  });
  it("joins a split height — NG's `9'` + `0\" A.F.F.` under a CLG. label — and Bunkie's `10' - 0\"` + `A.F.F.`", () => {
    const tags = readCeilingTags([t("CLG.", 0.268, 0.045), t("9'", 0.266, 0.053), t("0\" A.F.F.", 0.272, 0.053), t("10' - 0\"", 0.5, 0.5), t("A.F.F.", 0.51, 0.5)], W);
    expect(tags.map((x) => x.heightFeet)).toEqual([9, 10]);
    expect(tags[0].code).toBeNull();
  });
  it("refuses a bare dimension, and a detail callout — Joplin's D5 over A-103", () => {
    const tags = readCeilingTags([t("8'-0\"", 0.549, 0.224), t("12'-3\"", 0.6, 0.3), t("D5", 0.55, 0.35), t("A-103", 0.55, 0.357)], W);
    expect(tags).toEqual([]);
  });
  it("takes a bare height drawn inside a hexagon, and not one on a dimension string", () => {
    const h = 9.6 / W;
    const item = t("8'-0\"", 0.5, 0.5);
    const cx = 0.5 + (item.width / W) / 2, cy = 0.5 - h / 2, R = 2 * h;
    const hex = Array.from({ length: 6 }, (_, k) => {
      const a = (k * Math.PI) / 3, b = ((k + 1) * Math.PI) / 3;
      return { x1: cx + R * Math.cos(a), y1: cy + R * Math.sin(a), x2: cx + R * Math.cos(b), y2: cy + R * Math.sin(b) };
    });
    expect(readCeilingTags([item], W, [], hex).map((x) => x.heightFeet)).toEqual([8]);
    const dimension = [{ x1: 0.4, y1: cy, x2: 0.6, y2: cy }, { x1: 0.4, y1: cy - h, x2: 0.4, y2: cy + h }, { x1: 0.6, y1: cy - h, x2: 0.6, y2: cy + h }];
    expect(readCeilingTags([item], W, [], [...hex, ...dimension])).toEqual([]);
  });
  it("takes a bare height boxed under the room's number (MHK), and not a neighbour's code 30 ft away", () => {
    const stacked = readCeilingTags([t("TLT.", 0.5, 0.3), t("115A", 0.503, 0.305), t("9'-0\"", 0.5, 0.314)], W);
    expect(stacked.map((x) => x.heightFeet)).toEqual([9]);
    const far = readCeilingTags([t("G", 0.45, 0.3), t("5'-2\"", 0.48, 0.302)], W);
    expect(far, "a fixture letter beside a dimension is not a ceiling tag").toEqual([]);
  });
  it("reads a legend only under a title that says ceiling, never a keynote table", () => {
    const keynotes = [t("CF4", 0.1, 0.9), t("G.C. TO PROVIDE NEW GYPSUM BOARD CEILING AT", 0.12, 0.9), t("CF4", 0.5, 0.5)];
    expect(readCeilingLegend(keynotes, W)).toEqual([]);
    expect(readCeilingTags(keynotes, W)).toEqual([]);
    const titled = [t("RCP SYMBOL LEGEND", 0.75, 0.6), t("ES", 0.76, 0.7), t("EXPOSED TO STRUCTURE", 0.8, 0.7)];
    expect(readCeilingLegend(titled, W)).toEqual([{ code: "ES", description: "EXPOSED TO STRUCTURE", family: "OPEN" }]);
  });
  it("takes a hexagon height beside a CLG. HEIGHT legend as a tag only when the sheet says AFF", () => {
    expect(readCeilingTags([t("8' - 0\"AFF", 0.3, 0.3)], W)[0]?.heightFeet).toBe(8);
    expect(readCeilingTags([t("8'-8 7/8\" AFF", 0.3, 0.3)], W)[0]?.heightFeet).toBeCloseTo(8.74, 2);
    const campClark = readCeilingTags([t("G", 0.3, 0.3), t("8'-0\"±", 0.31, 0.3)], W);
    expect(campClark.map((x) => [x.code, x.heightFeet, x.family])).toEqual([["G", 8, "GYP"]]);
  });
  it("reads a legend code through the legend, and a type-only tag", () => {
    const items = [
      t("CEILING LEGEND", 0.75, 0.05), t("C1", 0.788, 0.066), t("2' X 6' ACT SYSTEM", 0.8, 0.066), t("C3", 0.788, 0.1), t("GWB FRAMED DROP CEILING", 0.8, 0.1),
      t("C3", 0.4, 0.3), t("9' - 0\" AFF", 0.398, 0.306), t("2X4 ACT", 0.2, 0.2), t("OPEN TO ABOVE", 0.3, 0.6), t("L=LAY-IN ACOUST. TILE,", 0.7, 0.9), t("L", 0.1, 0.1), t("9'-0\"", 0.1, 0.106),
    ];
    const legend = readCeilingLegend(items, W);
    expect(legend.map((r) => [r.code, r.family])).toEqual([["C1", "ACT"], ["C3", "GYP"], ["L", "ACT"]]);
    const tags = readCeilingTags(items, W, legend);
    const byCode = Object.fromEntries(tags.map((x) => [x.code, x]));
    expect(byCode["C3"]).toMatchObject({ heightFeet: 9, family: "GYP", familyFrom: "legend" });
    expect(byCode["L"]).toMatchObject({ heightFeet: 9, family: "ACT", familyFrom: "legend" });
    expect(byCode["2X4 ACT"]).toMatchObject({ heightFeet: null, family: "ACT" });
    expect(byCode["OPEN TO ABOVE"]).toMatchObject({ family: "OPEN" });
    const wrapped = readCeilingTags([t("OPEN TO", 0.6, 0.6), t("STRUCTURE", 0.598, 0.604), t("ABOVE", 0.602, 0.608)], W);
    expect(wrapped.map((x) => [x.code, x.family])).toEqual([["OPEN TO STRUCTURE ABOVE", "OPEN"]]);
    const noCeiling = readCeilingTags([t("ELEC", 0.2, 0.3), t("011B", 0.202, 0.304), t("NO CEILING,", 0.198, 0.309), t("OPEN TO EXIST", 0.196, 0.313)], W);
    expect(noCeiling.map((x) => [x.code, x.family, x.roomName])).toEqual([["NO CEILING OPEN TO EXIST", "OPEN", null]]);
    expect(tags.some((x) => x.code === "C1"), "the legend row itself is not a tag").toBe(false);
  });
});

describe("readCeilingDefaults", () => {
  it("reads the sheet-wide note", () => {
    expect(readCeilingDefaults([t("8.", 0.1, 0.5), t("ALL CEILINGS SHALL BE 9'-0\" AFF UNLESS OTHERWISE NOTED.", 0.11, 0.5)], W)).toMatchObject({ heightFeet: 9, family: null });
    expect(readCeilingDefaults([t("ALL CEILING ARE EXPOSED UNLESS NOTED OTHERWISE.", 0.1, 0.5)], W)).toMatchObject({ heightFeet: null, family: "OPEN" });
    expect(readCeilingDefaults([t("ALL GYP. BD CEILINGS @ 9'-0\" U.N.O.", 0.1, 0.5)], W)).toMatchObject({ heightFeet: 9, family: "GYP" });
    expect(readCeilingDefaults([t("CENTER ALL CEILING GRID IN ROOMS", 0.1, 0.5)], W).phrase).toBeNull();
  });
});

describe("assignCeilings", () => {
  const rooms = [
    { xs: [0, 0.1, 0.1, 0], ys: [0, 0, 0.1, 0.1], squareFeet: 100 },
    { xs: [0.2, 0.3, 0.3, 0.2], ys: [0, 0, 0.1, 0.1], squareFeet: 50 },
  ];
  it("gives each room the tag inside it, the note to the rest, and sums area by family", () => {
    const tags = readCeilingTags([t("GB", 0.05, 0.05), t("10'-0\" A.F.F.", 0.045, 0.056)], W);
    const c = assignCeilings(rooms, tags, { heightFeet: 9, family: "ACT", phrase: "ALL CEILINGS…" });
    expect(c[0]).toMatchObject({ family: "GYP", heightFeet: 10, source: "tag" });
    expect(c[1]).toMatchObject({ family: "ACT", heightFeet: 9, source: "note" });
    expect(areaByFamily(rooms, c)).toEqual({ ACT: 50, GYP: 100, OPEN: 0, OTHER: 0, UNKNOWN: 0 });
    expect(ceilingHeightFacts("A111", tags)).toEqual([{ kind: "ceiling-height", feet: 10, sheet: "A111", phrase: "GB 10'-0\" A.F.F." }]);
  });
});

describe("pairTagsToRoomTags", () => {
  it("pairs by the name over the tag, by the stack above, else by the nearest room tag within reach", () => {
    const tags = readCeilingTags(
      [t("STORAGE", 0.52, 0.32), t("GB", 0.52, 0.326), t("10'-0\" A.F.F.", 0.513, 0.332), t("8'-0\" ACT", 0.2, 0.21), t("9'-0\" GWB", 0.7, 0.7)],
      W,
    );
    const rooms = [
      { name: "STORAGE", number: "106", x: 0.52 * W, y: 0.32 * W },
      { name: "CORRIDOR", number: "101", x: 0.2 * W, y: 0.2 * W },
      { name: "FAR", number: "999", x: 0.9 * W, y: 0.1 * W },
    ];
    const by = pairTagsToRoomTags(rooms, tags, W, 100, { heightFeet: 9, family: "ACT", phrase: "note" });
    expect(by[0]).toMatchObject({ family: "GYP", heightFeet: 10, source: "tag" });
    expect(by[1]).toMatchObject({ family: "ACT", heightFeet: 8, source: "tag" });
    expect(by[2], "the 9'-0\" GWB tag is 40+ ft from every room, so FAR gets the note").toMatchObject({ family: "ACT", heightFeet: 9, source: "note" });
  });
});

describe("names and numbers around a tag", () => {
  it("reads a name that starts with a digit and one wrapped over two lines", () => {
    const tags = readCeilingTags([t("911 CALL CENTER", 0.5, 0.3), t("ACT", 0.52, 0.306), t("10'-0\" A.F.F.", 0.51, 0.312), t("HAM RADIO/", 0.2, 0.3), t("COMM.", 0.21, 0.304), t("GB", 0.21, 0.31), t("10'-0\" A.F.F.", 0.2, 0.316)], W);
    expect(tags.map((x) => x.roomName).sort()).toEqual(["911 CALL CENTER", "HAM RADIO/ COMM."]);
  });
  it("gives SW's room back its number when the reader took the ceiling code for it", () => {
    const items = [t("OFFICE", 0.4, 0.3), t("105", 0.405, 0.305), t("C3", 0.405, 0.311)];
    const legend = [{ code: "C3", description: "USG 24x24", family: "ACT" as const }];
    const fixed = roomTagsUnderCeilingCodes([{ name: "OFFICE", number: "C3", x: 0.405 * W, y: 0.311 * W }], items, W, legend);
    expect(fixed[0].number).toBe("105");
  });
  it("prefers the polygon the tag sits in, and the higher of two bare heights", () => {
    const tags = readCeilingTags([t("17'-0\" AFF", 0.12, 0.05), t("10'-0\" AFF", 0.15, 0.08)], W);
    const rooms = [{ name: "HALL", number: "138", x: 0.11 * W, y: 0.02 * W }, { name: "CLASSROOM", number: "123", x: 0.15 * W, y: 0.09 * W }];
    const polygons = [{ xs: [0, 0.3, 0.3, 0], ys: [0, 0, 0.03, 0.03] }, { xs: [0, 0.3, 0.3, 0], ys: [0.04, 0.04, 0.1, 0.1] }];
    const by = pairTagsToRoomTags(rooms, tags, W, 100, { heightFeet: 9, family: null, phrase: null }, 25, polygons);
    expect(by[0]).toMatchObject({ heightFeet: 9, source: "note" });
    expect(by[1]).toMatchObject({ heightFeet: 17, source: "tag", disagreeing: true });
  });
});

describe("codes with no legend on the sheet", () => {
  it("guesses a family from the prefix and says so", () => {
    const tags = readCeilingTags([t("11' - 0\"", 0.4, 0.4), t("AC01", 0.402, 0.404), t("9' - 0\"", 0.6, 0.4), t("PA03", 0.602, 0.404), t("ZZ09", 0.8, 0.4)], W);
    expect(tags.map((x) => [x.code, x.family, x.familyFrom, x.heightFeet])).toEqual([
      ["AC01", "ACT", "prefix", 11],
      ["PA03", "GYP", "prefix", 9],
    ]);
  });
  it("reads SW's ceiling finish schedule: a short column label between the code and the words", () => {
    const items = [
      t("CEILING FINISH SCHEDULE", 0.791, 0.161, 18.9), t("C1", 0.779, 0.177), t("CEILING:", 0.789, 0.174, 8.1), t("EXPOSED TO STRUCTURE :", 0.804, 0.174, 8.1),
      t("C2", 0.779, 0.188), t("CEILING:", 0.789, 0.185, 8.1), t("INSTALL 5/8\" GYP. BD. CEILING", 0.804, 0.185, 8.1),
      t("C3", 0.779, 0.204), t("MFG:", 0.789, 0.199, 8.1), t("USG", 0.804, 0.199, 8.1), t("FINISH:", 0.789, 0.21, 8.1), t("24\"x24\" SANDRIFT #808", 0.804, 0.21, 8.1),
    ];
    expect(readCeilingLegend(items, W).map((r) => [r.code, r.family])).toEqual([["C1", "OPEN"], ["C2", "GYP"], ["C3", "ACT"]]);
  });
});

describe("legends elsewhere in the set, and keynotes", () => {
  it("reads Baker's A601 ceiling types drawn as details: a big code with the words in a callout", () => {
    const items = [
      t("CEILING TYPES", 0.38, 0.26, 12), t("ACT", 0.56, 0.08, 20), t("12-GAUGE HANGER WIRE", 0.65, 0.11), t("ACOUSTICAL CEILING PANEL", 0.65, 0.16), t("ACOUSTICAL MAIN TEE", 0.65, 0.19),
      t("GYP-3", 0.39, 0.08, 20), t("FRAMING", 0.47, 0.14), t("5/8\" GYP BOARD", 0.47, 0.18), t("RATING:", 0.44, 0.07, 7),
    ];
    const rows = readSetLegendPage(items, W, 25);
    expect(rows.map((r) => [r.code, r.family, r.from]).sort()).toEqual([["ACT", "ACT", "set p25"], ["GYP-3", "GYP", "set p25"]]);
    expect(readSetLegendPage([t("WALL TYPES", 0.3, 0.3), t("S6A", 0.3, 0.4, 20), t("GYP. BOARD", 0.35, 0.45)], W, 9), "no ceiling title, no rows").toEqual([]);
  });
  it("reads E Street's keynotes that name a ceiling, flags existing ones, and ignores fixture keynotes", () => {
    const items = [
      t("KEYNOTES", 0.8, 0.6, 12), t("C11.01", 0.78, 0.66), t("EXISTING SUSPENDED 2X4 CEILING GRID SYSTEM TO REMAIN,", 0.81, 0.66), t("C11.03", 0.78, 0.68), t("EXISTING GYPSUM BOARD CEILING TO REMAIN. SEE ROOM", 0.81, 0.68),
      t("C12.01", 0.78, 0.7), t("REMOVE EXISTING COMPLETE SUSPENDED CEILING GRID,", 0.81, 0.7), t("D52.01", 0.78, 0.72), t("REMOVE ALL EXISTING INTERIOR G LIGHTING FIXTURES, TYPICAL", 0.81, 0.72),
    ];
    const rows = readKeynoteCeilings(items, W);
    expect(rows.map((r) => [r.code, r.family, r.existing])).toEqual([["C11.01", "ACT", true], ["C11.03", "GYP", true], ["C12.01", "OPEN", true]]);
    // A keynote hexagon in a room becomes the room's ceiling through the table, and the words win.
    const tags = readCeilingTags([t("C11.03", 0.2, 0.3), ...items], W, rows);
    expect(tags.map((x) => [x.code, x.family, x.existing])).toEqual([["C11.03", "GYP", true]]);
    expect(readCeilingTags([t("C11.03", 0.2, 0.3)], W, []), "a keynote code with no table is nothing").toEqual([]);
  });
});
