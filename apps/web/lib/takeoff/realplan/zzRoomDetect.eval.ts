import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { printedScalesOnPage } from "../printedScales";
import { readSheetScale } from "../scaleFromDimensions";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { feetPerUnitFrom } from "../sheetScale";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { roomsFromWalls, type FoundWall, type RoomFromWalls } from "../roomsFromWalls";
import { sheetStrokes } from "../sheetStrokes";
import { roomSeals } from "../roomSeals";

/**
 * ── DOOR SEALS FROM THE SWING SYMBOLS (ROOM_DOOR_SEALS=1) ──
 * The doors read off the sheet's own swings (`doorWindowSymbols.ts`), each
 * as the leaf's line hinge → strike, in page-width units, drawn as ink by
 * `roomsFromWalls` so the doorway closes where the door is. Every arm below
 * scores the same wall set twice when this is on — as before, and with the
 * seals — so the two lines beside each other ARE the before/after.
 */
const DOOR_SEALS = process.env.ROOM_DOOR_SEALS === "1";
/** Only sets whose file name contains this (case-insensitive), when given. */
const ONLY = (process.env.ROOM_ONLY ?? "").toLowerCase();
async function doorSealsFor(pdf: string, page: number, feetPerUnit: number, walls: readonly FoundWall[]): Promise<{ x1: number; y1: number; x2: number; y2: number }[]> {
  const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
  const w = read.widthPt;
  const segs = read.segments.map((seg) => ({ ...seg, x1: seg.x1 / w, y1: seg.y1 / w, x2: seg.x2 / w, y2: seg.y2 / w }));
  return roomSeals(walls, segs, feetPerUnit);
}

/**
 * ── AREA ERROR PER ROOM, AGAINST THE KEYS ──
 *
 * Two arms, because they answer different questions:
 *
 *   labels   walls = the reviewer's ACCEPTED candidates + TRACES from the
 *            label files, on the three training sheets whose set prints
 *            room areas (`zzRoomKeys.eval.ts`). This is what the product
 *            would do with a reviewed sheet.
 *   bim      walls = the BIM key's own centrelines, on the 18 r1-section
 *            sheets. Perfect walls, so this isolates the ROOM step: a
 *            miss here is mine, not the finder's.
 *
 * And, from the rewritten queue (2026-10-21 evening), a BOUNDARY variant of
 * each: a room is bounded by every wall there is, not only the sub's, so the
 * walls are the finder's RAW candidates — every pairing `onCandidate` sees,
 * before triage and before the reviewer judged scope — plus the accepted and
 * traced ones. On the BIM sheets that is the finder end to end, with no help
 * from the key.
 *
 * Each detected room is named by the tag inside it; the tag's number (or
 * name, where the set prints no numbers) joins it to the key, and the error
 * is |detected − key| / key. Tags on no closed region are counted as
 * MISSED, because a detector is judged by what it misses.
 *
 * Prints counts, numbers and percentages; never a room name from a real set.
 *
 *     REAL_PLAN_DIR=…/real-plans/new TAKEOFF_LABEL_DIR=…/labels \
 *     BIM_DIR=…/bim-sheets ROOM_KEYS=…/answer-keys/rooms ROOM_DETECT_OUT=… \
 *       pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzRoomDetect
 */
const REAL = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const BIM = process.env.BIM_DIR ?? "";
const KEYS = process.env.ROOM_KEYS ?? "";
const OUT = process.env.ROOM_DETECT_OUT ?? "";

type Key = { rooms: { name: string; number: string | null; areaSf: number | null; at: { x: number; y: number } | null }[] };
type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number; verdict: string }[];
  traced: { x1: number; y1: number; x2: number; y2: number }[];
};

