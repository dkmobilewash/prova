import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { describe, expect, it } from "vitest";
import { keyWallFeet, keyTypeFor, loadKeyTypes, parseRoomZoneKey, wallKeyHeight, type HeightsKeyType } from "../roomZoneKey";
import { sheetRooms } from "../sheetRooms";
import { wallSideRooms } from "../wallSides";

/**
 * ── KEY-SIDE ZONED PRICING: THE 3-SHEET PARITY (Diego 2026-11-17) ──
 *
 * Run once per change to the key side, with:
 *   TAKEOFF_LABEL_DIR=<snapshot> ZT_HEIGHTS=<heights key json> KZ_JOPLIN_ZONE_KEY=<md>
 * Three sheets, three arms:
 *   - Hutto A101 and A102 (answer-key-only reads): every join-resolvable typed key wall must price
 *     from the SHEET zone at exactly its level's feet (12.156 / 10.156), none from a room zone.
 *   - Joplin A-101: every zoned key wall must price IDENTICALLY through `keyWallFeet` and through
 *     the zzZonedHeights-style direct path (sheetRooms over the labelled walls, the product's own
 *     side probe, `wallKeyHeight`) — the glue is what this parity pins; the functions are shared.
 * The Joplin arm reads the real page text and strokes (KZ_JOPLIN_PDF, page 46): room TAGS come
 * from the page text, and without them every side room is null and the parity is vacuous — the
 * final assert fails on exactly that, per the vacuous-green discipline.
 */
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const HEIGHTS = process.env.ZT_HEIGHTS ?? "";
const JOPLIN_ZONE = process.env.KZ_JOPLIN_ZONE_KEY ?? "";
const JOPLIN_PDF = process.env.KZ_JOPLIN_PDF ?? "";

type Label = { sheet?: string; feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string; wallType?: string }[]; traced?: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; wallType?: string }[] };
const load = (set: string, sheet: string) => JSON.parse(readFileSync(join(LABELS, set, `${sheet}.json`), "utf8")) as Label;
const typedWalls = (l: Label) => [
  ...l.verdicts.filter((v) => v.verdict === "wall" && v.wallType),
  ...(l.traced ?? []).filter((t) => t.wallType).map((t) => ({ ...t, thicknessFeet: 0.5 })),
];

describe.skipIf(LABELS === "" || HEIGHTS === "" || JOPLIN_ZONE === "" || JOPLIN_PDF === "")("key-side zoned pricing parity (3 sheets)", () => {
  const hk = () => JSON.parse(readFileSync(HEIGHTS, "utf8")) as { sets: Record<string, { labelSet: string; types: Record<string, HeightsKeyType> }> };

  it("Hutto A101/A102: every join-resolvable typed key wall prices from its sheet's level", () => {
    const set = Object.values(hk().sets).find((s) => s.labelSet.includes("Hutto"))!;
    const types = loadKeyTypes(set.types);
    for (const [sheet, want] of [["A101", 12.156], ["A102", 10.156]] as const) {
      const walls = typedWalls(load(set.labelSet, sheet));
      expect(walls.length).toBeGreaterThan(20); // the set the parity is about, not an empty read
      let zoned = 0, defaulted = 0;
      for (const w of walls) {
        const r = keyWallFeet({ code: w.wallType!.toUpperCase(), types, sheet, sideRoomNumbers: [], zoneKey: null, defaultFeet: 9 });
        expect(r.from === "sheet-zone" || r.from === "default").toBe(true);
        if (r.from === "sheet-zone") { expect(r.feet).toBe(want); zoned += 1; } else defaulted += 1;
      }
      expect(zoned).toBeGreaterThan(0);
      console.log(`KZ PARITY Hutto ${sheet}: sheet-zone ${zoned} walls @ ${want} ft · default ${defaulted}`);
    }
  });

  it("Joplin A-101: keyWallFeet equals the zzZonedHeights-style direct path, wall for wall", { timeout: 600_000 }, async () => {
    const set = Object.values(hk().sets).find((s) => s.labelSet.includes("Joplin"))!;
    const types = loadKeyTypes(set.types);
    const zoneKey = parseRoomZoneKey(readFileSync(JOPLIN_ZONE, "utf8"));
    const label = load(set.labelSet, "A-101");
    const walls = typedWalls(label);
    const doc = await openPlanPdf(Buffer.from(readFileSync(JOPLIN_PDF)));
    const text = await doc.pageText(46);
    const strokes = await doc.pageStrokes(46);
    await doc.close();
    const W = text.widthPt;
    const segments = strokes.segments.map((g) => ({ ...g, x1: g.x1 / W, y1: g.y1 / W, x2: g.x2 / W, y2: g.y2 / W }));
    const found = sheetRooms({ pairings: [], runs: walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })) as never, drawn: [], segments, doorLeaves: [], feetPerUnit: label.feetPerUnit, text: text.items, widthPt: W });
    expect(found.rooms.length).toBeGreaterThan(5);
    let agree = 0, resolved = 0;
    for (const w of walls) {
      const hit = keyTypeFor(types, w.wallType!.toUpperCase());
      const zones = (hit?.[1].zones ?? []).filter((z) => z.kind !== "sheet");
      if (hit === null || hit[1].excluded || zones.length === 0) continue;
      const sideRooms = wallSideRooms({ xs: [w.x1, w.x2], ys: [w.y1, w.y2] }, found.rooms).map((r) => r?.tag?.number ?? null);
      const direct = wallKeyHeight(sideRooms, zoneKey, zones);
      const mine = keyWallFeet({ code: w.wallType!.toUpperCase(), types, sheet: "A-101", sideRoomNumbers: sideRooms, zoneKey, defaultFeet: 9 });
      if (direct === null) expect(mine.from).not.toBe("room-zone");
      else { expect(mine).toEqual({ feet: direct.feet, from: "room-zone" }); resolved += 1; }
      agree += 1;
    }
    expect(agree).toBeGreaterThan(10);
    console.log(`KZ PARITY Joplin A-101: zoned walls compared ${agree} · room-zone resolved ${resolved}`);
    expect(resolved).toBeGreaterThan(0); // rooms without text would make this vacuous — see note below
  });
});
