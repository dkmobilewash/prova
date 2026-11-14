import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { CEILING_PAGE_TITLE } from "../../plan-ingest/rooms";
import { tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { heldOutReason } from "../heldOutSets";
import { setFigures, setHeightRule, wallHeightByCode, wallHeightChain, type WallHeightConvention } from "../heightsByCode";
import { levelHeight, planLevels } from "../levelHeights";
import { ceilingsForRooms, type CeilingPageText } from "../roomCeilings";
import { roofPartsFor } from "../roofPartsRead";
import { roomPitched } from "../roofParts";
import { keyTypeFor, parseRoomZoneKey, wallKeyHeight, type HeightsKeyType } from "../roomZoneKey";
import { setHeightFacts } from "../setHeightFacts";
import { sheetRooms } from "../sheetRooms";
import { wallSideRooms } from "../wallSides";

/**
 * ── ZONED HEIGHTS, WALL BY WALL: EACH WALL'S ROOMS, ITS ZONE'S HEIGHT, AND THE CHAIN'S (training) ──
 *
 * The sets whose walls go to different heights by zone (Joplin's roof parts, Bunkie's buildings, SW's
 * areas) cannot be scored one height per type. Here every labelled wall of a ZONED key type gets:
 *   - its rooms: rooms closed from the LABELLED walls (`sheetRooms`, as zzHeightsByCode, so wall
 *     finding is not what is measured), found by the PRODUCT's own side probe (`wallSideRooms`);
 *   - the KEY's height: its rooms' zone, from the zone keys (`roomZoneKey.ts`, ZH_ZONE_KEYS
 *     "Joplin=<md>,Bunkie=<md>,SW=<md>"), a height-less zone through the heights key's zones;
 *     a wall between two zones, or beside no keyed room, carries none;
 *   - the CHAIN's height through those rooms, exactly as `assignWallHeights` computes it: the rooms'
 *     ceilings (`ceilingsForRooms` over the set's ceiling plans), the roof over each under a
 *     to-structure-by-roof rule (`roofPartsFor`, `roomPitched`), the company answer ZH_CONVENTION
 *     (default TO_STRUCTURE, ZH_FIXED_FT 10), and the drawn level alone beside it.
 * One JSON row per wall to ZH_OUT (the heights fix (b) is measured on these). Held-out never read.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const KEY = process.env.HEIGHTS_KEY ?? "";
const OUT = process.env.ZH_OUT ?? "";
const ZONE_KEYS = new Map((process.env.ZH_ZONE_KEYS ?? "").split(",").filter((p) => p.includes("=")).map((p) => p.split("=") as [string, string]));
const ANSWER = { convention: (process.env.ZH_CONVENTION ?? "TO_STRUCTURE") as WallHeightConvention, fixedFt: Number(process.env.ZH_FIXED_FT ?? "10") };

type KeyType = HeightsKeyType;
type Label = { page: number; sheet: string; feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string; wallType?: string }[]; traced?: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; wallType?: string }[] };
const flat = (n: string) => n.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(labelSet: string): string | null {
  for (const root of [DIR, join(DIR, "new"), join(DIR, "incoming")]) {
    if (!existsSync(root)) continue;
    const hit = readdirSync(root).find((n) => n.toLowerCase().endsWith(".pdf") && flat(n) === flat(labelSet));
    if (hit !== undefined) return join(root, hit);
  }
  return null;
}

describe.skipIf(DIR === "" || LABELS === "" || KEY === "" || OUT === "" || ZONE_KEYS.size === 0)("zoned heights, wall by wall", () => {
  it("writes each zoned wall's rooms, its key height and the chain's height", { timeout: 3_600_000 }, async () => {
    const heights = JSON.parse(readFileSync(KEY, "utf8")) as { sets: Record<string, { heldOut: boolean; labelSet: string; types: Record<string, KeyType> }> };
    const written: string[] = [];
    for (const [setName, zoneKeyPath] of ZONE_KEYS) {
      const set = heights.sets[setName];
      if (set === undefined) throw new Error(`${setName}: not in the heights key`);
      if (set.heldOut || heldOutReason(set.labelSet) !== null) continue;
      const zoneKey = parseRoomZoneKey(readFileSync(zoneKeyPath, "utf8"));
      const pdf = findPdf(set.labelSet);
      const labelDir = join(LABELS, set.labelSet);
      if (pdf === null || !existsSync(labelDir)) throw new Error(`${setName}: ${pdf === null ? "no pdf" : "no labels"}`);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      try {
        const facts = await setHeightFacts(doc, { legendPage: 0, maxPages: 120 });
        const rule = setHeightRule(facts.generalNote, facts.facts);
        const roofs = rule?.kind === "to-structure-by-roof" ? await roofPartsFor(doc, facts) : new Map();
        const ceilingPages: CeilingPageText[] = [];
        for (let n = 1; n <= Math.min(doc.pageCount, 160) && ceilingPages.length < 40; n += 1) {
          const page = await doc.pageText(n).catch(() => null);
          if (!page || !CEILING_PAGE_TITLE.test(page.items.map((i) => i.str).join(" "))) continue;
          const strokes = await doc.pageStrokes(n).catch(() => null);
          ceilingPages.push({ pageNumber: n, items: page.items, widthPt: page.widthPt, tableRows: tableRowsFromPage(page), strokes: strokes?.segments.map((s) => ({ x1: s.x1 / strokes.widthPt, y1: s.y1 / strokes.widthPt, x2: s.x2 / strokes.widthPt, y2: s.y2 / strokes.widthPt })) });
        }
        for (const file of readdirSync(labelDir).filter((f) => f.endsWith(".json"))) {
          const label = JSON.parse(readFileSync(join(labelDir, file), "utf8")) as Label;
          const walls = [
            ...label.verdicts.filter((v) => v.verdict === "wall" && v.wallType),
            ...(label.traced ?? []).filter((t) => t.wallType).map((t) => ({ ...t, thicknessFeet: 0.5, verdict: "wall" })),
          ];
          // Only the ZONED key types: a single-height type is scored by the type (zzHeightChain), not by its room.
          const zoned = walls.flatMap((w) => {
            const k = keyTypeFor(set.types, w.wallType!);
            return k && !k[1].excluded && (k[1].zones ?? []).length > 0 ? [{ w, code: k[0], k: k[1] }] : [];
          });
          if (zoned.length === 0) continue;
          const text = await doc.pageText(label.page);
          const strokes = await doc.pageStrokes(label.page);
          const W = text.widthPt;
          const segments = strokes.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
          const found = sheetRooms({ pairings: [], runs: walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })) as never, drawn: [], segments, doorLeaves: [], feetPerUnit: label.feetPerUnit, text: text.items, widthPt: W });
          const current: CeilingPageText = { pageNumber: label.page, items: text.items, widthPt: W, tableRows: tableRowsFromPage(text) };
          const ceilings = ceilingsForRooms({ rooms: found.rooms, current, feetPerUnit: label.feetPerUnit, others: ceilingPages.filter((p) => p.pageNumber !== label.page) });
          const levels = text.items.map((i) => planLevels(i.str)).find((l) => l.length > 0) ?? [];
          const figures = setFigures(facts.facts, levelHeight(facts.levels ?? [], levels)?.feet ?? null);
          const roof = roofs.get(label.page);
          for (const { w, code, k } of zoned) {
            const rooms = wallSideRooms({ xs: [w.x1, w.x2], ys: [w.y1, w.y2] }, found.rooms);
            const sides = rooms.map((r) => (r === null ? null : (ceilings.get(r.id)?.heightFeet ?? null)));
            const pitched = rooms.map((r) => (r && roof ? roomPitched(roof.mask, { xs: r.xs, ys: r.ys, named: r.tag !== null }) : null));
            const sideRooms = rooms.map((r) => r?.tag?.number ?? null);
            const want = wallKeyHeight(sideRooms, zoneKey, (k.zones ?? []) as { zone: string; feet: unknown }[]);
            const chain = wallHeightChain(rule, sides, pitched, ANSWER, figures);
            const drawn = wallHeightByCode(rule, sides, pitched);
            appendFileSync(OUT, JSON.stringify({
              set: setName, sheet: label.sheet ?? file.slice(0, -5), type: code, ft: +w.lengthFeet.toFixed(2),
              sideRooms, sidesCeilingFt: sides, sidesPitched: pitched,
              keyZone: want?.zone ?? null, keyFeet: want?.feet ?? null,
              chainFeet: chain?.feet ?? null, chainFrom: chain?.from ?? null, chainAssumed: chain?.assumed ?? null,
              drawnFeet: drawn?.feet ?? null,
              rule: rule?.kind ?? null,
            }) + "\n");
            written.push(`${setName}|${code}`);
          }
        }
      } finally {
        await doc.close();
      }
    }
    // The zone keys named something on disk: no rows means a mistyped path or set, not a clean measurement.
    expect(written.length).toBeGreaterThan(0);
  });
});