/** Labelled sheet → the key that prints its rooms' areas, and how to join. */
const LABELLED: { set: string; sheet: string; keys: string[]; join: "number" | "name" }[] = [
  { set: "BUNKIE-BID-DRAWINGS.pdf", sheet: "A100", keys: ["printed/BUNKIE-BID-DRAWINGS__p32.json"], join: "number" },
  { set: "BUNKIE-BID-DRAWINGS.pdf", sheet: "A104", keys: ["printed/BUNKIE-BID-DRAWINGS__p35.json", "printed/BUNKIE-BID-DRAWINGS__p46.json"], join: "number" },
  { set: "2025.07.08_Baker_EOC_BID.pdf", sheet: "A101", keys: ["printed/2025.07.08_Baker_EOC_BID__p4.json"], join: "name" },
  { set: "SW-Grand-Junction-CO.pdf", sheet: "A110", keys: ["printed/SW-Grand-Junction-CO__p43.json"], join: "number" },
];

/** Several key files, one room per number (a finish-schedule page repeats a toilet per elevation). */
function loadKeys(paths: string[]): Key | null {
  const rooms: Key["rooms"] = [];
  for (const p of paths) {
    if (!existsSync(p)) return null;
    for (const r of (JSON.parse(readFileSync(p, "utf8")) as Key).rooms) {
      if (r.number && rooms.some((k) => k.number === r.number)) continue;
      rooms.push(r);
    }
  }
  return { rooms };
}

/**
 * The finder's raw candidates: every pairing `onCandidate` sees, pre-triage,
 * minus the ones shorter than `RAW_MIN_FEET`. Measured on Bunkie A100
 * (2026-10-21): 39,952 raw pairings, 90% of them 0.67 ft — the existing
 * building's hatch, paired line by line. Those fill the hatched area with ink
 * and bound nothing; the walls that matter are the long pairs.
 */
const RAW_MIN_FEET = 2;
/**
 * THE HATCHED WALLS, from the app's own triage (2026-10-22). `offeredCandidates`
 * with the original session's `hatchPitchRule` on classifies every unclaimed
 * single line; the ones it OFFERS (`from: "single"`, kind unclassified) include
 * the walls drawn as an evenly-pitched fill between two faces — poché, masonry,
 * rated walls — which the pairer never pairs and the old triage hid as
 * "in-a-hatch". A single line has no thickness; it is drawn at the default.
 */
async function hatchedSingles(pdf: string, page: number, feetPerUnit: number): Promise<FoundWall[]> {
  const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const text = await doc.pageText(page);
  await doc.close();
  const detected = detectForSheet({
    segments: read.segments,
    textItems: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })),
    pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
    feetPerUnit,
  });
  const offered = offeredCandidates(
    { walls: detected.found.walls, segments: read.segments, widthPt: read.widthPt, feetPerUnit, planBoxes: detected.planBoxes },
    false,
    true,
  );
  // INSIDE THE BUILDING ONLY. Measured on Joplin A-101 (2026-10-22): the
  // offered singles included the column grid and the dimension strings, which
  // run from margin to margin and cut the plan into a lattice — 194 "rooms"
  // where there are 74. A wall ends at the building; a grid line does not. So
  // a single must start and end within the paired walls' extent plus a wall's
  // worth of slack.
  const pairs = detected.found.walls;
  if (pairs.length === 0) return [];
  const slack = 3 / feetPerUnit;
  const minX = Math.min(...pairs.flatMap((w) => [w.x1, w.x2])) - slack;
  const maxX = Math.max(...pairs.flatMap((w) => [w.x1, w.x2])) + slack;
  const minY = Math.min(...pairs.flatMap((w) => [w.y1, w.y2])) - slack;
  const maxY = Math.max(...pairs.flatMap((w) => [w.y1, w.y2])) + slack;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  return offered.candidates
    .filter((c) => c.from === "single" && inside(c.x1, c.y1) && inside(c.x2, c.y2))
    .map((c) => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 }));
}

