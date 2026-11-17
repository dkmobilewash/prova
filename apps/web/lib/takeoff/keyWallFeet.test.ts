import { describe, expect, it } from "vitest";
import { keyWallFeet, loadKeyTypes, parseRoomZoneKey, type HeightsKeyType } from "./roomZoneKey";

/**
 * ── THE KEY'S PRICE FOR ONE KEY WALL (zero-touch key side, Diego 2026-11-17) ──
 * Fixtures are the three real shapes: Hutto's sheet zones (levels), Joplin's room zones through a
 * zone key, and the r16 scalar/sameAs/excluded entries. The arm ORDER is load-bearing: sheet zone,
 * room zone, scalar, default — Joplin K prices 9 ft except where its zone names the room.
 */

const HUTTO: Record<string, HeightsKeyType> = loadKeyTypes({
  A: { zones: [{ zone: "L1", kind: "sheet", sheets: ["A101"], feet: 12.156 }, { zone: "L2/L3", kind: "sheet", sheets: ["A102"], feet: 10.156 }] },
  D: { sameAs: "A" },
  H: { excluded: true },
});
const JOPLIN: Record<string, HeightsKeyType> = loadKeyTypes({
  A: { zones: [{ zone: "lower roofs", kind: "room", feet: 12 }, { zone: "central", kind: "room", feet: 16.667 }] },
  K: { feet: 9, zones: [{ zone: "rooms with other ceilings", kind: "room", feet: [10, 12.25] }] },
});
const ZONEKEY = parseRoomZoneKey("101 | Resident | LOWER | from roof plan\n138.2 | Hall | CENTRAL | clerestory\n140 | Lobby | can't tell | -");
const D = { defaultFeet: 9, sideRoomNumbers: [], zoneKey: null } as const;

describe("keyWallFeet", () => {
  it("prices by the SHEET zone, and the spelling join reaches it (D6 -> D -> sameAs A -> A101's level)", () => {
    expect(keyWallFeet({ ...D, code: "D6", types: HUTTO, sheet: "A101" })).toEqual({ feet: 12.156, from: "sheet-zone" });
    expect(keyWallFeet({ ...D, code: "D6", types: HUTTO, sheet: "A102" })).toEqual({ feet: 10.156, from: "sheet-zone" });
    // a sheet the zones do not name is unresolved, not silently scalar
    expect(keyWallFeet({ ...D, code: "A", types: HUTTO, sheet: "A103" }).from).toBe("zone-unresolved");
  });
  it("prices by the ROOM zone through the zone key, null where rooms disagree or are unkeyed", () => {
    expect(keyWallFeet({ ...D, code: "A", types: JOPLIN, sheet: "A-101", sideRoomNumbers: ["101", null], zoneKey: ZONEKEY }))
      .toEqual({ feet: 12, from: "room-zone" });
    // two sides in two zones: not scored against a guess
    expect(keyWallFeet({ ...D, code: "A", types: JOPLIN, sheet: "A-101", sideRoomNumbers: ["101", "138.2"], zoneKey: ZONEKEY }).from).toBe("zone-unresolved");
    // "can't tell" room resolves nothing
    expect(keyWallFeet({ ...D, code: "A", types: JOPLIN, sheet: "A-101", sideRoomNumbers: ["140"], zoneKey: ZONEKEY }).from).toBe("zone-unresolved");
  });
  it("falls from an unresolvable zone to the type's own scalar (Joplin K: zone feet is an ARRAY, so 9 ft)", () => {
    expect(keyWallFeet({ ...D, code: "K", types: JOPLIN, sheet: "A-101", sideRoomNumbers: ["101"], zoneKey: ZONEKEY }))
      .toEqual({ feet: 9, from: "scalar" });
  });
  it("excluded and unknown types price at the default and say so", () => {
    expect(keyWallFeet({ ...D, code: "H", types: HUTTO, sheet: "A101" }).from).toBe("default");
    expect(keyWallFeet({ ...D, code: "ZZ9", types: HUTTO, sheet: "A101" }).from).toBe("default");
  });
  it("is case-insensitive the way the flat loader was (PS3b in the key, PS3B on the plan)", () => {
    const usu = loadKeyTypes({ PS3b: { feet: 11 } } as Record<string, HeightsKeyType>);
    expect(keyWallFeet({ ...D, code: "PS3B", types: usu, sheet: "A121" })).toEqual({ feet: 11, from: "scalar" });
  });
  it("materializes sameAs chains to 5 hops at load (IW-5 -> IW-4 -> IW-1)", () => {
    const gb = loadKeyTypes({ "IW-1": { feet: 10.5 }, "IW-4": { sameAs: "IW-1" }, "IW-5": { sameAs: "IW-4" } } as Record<string, HeightsKeyType>);
    expect(keyWallFeet({ ...D, code: "IW-5", types: gb, sheet: "A3.2" })).toEqual({ feet: 10.5, from: "scalar" });
  });
});
