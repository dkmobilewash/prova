import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyWallFeet, loadKeyTypes, parseRoomZoneKey, wallKeyHeight, zoneCell, zoneFeet } from "./roomZoneKey";

// The three keys' own row shapes, invented rooms (no client text in the repo).
const JOPLIN = "```\n101 | Lobby | can't tell | straddles\n102 | Office | ADMIN | roof plan\n126 | Intake | LOWER | shelter\n137 | Dining | CENTRAL | D4\n138.2 | Hall | CENTRAL | E-F\n```";
const BUNKIE = "```\nE100 | (room) | MAIN 10'-0\" | A300\nK106 | (warehouse) | WAREHOUSE 14'-4\" | A301\n```";
const SW = "```\n102 | Wholesale | 13'-6\" | RCP note 11\n104 | Restroom | 8'-0\" | C3 ACT\n103 | Tint | 9'-6\" | RCP note 5\n```";
const JOPLIN_ZONES = [{ zone: "lower roofs", feet: 12 }, { zone: "admin", feet: 12.333 }, { zone: "central", feet: 16.667 }];

describe("the zone keys", () => {
  it("read a zone with its printed height, a bare zone name, and skip a can't-tell row", () => {
    expect(zoneCell("MAIN 10'-0\"")).toEqual({ zone: "MAIN", feet: 10 });
    expect(zoneCell("WAREHOUSE 14'-4\"")?.feet).toBeCloseTo(14.333, 3);
    expect(zoneCell("13'-6\"")).toMatchObject({ feet: 13.5 });
    expect(zoneCell("CENTRAL")).toEqual({ zone: "CENTRAL", feet: null });
    expect(zoneCell("can't tell")).toBeNull();
  });

  it("parse every keyed room of each set, numbers as printed", () => {
    expect([...parseRoomZoneKey(JOPLIN).keys()]).toEqual(["102", "126", "137", "138.2"]);
    expect(parseRoomZoneKey(BUNKIE).get("K106")?.feet).toBeCloseTo(14.333, 3);
    expect(parseRoomZoneKey(SW).get("102")).toMatchObject({ feet: 13.5 });
  });

  it("a height-less zone takes the heights key's figure by name", () => {
    expect(zoneFeet({ zone: "LOWER", feet: null }, JOPLIN_ZONES)).toBe(12);
    expect(zoneFeet({ zone: "CENTRAL", feet: null }, JOPLIN_ZONES)).toBe(16.667);
    expect(zoneFeet({ zone: "MAIN", feet: 10 }, JOPLIN_ZONES), "a printed height wins").toBe(10);
  });

  it("a wall's key height: one figure when its keyed rooms agree; none between two zones or beside no keyed room", () => {
    const key = parseRoomZoneKey(JOPLIN);
    expect(wallKeyHeight(["137", "138.2"], key, JOPLIN_ZONES)).toEqual({ zone: "CENTRAL", feet: 16.667 });
    expect(wallKeyHeight(["137", null], key, JOPLIN_ZONES)?.feet).toBe(16.667);
    expect(wallKeyHeight(["126", "137"], key, JOPLIN_ZONES), "between LOWER and CENTRAL").toBeNull();
    expect(wallKeyHeight(["101", null], key, JOPLIN_ZONES), "a can't-tell room only").toBeNull();
    expect(wallKeyHeight([null, null], key, JOPLIN_ZONES)).toBeNull();
  });

  // The real keys, with ZONE_KEY_DIR naming the folder that holds them: every row of each is read (sizes from the files).
  const dir = process.env.ZONE_KEY_DIR ?? "";
  it.skipIf(dir === "" || !existsSync(`${dir}/joplin-room-parts-key.md`))("read the real keys whole", () => {
    const read = (n: string) => parseRoomZoneKey(readFileSync(`${dir}/${n}-room-parts-key.md`, "utf8"));
    const rows = (n: string) => readFileSync(`${dir}/${n}-room-parts-key.md`, "utf8").split("\n").filter((l) => /^[A-Z]?\d+(?:\.\d+)?[A-Z]? \|/i.test(l) && !/can'?t tell/i.test(l.split("|")[2] ?? "")).length;
    for (const n of ["joplin", "bunkie", "sw"]) expect(read(n).size, n).toBe(rows(n));
    expect(read("sw").get("102")?.feet, "Diego's ruling: 13'-6\"").toBe(13.5);
  });
});

describe("needsAnswer and noBoard types (Diego's H4/H5, 2026-11-19)", () => {
  const base = { sheet: "A1", sideRoomNumbers: [], zoneKey: null, defaultFeet: 9 } as const;

  it("a needs-answer type prices NO board and says so, instead of the 9' default", () => {
    // H4: "to deck" with no printed deck elevation — 114026 A1A's shape. The
    // old behaviour (no entry at all) priced it at the default and fed the
    // $1.21M board-gap cause; the flag routes its LF to its own line.
    const types = loadKeyTypes({ A1A: { needsAnswer: true, basis: "to deck, no printed elevation" } });
    expect(keyWallFeet({ ...base, code: "a1a", types })).toEqual({ feet: 0, from: "needs-answer" });
  });

  it("a no-board type prices NO board ever (bare CMU)", () => {
    const types = loadKeyTypes({ M8: { noBoard: true, basis: "8\" CMU, no gypsum" } });
    expect(keyWallFeet({ ...base, code: "M8", types })).toEqual({ feet: 0, from: "no-board" });
  });

  it("the flags outrank a stale scalar from an older revision", () => {
    const types = loadKeyTypes({ MC: { feet: 12, needsAnswer: true } });
    expect(keyWallFeet({ ...base, code: "MC", types }).from).toBe("needs-answer");
  });

  it("an unflagged type still prices at its scalar, and a missing one at the default", () => {
    const types = loadKeyTypes({ P13: { feet: 9.09375, basis: "subtracted from printed elevations (H1)" } });
    expect(keyWallFeet({ ...base, code: "P13", types })).toEqual({ feet: 9.09375, from: "scalar" });
    expect(keyWallFeet({ ...base, code: "ZZ", types }).from).toBe("default");
  });
});