/** The sheet's strokes in page-width units, for `bridgingLines`; only with ROOM_BRIDGE=1. */
async function strokesInUnits(pdf: string, page: number): Promise<{ x1: number; y1: number; x2: number; y2: number }[] | undefined> {
  if (process.env.ROOM_BRIDGE !== "1") return undefined;
  const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
  const w = read.widthPt;
  return read.segments.map((seg) => ({ x1: seg.x1 / w, y1: seg.y1 / w, x2: seg.x2 / w, y2: seg.y2 / w }));
}

async function rawCandidates(pdf: string, page: number, feetPerUnit: number): Promise<{ walls: FoundWall[]; strokes: number }> {
  // Fresh bytes for each reader: `openPlanPdf` hands pdfjs a VIEW and pdfjs
  // detaches the buffer behind it (planPdf.ts says so), so a Buffer that has
  // been through it once throws on the next use.
  const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const text = await doc.pageText(page);
  await doc.close();
  const walls: FoundWall[] = [];
  findWallsOnSheet({
    segments: read.segments,
    textItems: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })),
    pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
    feetPerUnit,
    wallTypes: [],
    sampledSheets: null,
    onCandidate: (_features, w) => {
      if (w.lengthFeet >= RAW_MIN_FEET) walls.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet });
    },
  });
  return { walls, strokes: read.segments.length };
}

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();

/** `keySf` null = a tags-only key: the room's existence and place are known, its size is not. */
type Row = { id: string; keySf: number | null; gotSf: number | null; why?: "OPEN" | "MERGED" | "MERGED-NO-WALL" };

