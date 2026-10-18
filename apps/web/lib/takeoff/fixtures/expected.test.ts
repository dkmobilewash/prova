import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dimensionsFromWords,
  printedScaleIn,
  roomsFromWords,
  type ExpectedSheet,
} from "./expected";

/**
 * ── THE PARSERS THAT WRITE THE ANSWER KEY ──
 *
 * A key is only worth what its parser is worth, and a parser that quietly
 * matches nothing produces `0 rooms` — which is not a null the scorer skips but
 * a confident wrong answer it will hold the pipeline to. That already happened
 * once here: the room-number pattern required three digits, two of the twenty
 * fixtures are metric and number rooms `01`, and the key called both of them
 * empty.
 *
 * So these cases are mostly about what the parser must NOT match.
 */

describe("reading a printed scale", () => {
  it("reads the imperial forms a title block uses", () => {
    expect(printedScaleIn('SCALE: 1/4" = 1\'-0"')).toBe('1/4" = 1\'-0"');
    expect(printedScaleIn('SCALE: 1/8" = 1\'-0"')).toBe('1/8" = 1\'-0"');
    expect(printedScaleIn('3/16" = 1\'-0"')).toBe('3/16" = 1\'-0"');
    expect(printedScaleIn('1/2" = 1\'-0"')).toBe('1/2" = 1\'-0"');
  });

  it("NORMALISES the spellings of the same scale", () => {
    // The same scale is printed several ways across a set, and a key that
    // stored both would fail a correct pipeline over punctuation.
    expect(printedScaleIn('1/4"=1\'-0"')).toBe('1/4" = 1\'-0"');
    expect(printedScaleIn("SCALE: 1/4\" = 1'")).toBe('1/4" = 1\'-0"');
    expect(printedScaleIn('1/4" = 1\' - 0"')).toBe('1/4" = 1\'-0"');
  });

  it("reads the metric ratio forms", () => {
    expect(printedScaleIn("SCALE: 1:100")).toBe("1:100");
    expect(printedScaleIn("1 : 50")).toBe("1:50");
  });

  it("reads NTS as the refusal it is", () => {
    expect(printedScaleIn("SCALE: NTS")).toBe("NTS");
    expect(printedScaleIn("N.T.S.")).toBe("NTS");
  });

  it("says nothing about text that carries no scale", () => {
    // Every one of these is on a real title block beside the scale note.
    for (const text of ["FLOOR PLAN", "DATE: 10/15/2026", "A-101", "PLAN S01", "GENERAL NOTES", ""]) {
      expect(printedScaleIn(text), `"${text}" was read as a scale`).toBeNull();
    }
  });
});

describe("reading room tags", () => {
  it("reads NAME then NUMBER, with an area when the tag prints one", () => {
    expect(roomsFromWords(["OFFICE", "101", "361 SF"])).toEqual([
      { name: "OFFICE", number: "101", area: { value: 361, unit: "sf" } },
    ]);
  });

  it("reads a two-digit number and a metric area", () => {
    // The case that was silently returning nothing.
    expect(roomsFromWords(["LIVING", "01", "32.6 m2"])).toEqual([
      { name: "LIVING", number: "01", area: { value: 32.6, unit: "m2" } },
    ]);
  });

  it("keeps the area IN THE UNIT IT WAS PRINTED IN", () => {
    // Converting in the key would put arithmetic nobody can check against the
    // drawing into the answer. The scorer converts, where it can be argued with.
    const [room] = roomsFromWords(["BATH", "05", "5.6 m2"]);
    expect(room.area).toEqual({ value: 5.6, unit: "m2" });
  });

  it("reads a name with a space or a slash in it", () => {
    expect(roomsFromWords(["SALES FLOOR", "01"])[0].name).toBe("SALES FLOOR");
    expect(roomsFromWords(["KITCHEN / DINING", "102"])[0].name).toBe("KITCHEN / DINING");
  });

  it("does NOT read a grid bubble, a scale bar or a detail marker as a room", () => {
    // All of these sit in the text of the same sheets, often next to each other.
    expect(roomsFromWords(["A", "1"])).toEqual([]);
    expect(roomsFromWords(["0", "8", "16", "32'"])).toEqual([]);
    expect(roomsFromWords(["1", "A-301", "2", "A-301"])).toEqual([]);
    expect(roomsFromWords(["N"])).toEqual([]);
    // A single digit is a bubble, never a room number.
    expect(roomsFromWords(["LOBBY", "1"])).toEqual([]);
  });

  it("does not run two rooms together", () => {
    const rooms = roomsFromWords(["LIVING", "101", "KITCHEN", "102", "HALL", "103"]);
    expect(rooms.map((r) => r.number)).toEqual(["101", "102", "103"]);
  });

  it("does not take the NEXT room's name as this one's area", () => {
    // The sequence `NAME NUMBER NAME NUMBER` must not consume three items.
    const rooms = roomsFromWords(["LIVING", "101", "KITCHEN", "102"]);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].area).toBeNull();
  });
});