function score(
  title: string,
  rooms: RoomFromWalls[],
  unplaced: { name: string; number: string | null }[],
  merged: { name: string; number: string | null; x: number; y: number }[],
  key: Key,
  join: "number" | "name",
  /** When the key knows its walls: a merged pair with NO wall between the two
   *  tags is one physical space the model split with a virtual boundary, which
   *  no wall-based detector can separate. Reported apart from a real leak. */
  keyWalls: FoundWall[] = [],
): Row[] {
  const keyOf = (t: { name: string; number: string | null }) =>
    key.rooms.find((k) => (join === "number" ? norm(k.number) === norm(t.number) && t.number : norm(k.name) === norm(t.name)));
  const rows: Row[] = [];
  const seen = new Set<Key["rooms"][number]>();
  for (const room of rooms) {
    if (!room.tag) continue;
    const k = keyOf(room.tag);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rows.push({ id: k.number ?? `#${key.rooms.indexOf(k)}`, keySf: k.areaSf, gotSf: room.squareFeet });
  }
  // A key room with no name and no number (an area printed inside the room,
  // nothing over it) joins by POSITION: the detected room whose polygon holds
  // its point. Inside no closed room = open.
  const inside = (p: { x: number; y: number }, r: RoomFromWalls) => {
    let hit = false;
    for (let i = 0, j = r.xs.length - 1; i < r.xs.length; j = i, i += 1) {
      const yi = r.ys[i], yj = r.ys[j], xi = r.xs[i], xj = r.xs[j];
      if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (const k of key.rooms) {
    if (seen.has(k) || k.name !== "" || k.number !== null || k.at === null) continue;
    seen.add(k);
    const room = rooms.find((r) => inside(k.at as { x: number; y: number }, r));
    rows.push({ id: `@${(k.at.x * 100).toFixed(0)},${(k.at.y * 100).toFixed(0)}`, keySf: k.areaSf, gotSf: room ? room.squareFeet : null, why: room ? undefined : "OPEN" });
  }
  for (const t of unplaced) {
    const k = keyOf(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    rows.push({ id: k.number ?? `#${key.rooms.indexOf(k)}`, keySf: k.areaSf, gotSf: null, why: "OPEN" });
  }
  const crosses = (p: { x: number; y: number }, q: { x: number; y: number }, w: FoundWall) => {
    const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
    return (
      ccw(p.x, p.y, w.x1, w.y1, w.x2, w.y2) !== ccw(q.x, q.y, w.x1, w.y1, w.x2, w.y2) &&
      ccw(p.x, p.y, q.x, q.y, w.x1, w.y1) !== ccw(p.x, p.y, q.x, q.y, w.x2, w.y2)
    );
  };
  for (const t of merged) {
    const k = keyOf(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    // the nearest other merged tag is its partner in the shared region
    const partner = merged.filter((u) => u !== t).sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
    const wallBetween = partner ? keyWalls.some((w) => crosses(t, partner, w)) : true;
    rows.push({ id: k.number ?? `#${key.rooms.indexOf(k)}`, keySf: k.areaSf, gotSf: null, why: keyWalls.length && !wallBetween ? "MERGED-NO-WALL" : "MERGED" });
  }
  const errs = rows.filter((r) => r.gotSf !== null && r.keySf !== null).map((r) => Math.abs((r.gotSf as number) - (r.keySf as number)) / (r.keySf as number));
  errs.sort((a, b) => a - b);
  const median = errs.length ? errs[Math.floor(errs.length / 2)] : null;
  const within10 = errs.filter((e) => e <= 0.1).length;
  const signed = rows.filter((r) => r.gotSf !== null && r.keySf !== null).map((r) => ((r.gotSf as number) - (r.keySf as number)) / (r.keySf as number));
  const closedNoSize = rows.filter((r) => r.gotSf !== null && r.keySf === null).length;
  const mean = signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : null;
  console.log(
    `${title}: ${rooms.length} regions, ${rooms.filter((r) => r.tag).length} tagged, ${unplaced.length} tags open, ${merged.length} merged; ` +
      `key rooms ${key.rooms.length}, joined ${rows.length}, measured ${errs.length}${closedNoSize ? ` (+${closedNoSize} closed, size unknown)` : ""}, within 5%: ${errs.filter((e) => e <= 0.05).length}, within 10%: ${within10}, ` +
      `median |err| ${median === null ? "—" : (median * 100).toFixed(1) + "%"}, mean signed ${mean === null ? "—" : (mean * 100).toFixed(1) + "%"}`,
  );
  for (const r of rows) {
    if (r.gotSf !== null && (r.keySf === null || Math.abs(r.gotSf - r.keySf) / r.keySf <= 0.1)) continue;
    console.log(
      `    ${r.id.padEnd(7)} key ${r.keySf === null ? "     ?" : r.keySf.toFixed(0).padStart(6)} sf  got ${r.gotSf === null ? `  ${r.why}` : r.gotSf.toFixed(0).padStart(8)}` +
        (r.gotSf === null || r.keySf === null ? "" : `  ${(((r.gotSf - r.keySf) / r.keySf) * 100).toFixed(1).padStart(7)}%`),
    );
  }
  return rows;
}

function dump(name: string, result: ReturnType<typeof roomsFromWalls>, extra: object) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ ...extra, ...result }, null, 1));
}

/**
 * Training pages with NO label file (2026-10-22 sets): the scale is read off
 * the page's own dimension strings (`readSheetScale`, the product's path), the
 * boundary is the finder's raw pairings alone, and the key is whatever the
 * page prints — areas inside the rooms (Camp Clark) or tags with no area.
 */
const UNLABELLED: { set: string; page: number; key: string; join: "number" | "name"; agreedFeetPerInch?: number }[] = [
  { set: "Camp-Clark-60-Soldier-Barracks.pdf", page: 3, key: "printed/Camp-Clark-60-Soldier-Barracks__p3.json", join: "number" },
  // Topeka G-100b: three code plans captioned 1/16" on a 36-inch sheet whose 45
  // printed dimensions AGREE on 1/32" — the plans are half-size reproductions
  // of the floor plans. `readSheetScale` declines because the best line is
  // 0.9% out against its 0.5% rule, so the product would show no scale here.
  // Measured at the dimensions' agreed 1/32" for this report, and said so.
  { set: "Topeka-Senior-Villas.pdf", page: 6, key: "printed/Topeka-Senior-Villas__p6.json", join: "number", agreedFeetPerInch: 32 },
  { set: "Joplin-community-center.pdf", page: 46, key: "printed/Joplin-community-center__p46.json", join: "number" },
  { set: "Joplin-community-center.pdf", page: 47, key: "printed/Joplin-community-center__p47.json", join: "number" },
  { set: "Supreme-Court-of-Missouri-Judiciary-Library.pdf", page: 6, key: "printed/Supreme-Court-of-Missouri-Judiciary-Library__p6.json", join: "number" },
];