describe("reading dimension strings", () => {
  it("reads the imperial forms", () => {
    const words = ["24'-6 1/2\"", "16'-4\"", "40'-6 1/2\"", "FLOOR PLAN", "101"];
    expect(dimensionsFromWords(words, '1/4" = 1\'-0"')).toEqual(["24'-6 1/2\"", "16'-4\"", "40'-6 1/2\""]);
  });

  it("reads bare millimetres ONLY on a sheet whose scale is a ratio", () => {
    const words = ["7150", "5150", "12300"];
    expect(dimensionsFromWords(words, "1:100")).toEqual(["7150", "5150", "12300"]);
    // The same digits on an imperial sheet are a job number, a year or an area
    // — the unit is not in the string, so the sheet has to supply it.
    expect(dimensionsFromWords(words, '1/4" = 1\'-0"')).toEqual([]);
    expect(dimensionsFromWords(words, null)).toEqual([]);
  });
});

describe("the committed keys", () => {
  const dir = join(import.meta.dirname, "expected");
  const keys = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ExpectedSheet);

  it("there is one per fixture, and they parsed to something", () => {
    const plans = readdirSync(join(import.meta.dirname, "plans")).filter((f) => f.endsWith(".pdf"));
    expect(keys.length, "a fixture has no key, or a key has no fixture").toBe(plans.length);
    expect(keys.length).toBeGreaterThanOrEqual(20);
  });

  it("NEVER claims a wall length, because no sheet here prints one", () => {
    // The guard that keeps this set honest. The day somebody fills these in by
    // measuring the drawing with the detector under test, the key stops being
    // evidence and becomes an echo.
    for (const key of keys) {
      expect(key.wallLfTotal, `${key.id} claims a wall length nobody printed`).toBeNull();
      expect(key.doorCount, `${key.id} claims a door count`).toBeNull();
      expect(key.windowCount, `${key.id} claims a window count`).toBeNull();
    }
  });

  it("the sheets that print no scale say so, rather than guessing one", () => {
    const silent = keys.filter((k) => k.scale === null && !k.raster);
    expect(silent.length, "no unscaled sheet in the set — the decline path is ungraded").toBeGreaterThan(0);
    for (const key of silent) {
      expect(key.notes.join(" ")).toMatch(/DECLINE/i);
    }
  });

  it("the raster sheets are marked, and carry nothing else", () => {
    const raster = keys.filter((k) => k.raster);
    expect(raster.length, "no raster fixture — the scan path is ungraded").toBeGreaterThan(0);
    for (const key of raster) {
      expect(key.rooms, `${key.id} is raster but claims rooms`).toEqual([]);
      expect(key.scale, `${key.id} is raster but claims a scale`).toBeNull();
    }
  });

  it("every non-raster sheet found at least one room", () => {
    // The assertion that would have caught the metric bug. A vector floor plan
    // with zero rooms in its key is a parser failure wearing a fact's clothes.
    for (const key of keys.filter((k) => !k.raster)) {
      expect(key.rooms.length, `${key.id} parsed to no rooms at all`).toBeGreaterThan(0);
    }
  });
});