describe.skipIf(KEYS === "" || (LABELS === "" && BIM === "" && REAL === ""))("rooms from walls, measured", () => {
  it.skipIf(REAL === "" || KEYS === "" || process.env.ROOM_UNLABELLED !== "1")("unlabelled arm: raw pairings on the new training pages", { timeout: 3_600_000 }, async () => {
    let joined = 0;
    for (const { set, page, key: keyFile, join: how, agreedFeetPerInch } of UNLABELLED) {
      const pdf = join(REAL, set);
      const key = loadKeys([join(KEYS, keyFile)]);
      if (!existsSync(pdf) || !key) {
        console.log(`${set} p${page}: missing ${existsSync(pdf) ? "key" : "set"}`);
        continue;
      }
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(page);
      const strokes = await doc.pageStrokes(page);
      await doc.close();
      const segments = strokes.segments as Parameters<typeof readSheetScale>[1];
      const verdict = readSheetScale(text, segments, dimensionLabels(text), {}, metricDimensionLabels(text));
      let feetPerUnit: number;
      let scaleName: string;
      if (verdict.ok) {
        feetPerUnit = feetPerUnitFrom(verdict.feetPerInch, text.widthPt);
        scaleName = verdict.scaleName;
      } else if (agreedFeetPerInch !== undefined) {
        feetPerUnit = feetPerUnitFrom(agreedFeetPerInch, text.widthPt);
        scaleName = `1/${agreedFeetPerInch}" = 1'-0" (dimensions agree; product declined: ${verdict.reason.slice(0, 60)}…)`;
      } else {
        // The product's other reader: the ONE scale printed on the page, when
        // there is exactly one. Never a hand-set scale (BOARD.md rule 5).
        const printed = scaleFromPrinted(printedScalesOnPage(text.items), text.widthPt, text.heightPt);
        if (!printed) {
          console.log(`${set} p${page}: NO SCALE — dimensions: ${verdict.reason.slice(0, 90)}…; printed: ${printedScalesOnPage(text.items).join(" / ") || "none"} — not measured`);
          continue;
        }
        feetPerUnit = printed.declaredDistanceFeet / Math.abs(printed.x2 - printed.x1);
        scaleName = `${printed.scaleName} (printed)`;
      }
      if (ONLY && !set.toLowerCase().includes(ONLY)) continue;
      const raw = await rawCandidates(pdf, page, feetPerUnit);
      const hatched = process.env.ROOM_HATCH === "1" ? await hatchedSingles(pdf, page, feetPerUnit) : [];
      const walls = [...raw.walls, ...hatched];
      if (DOOR_SEALS) {
        const doorSeals = await doorSealsFor(pdf, page, feetPerUnit, walls);
        const withDoors = roomsFromWalls({ walls, feetPerUnit, text: text.items, widthPt: text.widthPt, doorSeals });
        dump(`boundary-doors__${set.replace(/\.pdf$/, "")}__p${page}`, withDoors, { pdf, set, sheet: `p${page}`, page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit, walls });
        score(`${set} p${page} + ${doorSeals.length} DOOR SEALS`, withDoors.rooms, withDoors.unplacedTags, withDoors.mergedTags, key, how);
      }
      const result = roomsFromWalls({ walls, feetPerUnit, text: text.items, widthPt: text.widthPt, strokes: await strokesInUnits(pdf, page), bridgeSidelights: process.env.ROOM_BRIDGE === "1" });
      dump(`boundary__${set.replace(/\.pdf$/, "")}__p${page}`, result, { pdf, set, sheet: `p${page}`, page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit, walls });
      const rows = score(`${set} p${page} (${scaleName}, ${raw.walls.length} raw candidates >= ${RAW_MIN_FEET} ft${hatched.length ? ` + ${hatched.length} hatched singles` : ""} of ${raw.strokes} strokes)`, result.rooms, result.unplacedTags, result.mergedTags, key, how);
      joined += rows.length;
    }
    expect(UNLABELLED.length).toBeGreaterThan(0);
    expect(joined).toBeGreaterThan(0);
  });

  it.skipIf(REAL === "" || LABELS === "" || KEYS === "")("labels arm: accepted + traced walls", { timeout: 1_800_000 }, async () => {
    const all: Row[] = [];
    for (const { set, sheet, keys, join: how } of LABELLED) {
      const labelPath = join(LABELS, set, `${sheet}.json`);
      const key = loadKeys(keys.map((k) => join(KEYS, k)));
      if (!existsSync(labelPath) || !key) {
        console.log(`${set} ${sheet}: missing ${existsSync(labelPath) ? "key" : "label"}`);
        continue;
      }
      const saved = JSON.parse(readFileSync(labelPath, "utf8")) as Saved;
      const walls: FoundWall[] = [
        ...saved.verdicts.filter((v) => v.verdict === "wall").map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thicknessFeet: v.thicknessFeet })),
        ...(saved.traced ?? []).map((t) => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })),
      ];
      const bytes = Buffer.from(readFileSync(join(REAL, set)));
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      await doc.close();
      if (ONLY && !set.toLowerCase().includes(ONLY)) continue;
      const result = roomsFromWalls({ walls, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt });
      if (DOOR_SEALS) {
        const doorSeals = await doorSealsFor(join(REAL, set), saved.page, saved.feetPerUnit, walls);
        const withDoors = roomsFromWalls({ walls, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt, doorSeals });
        dump(`labels-doors__${set.replace(/\.pdf$/, "")}__${sheet}`, withDoors, { pdf: join(REAL, set), set, sheet, page: saved.page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: saved.feetPerUnit, walls });
        score(`  … + ${doorSeals.length} DOOR SEALS from the swings`, withDoors.rooms, withDoors.unplacedTags, withDoors.mergedTags, key, how);
      }
      dump(`labels__${set.replace(/\.pdf$/, "")}__${sheet}`, result, { pdf: join(REAL, set), set, sheet, page: saved.page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: saved.feetPerUnit, walls });
      all.push(...score(`${set} ${sheet} (${walls.length} accepted+traced walls)`, result.rooms, result.unplacedTags, result.mergedTags, key, how));
      // The same sheet with EVERY candidate the reviewer saw, rejected ones
      // included: if rooms close here and not above, the leak is triage (a real
      // wall judged out); if they leak here too, the finder never drew it.
      const every: FoundWall[] = [
        ...saved.verdicts.map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thicknessFeet: v.thicknessFeet })),
        ...(saved.traced ?? []).map((t) => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })),
      ];
      const loose = roomsFromWalls({ walls: every, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt });
      dump(`labels-all__${set.replace(/\.pdf$/, "")}__${sheet}`, loose, { pdf: join(REAL, set), set, sheet, page: saved.page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: saved.feetPerUnit, walls: every });
      score(`  … same sheet, ALL ${every.length} candidates incl. rejected`, loose.rooms, loose.unplacedTags, loose.mergedTags, key, how);
      // BOUNDARY set: the finder's raw candidates + accepted + traced.
      const raw = await rawCandidates(join(REAL, set), saved.page, saved.feetPerUnit);
      const boundary: FoundWall[] = [...raw.walls, ...every];
      const bounded = roomsFromWalls({ walls: boundary, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt, strokes: await strokesInUnits(join(REAL, set), saved.page), bridgeSidelights: process.env.ROOM_BRIDGE === "1" });
      dump(`boundary__${set.replace(/\.pdf$/, "")}__${sheet}`, bounded, { pdf: join(REAL, set), set, sheet, page: saved.page, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: saved.feetPerUnit, walls: boundary });
      if (DOOR_SEALS) {
        const doorSeals = await doorSealsFor(join(REAL, set), saved.page, saved.feetPerUnit, boundary);
        const withDoors = roomsFromWalls({ walls: boundary, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt, doorSeals });
        score(`  … BOUNDARY + ${doorSeals.length} DOOR SEALS`, withDoors.rooms, withDoors.unplacedTags, withDoors.mergedTags, key, how);
      }
      all.push(...score(`  … BOUNDARY: ${raw.walls.length} raw finder candidates >= ${RAW_MIN_FEET} ft (${raw.strokes} strokes) + all ${every.length} offered`, bounded.rooms, bounded.unplacedTags, bounded.mergedTags, key, how));
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it.skipIf(BIM === "" || KEYS === "")("bim arm: the key's own centrelines", { timeout: 7_200_000 }, async () => {
    const all: Row[] = [];
    const endToEnd: Row[] = [];
    const bimDoors: Row[] = [];
    for (const model of readdirSync(BIM, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const name of readdirSync(join(BIM, model.name)).filter((f) => f.endsWith("r1-section.json")).sort()) {
        const k = JSON.parse(readFileSync(join(BIM, model.name, name), "utf8")) as {
          id: string;
          file: string;
          page_size_pt: [number, number];
          walls: { centerline_pt: [number, number][]; thickness_in: number; curved: boolean }[];
          curtain_walls?: { centerline_pt?: [number, number][] }[];
        };
        const [W, H] = k.page_size_pt;
        const walls: FoundWall[] = [];
        for (const w of k.walls) {
          const pts = w.centerline_pt;
          for (let i = 1; i < pts.length; i += 1) {
            walls.push({ x1: pts[i - 1][0] / W, y1: (H - pts[i - 1][1]) / W, x2: pts[i][0] / W, y2: (H - pts[i][1]) / W, thicknessFeet: w.thickness_in / 12 });
          }
        }
        // A storefront bounds a room as much as a stud wall does: the clinic's
        // waiting area was OPEN until its curtain wall was drawn.
        for (const w of k.curtain_walls ?? []) {
          const pts = w.centerline_pt ?? [];
          for (let i = 1; i < pts.length; i += 1) {
            walls.push({ x1: pts[i - 1][0] / W, y1: (H - pts[i - 1][1]) / W, x2: pts[i][0] / W, y2: (H - pts[i][1]) / W, thicknessFeet: 0.5 });
          }
        }
        const keyPath = join(KEYS, "bim", `${k.id}__p1.json`);
        const key = JSON.parse(readFileSync(keyPath, "utf8")) as Key & { unitsPerFoot: number };
        const doc = await openPlanPdf(Buffer.from(readFileSync(join(BIM, model.name, k.file))));
        const text = await doc.pageText(1);
        await doc.close();
        const result = roomsFromWalls({ walls, feetPerUnit: 1 / key.unitsPerFoot, text: text.items, widthPt: text.widthPt, sealCornerDoors: process.env.ROOM_CORNER === "1", strokes: await strokesInUnits(join(BIM, model.name, k.file), 1), bridgeSidelights: process.env.ROOM_BRIDGE === "1" });
        dump(`bim__${k.id}`, result, { pdf: join(BIM, model.name, k.file), set: k.id, page: 1, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: 1 / key.unitsPerFoot, walls });
        all.push(...score(`${k.id} (${walls.length} wall pieces)`, result.rooms, result.unplacedTags, result.mergedTags, key, "number", walls));
        if (DOOR_SEALS) {
          const doorSeals = await doorSealsFor(join(BIM, model.name, k.file), 1, 1 / key.unitsPerFoot, walls);
          const withDoors = roomsFromWalls({ walls, feetPerUnit: 1 / key.unitsPerFoot, text: text.items, widthPt: text.widthPt, doorSeals });
          bimDoors.push(...score(`  … + ${doorSeals.length} DOOR SEALS`, withDoors.rooms, withDoors.unplacedTags, withDoors.mergedTags, key, "number", walls));
        }
        if (process.env.BIM_END_TO_END === "1") {
          const raw = await rawCandidates(join(BIM, model.name, k.file), 1, 1 / key.unitsPerFoot);
          const e2e = roomsFromWalls({ walls: raw.walls, feetPerUnit: 1 / key.unitsPerFoot, text: text.items, widthPt: text.widthPt });
          dump(`boundary__${k.id}`, e2e, { pdf: join(BIM, model.name, k.file), set: k.id, page: 1, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: 1 / key.unitsPerFoot, walls: raw.walls });
          endToEnd.push(...score(`  … END TO END: ${raw.walls.length} raw finder candidates, no key walls`, e2e.rooms, e2e.unplacedTags, e2e.mergedTags, key, "number", walls));
        }
      }
    }
    const errs = all.filter((r) => r.gotSf !== null && r.keySf !== null).map((r) => Math.abs((r.gotSf as number) - (r.keySf as number)) / (r.keySf as number)).sort((a, b) => a - b);
    console.log(
      `\nBIM TOTAL: ${all.length} key rooms joined, ${errs.length} measured, ${all.filter((r) => r.why === "OPEN").length} open, ${all.filter((r) => r.why === "MERGED").length} merged through a wall (a leak), ${all.filter((r) => r.why === "MERGED-NO-WALL").length} merged with no wall in the model; ` +
        `median ${(errs[Math.floor(errs.length / 2)] * 100).toFixed(1)}%, within 5%: ${errs.filter((e) => e <= 0.05).length}, within 10%: ${errs.filter((e) => e <= 0.1).length}`,
    );
    if (bimDoors.length) {
      const e = bimDoors.filter((r) => r.gotSf !== null && r.keySf !== null).map((r) => Math.abs((r.gotSf as number) - (r.keySf as number)) / (r.keySf as number)).sort((a, b) => a - b);
      console.log(
        `BIM + DOOR SEALS: ${bimDoors.length} key rooms joined, ${e.length} measured, ${bimDoors.filter((r) => r.why === "OPEN").length} open, ${bimDoors.filter((r) => r.why === "MERGED").length} merged through a wall, ${bimDoors.filter((r) => r.why === "MERGED-NO-WALL").length} merged no wall; ` +
          `median ${e.length ? (e[Math.floor(e.length / 2)]! * 100).toFixed(1) : "—"}%, within 5%: ${e.filter((x) => x <= 0.05).length}, within 10%: ${e.filter((x) => x <= 0.1).length}`,
      );
    }
    if (endToEnd.length) {
      const e = endToEnd.filter((r) => r.gotSf !== null && r.keySf !== null).map((r) => Math.abs((r.gotSf as number) - (r.keySf as number)) / (r.keySf as number)).sort((a, b) => a - b);
      console.log(
        `BIM END TO END (finder raw, no key walls): ${endToEnd.length} joined, ${e.length} measured, ${endToEnd.filter((r) => r.why === "OPEN").length} open, ` +
          `${endToEnd.filter((r) => r.why === "MERGED").length} merged through a wall, ${endToEnd.filter((r) => r.why === "MERGED-NO-WALL").length} merged no wall; ` +
          `median ${e.length ? (e[Math.floor(e.length / 2)] * 100).toFixed(1) : "—"}%, within 5%: ${e.filter((x) => x <= 0.05).length}, within 10%: ${e.filter((x) => x <= 0.1).length}`,
      );
    }
    expect(all.length).toBeGreaterThan(0);
  });
});
