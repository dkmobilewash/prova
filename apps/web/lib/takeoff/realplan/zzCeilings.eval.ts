import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldOutReason } from "../heldOutSets";
import { describe, expect, it } from "vitest";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { printedScalesOnPage } from "../printedScales";
import { readSheetScale } from "../scaleFromDimensions";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { feetPerUnitFrom } from "../sheetScale";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetViews, viewRegions, viewsInRegions } from "../sheetViews";
import type { StrokeSegment } from "../wallVectors";
import { alignViews } from "../viewAlign";
type Box = { from: number; to: number; fromY: number; toY: number };
/** The parts of the page a view owns: its measured regions where `viewsInRegions` ran, else its bounding box. */
const boxesOf = (v: { from: number; to: number; fromY: number; toY: number; boxes?: Box[] }): Box[] => v.boxes ?? [{ from: v.from, to: v.to, fromY: v.fromY, toY: v.toY }];
const inAny = (boxes: readonly Box[] | null, x: number, y: number) => boxes === null || boxes.some((b) => x >= b.from && x < b.to && y >= b.fromY && y < b.toY);
import { roomsFromWalls, type FoundWall } from "../roomsFromWalls";
import { sheetStrokes } from "../sheetStrokes";
import { areaByFamily, assignCeilings, pairTagsToRoomTags, readCeilingDefaults, readCeilingLegend, readCeilingTags, readKeynoteCeilings, readSetLegendPage, roomTagsUnderCeilingCodes, type CeilingFamily, type CeilingLegendRow } from "../ceilingTags";
import { ceilingsFromScheduleRows, type ScheduleCeiling } from "../ceilingSchedule";
import { tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { readRoomTags } from "../roomTags";
import { familyOfPattern, legendSwatches, patternRound, windowRound, type PatternKind } from "../ceilingPattern";

/**
 * ── CEILINGS FROM THE REFLECTED CEILING PLAN, TRAINING SETS ONLY ──
 *
 * Per RCP page: scale as the rooms eval takes it; the RCP's own view where
 * the sheet has several; walls from the finder's raw pairings inside it;
 * rooms from `roomsFromWalls`; the sheet's ceiling legend, defaults and
 * tags; each room's ceiling; area per family. Against a key
 * (`answer-keys/ceilings/<set>__p<N>.json`: rooms by number or name with
 * family and height, and how many tags the sheet prints), it scores tags
 * read, rooms joined, family right, height right.
 *
 *   REAL_PLAN_DIR=… CEILING_KEYS=… CEILING_OUT=… CEILING_PAGES="set.pdf:24,…"
 */
const REAL = process.env.REAL_PLAN_DIR ?? "";
const KEYS = process.env.CEILING_KEYS ?? "";
const OUT = process.env.CEILING_OUT ?? "";
const RAW_MIN_FEET = 2;
/**
 * `floor` is the FLOOR PLAN of the same level, where rooms close far better
 * than on the RCP, and its label file where one exists (accepted + traced
 * walls, plus the finder's raw pairings — the rooms eval's "boundary" arm).
 * Area per ceiling family comes from the floor plan's polygons joined to
 * the RCP's rooms by printed number or name.
 */
type PageSpec = { set: string; page: number; agreedFeetPerInch?: number; floor?: { page: number; label?: string }; schedule?: number };
/** v2: the legend read across the whole set, once per set (pages carrying a ceiling legend title). */
const setLegends = new Map<string, CeilingLegendRow[]>();
async function setLegendFor(pdf: string, set: string, skipPage: number): Promise<CeilingLegendRow[]> {
  if (setLegends.has(set)) return setLegends.get(set)!.filter((r) => r.from !== `set p${skipPage}`);
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const rows: CeilingLegendRow[] = [];
  for (let p = 1; p <= doc.pageCount; p += 1) {
    const text = await doc.pageText(p);
    for (const r of readSetLegendPage(text.items, text.widthPt, p)) if (!rows.some((x) => x.code.toUpperCase() === r.code.toUpperCase())) rows.push(r);
  }
  await doc.close();
  setLegends.set(set, rows);
  return rows.filter((r) => r.from !== `set p${skipPage}`);
}
const DEFAULT_PAGES: PageSpec[] = [
  { set: "2025.07.08_Baker_EOC_BID.pdf", page: 14, floor: { page: 13, label: "A101" } },
  { set: "IFBREBID-Murray-Tower-Package.pdf", page: 24, floor: { page: 24, label: "A101" } },
  { set: "Joplin-community-center.pdf", page: 48, floor: { page: 46, label: "A-101" } },
  { set: "Supreme-Court-of-Missouri-Judiciary-Library.pdf", page: 8, floor: { page: 6, label: "A111" } },
  // Scales the product declines on these three: the view's own printed caption, passed through.
  { set: "Topeka-Senior-Villas.pdf", page: 78, agreedFeetPerInch: 32 / 3, floor: { page: 74, label: "p74" } },
  { set: "Missouri-State-Fairgrounds-New-Comfort-Station.pdf", page: 19, floor: { page: 16, label: "A-101" } },
  { set: "Crosslines-Phase-II-Drawings.pdf", page: 12, floor: { page: 10, label: "A100" } },
  { set: "MHK_FOR-BID-SET.pdf", page: 35, floor: { page: 32, label: "A1.01" } },
  { set: "NG-Green-Bay-WI.pdf", page: 12, floor: { page: 9, label: "A3.1" } },
  { set: "SW-Grand-Junction-CO.pdf", page: 13, floor: { page: 5, label: "A110" } },
  { set: "Camp-Clark-60-Soldier-Barracks.pdf", page: 24, agreedFeetPerInch: 8, floor: { page: 14, label: "A-101" } },
  { set: "E_Street_421-Set.pdf", page: 39, floor: { page: 28, label: "A2.1" } },
  { set: "BUNKIE-BID-DRAWINGS.pdf", page: 33, agreedFeetPerInch: 4, floor: { page: 31, label: "A100" }, schedule: 51 },
  // v2: E Street's demolition RCP, whose rooms are tagged by KEYNOTES.
  { set: "E_Street_421-Set.pdf", page: 26, floor: { page: 28, label: "A2.1" } },
];
const PAGES: PageSpec[] = process.env.CEILING_PAGES
  ? process.env.CEILING_PAGES.split(",").map((s) => {
      const [set, p, a, fp, fl, sc] = s.trim().split(":");
      return { set, page: Number(p), agreedFeetPerInch: a ? Number(a) : undefined, floor: fp ? { page: Number(fp), label: fl || undefined } : undefined, schedule: sc ? Number(sc) : undefined };
    })
  : DEFAULT_PAGES;
// A held-out set is refused by the shared list, not by a name somebody remembered:
// this eval tunes the readers, and a page from a held-out building would tune them on the test.
for (const spec of PAGES) {
  const why = heldOutReason(spec.set);
  if (why !== null) throw new Error(`${spec.set} is held out (${why}); the ceilings eval must not read it`);
}
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ROOM_KEYS = process.env.ROOM_KEYS ?? "";
/** The printed room areas keyed earlier for the rooms work (`answer-keys/rooms/printed/<set>*.json`), by room number or name. */
function printedAreasFor(set: string): Map<string, number> {
  const out = new Map<string, number>();
  const stem = set.replace(/\.pdf$/, "").toLowerCase().slice(0, 12);
  for (const f of readdirSync(join(ROOM_KEYS, "printed")).filter((f) => f.toLowerCase().startsWith(stem) && f.endsWith(".json"))) {
    const k = JSON.parse(readFileSync(join(ROOM_KEYS, "printed", f), "utf8")) as { rooms?: { number?: string | null; name?: string | null; areaSf?: number | null }[] };
    for (const r of k.rooms ?? []) {
      if (!r.areaSf) continue;
      if (r.number) out.set(norm(r.number), r.areaSf);
      else if (r.name) out.set(norm(r.name), r.areaSf);
    }
  }
  return out;
}
type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number; verdict: string }[];
  traced?: { x1: number; y1: number; x2: number; y2: number }[];
};

/** The floor plan's rooms: label walls where a label exists, plus the finder's raw pairings, as the rooms eval's boundary arm. */
async function floorRooms(pdf: string, page: number, label: string | undefined, set: string, exclude: Box[] | null = null) {
  const outside = (x: number, y: number) => exclude === null || !inAny(exclude, x, y);
  const labelPath = label && LABELS ? join(LABELS, set, `${label}.json`) : "";
  const saved = labelPath && existsSync(labelPath) ? (JSON.parse(readFileSync(labelPath, "utf8")) as Saved) : null;
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const text = await doc.pageText(page);
  const strokes = await doc.pageStrokes(page);
  await doc.close();
  let feetPerUnit: number;
  if (saved !== null && saved.page === page) feetPerUnit = saved.feetPerUnit;
  else {
    const segments = strokes.segments as Parameters<typeof readSheetScale>[1];
    const verdict = readSheetScale(text, segments, dimensionLabels(text), {}, metricDimensionLabels(text));
    if (verdict.ok) feetPerUnit = feetPerUnitFrom(verdict.feetPerInch, text.widthPt);
    else {
      const printed = scaleFromPrinted(printedScalesOnPage(text.items), text.widthPt, text.heightPt);
      if (!printed) return null;
      feetPerUnit = printed.declaredDistanceFeet / Math.abs(printed.x2 - printed.x1);
    }
  }
  const raw = await rawCandidates(pdf, page, feetPerUnit);
  const labelWalls: FoundWall[] =
    saved === null || saved.page !== page
      ? []
      : [
          ...saved.verdicts.filter((v) => v.verdict === "wall").map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thicknessFeet: v.thicknessFeet })),
          ...(saved.traced ?? []).map((t) => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })),
        ];
  const allRaw = await (async () => {
    const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
    const walls: FoundWall[] = [];
    findWallsOnSheet({
      segments: read.segments,
      textItems: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })),
      pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
      feetPerUnit,
      wallTypes: [],
      sampledSheets: null,
      onCandidate: (_f, w) => {
        if (w.lengthFeet >= RAW_MIN_FEET) walls.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet });
      },
    });
    return walls;
  })();
  // On Murray the RCP and the floor plan share the sheet and the room numbers: the floor
  // plan's rooms are the polygons tagged OUTSIDE the RCP's view. The walls stay whole —
  // the view's box is approximate, and a polygon with no tag is dropped anyway.
  const walls = [...allRaw, ...labelWalls];
  const floorText = text.items.filter((i) => outside(i.x / text.widthPt, i.y / text.widthPt));
  const result = roomsFromWalls({ walls, feetPerUnit, text: floorText, widthPt: text.widthPt });
  return { rooms: result.rooms, open: result.unplacedTags, feetPerUnit, labelled: labelWalls.length, raw: allRaw.length, found: raw.walls.length, widthPt: text.widthPt };
}

type Key = {
  tagsPrinted?: number;
  rooms: { number?: string; name?: string; family: CeilingFamily | null; heightFeet: number | null }[];
};
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();

const WALLS = process.env.CEILING_WALLS ?? "found";
async function rawCandidates(pdf: string, page: number, feetPerUnit: number) {
  const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const text = await doc.pageText(page);
  await doc.close();
  const walls: FoundWall[] = [];
  const found = findWallsOnSheet({
    segments: read.segments,
    textItems: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })),
    pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
    feetPerUnit,
    wallTypes: [],
    sampledSheets: null,
    onCandidate: (_f, w) => {
      if (w.lengthFeet >= RAW_MIN_FEET) walls.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet });
    },
  });
  // CEILING_WALLS=raw: every pairing >= 2 ft (what the rooms eval uses on a floor plan);
  // found (default): the rules' walls, because an RCP's 2x4 grid pairs into hundreds of "walls".
  const chosen = WALLS === "raw" ? walls : found.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet }));
  return { walls: chosen, strokes: read.segments.length, unitStrokes: read.segments.map((g) => ({ x1: g.x1 / read.widthPt, y1: g.y1 / read.widthPt, x2: g.x2 / read.widthPt, y2: g.y2 / read.widthPt })) };
}

describe.skipIf(REAL === "")("ceilings from the RCP", () => {
  it("reads each training RCP page", { timeout: 3_600_000 }, async () => {
    if (OUT) mkdirSync(OUT, { recursive: true });
    const lines: string[] = [];
    const say = (s: string) => {
      lines.push(s);
      console.log(s);
    };
    const totals = { pages: 0, tags: 0, rooms: 0, byTag: 0, byNote: 0, keyRooms: 0, joined: 0, familyRight: 0, familyAfter: 0, familyJudged: 0, heightRight: 0, heightJudged: 0, tagsPrinted: 0, tagsRead: 0, areaJoined: 0, areaRooms: 0, areaKeyed: 0, areaWithin10: 0 };
    for (const { set, page, agreedFeetPerInch, floor, schedule } of PAGES) {
      const pdf = join(REAL, set);
      if (!existsSync(pdf)) {
        say(`${set} p${page}: missing set`);
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
        scaleName = `1/${agreedFeetPerInch}" (agreed)`;
      } else {
        const printed = scaleFromPrinted(printedScalesOnPage(text.items), text.widthPt, text.heightPt);
        if (!printed) {
          say(`${set} p${page}: NO SCALE — ${verdict.reason.slice(0, 80)}… printed: ${printedScalesOnPage(text.items).join(" / ") || "none"}`);
          continue;
        }
        feetPerUnit = printed.declaredDistanceFeet / Math.abs(printed.x2 - printed.x1);
        scaleName = `${printed.scaleName} (printed)`;
      }
      // The RCP's own view, where the sheet has several captioned views.
      // ── v2: the views' MEASURED regions ── `sheetViews` alone gives every view
      // the whole page as its box (Murray's two views both read [0-1 x 0-∞]), so v1
      // never excluded the floor plan beside an RCP. `viewsInRegions` cuts the page
      // on its gutters and gives each view the cells it owns. v1 mode keeps the old boxes.
      const rawViews = sheetViews(text.items.map((i) => ({ str: i.str, x: i.x, y: i.y })), text.widthPt);
      const views =
        process.env.CEILING_V1 === "1"
          ? rawViews
          : viewsInRegions(rawViews, viewRegions(strokes.segments as StrokeSegment[], { widthPt: text.widthPt, heightPt: text.heightPt }));
      // The ceiling view, and the LARGEST of them where there are several — Topeka's
      // sheet prints the floor RCP beside an "ENLARGED TYP. UNIT ENTRY RCP".
      const area = (v: { from: number; to: number; fromY: number; toY: number }) => (v.to - v.from) * (v.toY - v.fromY);
      // … by the view holding the most room tags, since a view's box is only approximate.
      const allRoomTags = readRoomTags(text.items);
      const tagsIn = (v: { from: number; to: number; fromY: number; toY: number; boxes?: Box[] }) =>
        allRoomTags.filter((r) => inAny(boxesOf(v), r.x / text.widthPt, r.y / text.widthPt)).length;
      const rcp =
        views
          .filter((v) => /CEILING|RCP/i.test(v.name))
          .sort((a, b) => {
            const A = a as unknown as Parameters<typeof area>[0];
            const B = b as unknown as Parameters<typeof area>[0];
            return tagsIn(b as unknown as Parameters<typeof tagsIn>[0]) - tagsIn(a as unknown as Parameters<typeof tagsIn>[0]) || area(B) - area(A);
          })[0] ?? null;
      // A ceiling view whose box holds under three room tags is the wrong view or a bad box (Bunkie's
      // "CEILING DETAIL, TYPICAL" was chosen over an RCP the caption reader never captured): whole page then.
      // The measured region is used only where it holds most of the page's room tags:
      // on Joplin and SW the gutters cut the plan into cells that the detail captions
      // claim, and the "overall RCP" region kept 0 of 16 keyed rooms. The whole page is
      // the safer reading there, as it was in v1.
      const rcpTags = rcp === null ? 0 : tagsIn(rcp as unknown as Parameters<typeof tagsIn>[0]);
      const box: Box[] | null =
        rcp === null || views.length < 2 || rcpTags < 3 || rcpTags < 0.5 * allRoomTags.length ? null : boxesOf(rcp as unknown as Parameters<typeof boxesOf>[0]);
      const inBox = (x: number, y: number) => inAny(box, x, y);
      const raw = await rawCandidates(pdf, page, feetPerUnit);
      const walls = raw.walls.filter((w) => inBox((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2));
      const W = text.widthPt;
      const boxText = text.items.filter((i) => inBox(i.x / W, i.y / W));
      const result = roomsFromWalls({ walls, feetPerUnit, text: boxText, widthPt: W });
      const sheetLegend = readCeilingLegend(text.items, W);
      const keynotes = readKeynoteCeilings(text.items, W);
      const fromSet = process.env.CEILING_V1 === "1" ? [] : await setLegendFor(pdf, set, page);
      const legend = [...sheetLegend, ...keynotes.filter((k) => !sheetLegend.some((r) => r.code === k.code)), ...fromSet.filter((r) => !sheetLegend.some((x) => x.code.toUpperCase() === r.code.toUpperCase()) && !keynotes.some((x) => x.code === r.code))];
      const defaults = readCeilingDefaults(text.items, W);
      const tags = readCeilingTags(boxText, W, legend, raw.unitStrokes);
      const ceilings = assignCeilings(result.rooms, tags, defaults);
      // The per-room answer by the sheet's own printed room tags, polygon or no polygon.
      let roomTags = roomTagsUnderCeilingCodes(
        readRoomTags(boxText).map((r) => ({ name: r.name, number: r.number, x: r.x, y: r.y })),
        boxText,
        W,
        legend,
      );
      // ── v2: AN RCP VIEW WITH NO ROOM TAGS, BESIDE ITS FLOOR PLAN ──
      // Albany's RCP prints no tags; its floor plan, on the same sheet at the same
      // scale, prints them all. The two views' wall boxes give the offset, and the
      // floor plan's tags are carried across. CEILING_CARRY_TEST=1 pretends the RCP
      // has no tags, to measure the carry on Murray against its real ones.
      let carried = 0;
      const realRoomTags = roomTags;
      if (box !== null && (process.env.CEILING_CARRY_TEST === "1" || roomTags.filter((r) => r.number !== null).length < 2)) {
        const allTags = readRoomTags(text.items).map((r) => ({ name: r.name, number: r.number, x: r.x, y: r.y }));
        const other = views
          .filter((v) => v !== rcp)
          .map((v) => ({ v: v as unknown as { name: string; from: number; to: number; fromY: number; toY: number; boxes?: Box[] }, tags: allTags.filter((r) => inAny(boxesOf(v as unknown as Parameters<typeof boxesOf>[0]), r.x / W, r.y / W)) }))
          .sort((a, b) => b.tags.length - a.tags.length)[0];
        if (other !== undefined && other.tags.length >= 3) {
          const wallsIn = (bs: Box[]) => raw.walls.filter((w) => inAny(bs, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2));
          const shift = alignViews(wallsIn(box), wallsIn(boxesOf(other.v)), feetPerUnit);
          if (shift !== null) {
            const dx = shift.dx * W;
            const dy = shift.dy * W;
            const moved = other.tags.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
            carried = moved.length;
            roomTags = process.env.CEILING_CARRY_TEST === "1" ? moved : [...roomTags, ...moved];
            if (process.env.CEILING_CARRY_TEST === "1") {
              const within = (ft: number) => moved.filter((m) => realRoomTags.some((r) => r.number !== null && r.number === m.number && (Math.hypot(r.x - m.x, r.y - m.y) * feetPerUnit) / W <= ft)).length;
              const hits = within(3);
              const hits10 = within(10);
              const fmt = (bs: Box[]) => bs.map((b) => `[${b.from.toFixed(2)}-${b.to.toFixed(2)} x ${b.fromY.toFixed(2)}-${b.toY.toFixed(2)}]`).join("");
              say(`   CARRY TEST: RCP view ${fmt(box)} vs "${other.v.name}" ${fmt(boxesOf(other.v))}, ${shift.votes} walls agree: ${moved.length} tags carried by (${(dx / W * feetPerUnit).toFixed(1)}, ${(dy / W * feetPerUnit).toFixed(1)}) ft; ${hits} land within 3 ft and ${hits10} within 10 ft of the RCP's own tag of the same number (a tag sits where the drafter put it, not where the floor plan's is), of ${realRoomTags.filter((r) => r.number !== null).length} real`);
            } else say(`   CARRY: ${carried} room tags carried from "${other.v.name}" into the RCP view`);
          }
        }
      }
      const byTag = pairTagsToRoomTags(roomTags, tags, W, feetPerUnit, defaults, 25, result.rooms);
      if (process.env.CEILING_DEBUG === "1") {
        for (const c of byTag.filter((x) => x.tags.length > 0)) say(`   pair ${c.room.number ?? "—"} ${c.room.name}: ${c.tags.map((x) => `"${x.phrase}"${x.roomName ? ` [${x.roomName}]` : ""}`).join(", ")}`);
        for (const x of tags.filter((x) => !byTag.some((c) => c.tags.includes(x)))) say(`   unpaired "${x.phrase}"${x.roomName ? ` [${x.roomName}]` : ""} at ${x.x.toFixed(3)},${x.y.toFixed(3)}`);
      }
      const pairedTags = byTag.reduce((n, c) => n + c.tags.length, 0);
      // ── THE TYPE FROM THE DRAWN PATTERN, where no tag names one ──
      const swatches = legendSwatches(text.items, raw.unitStrokes, W);
      const patterns = byTag.map((c) => {
        return patternRound(raw.unitStrokes, windowRound(c.room, roomTags, W, feetPerUnit), feetPerUnit);
      });
      const tagFamily = (c: (typeof byTag)[number]) => c.tags.map((x) => x.family).find((f): f is CeilingFamily => f !== null) ?? null;
      const patternFamily = (i: number) => familyOfPattern(patterns[i].kind, swatches);
      // ── v2: a SCHEDULE by room, as a further source ──
      let scheduleRows: ScheduleCeiling[] = [];
      if (schedule !== undefined && process.env.CEILING_V1 !== "1") {
        const sdoc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const spage = await sdoc.pageText(schedule);
        await sdoc.close();
        scheduleRows = ceilingsFromScheduleRows(tableRowsFromPage(spage));
        say(`   SCHEDULE p${schedule}: ${scheduleRows.length} rooms with a ceiling column — ${scheduleRows.slice(0, 8).map((r) => `${r.number} ${r.finish ?? "—"}${r.heightFeet ? ` ${r.heightFeet}ft` : ""}`).join(", ")}`);
      }
      const scheduled = (c: (typeof byTag)[number]) => scheduleRows.find((r) => (c.room.number && norm(r.number) === norm(c.room.number)) || (c.room.name && r.name && norm(r.name) === norm(c.room.name))) ?? null;
      // ── v2: the WORDS win — a tag that says existing / no ceiling keeps its family, no pattern ──
      const familyAfter = (i: number) => {
        const c = byTag[i];
        const own = tagFamily(c);
        if (c.existing && own !== null) return own;
        return own ?? (process.env.CEILING_V1 === "1" ? null : scheduled(c)?.family ?? null) ?? patternFamily(i) ?? defaults.family;
      };
      const heightAfter = (i: number) => byTag[i].heightFeet ?? (process.env.CEILING_V1 === "1" ? null : scheduled(byTag[i])?.heightFeet ?? null);
      const kinds = patterns.reduce<Record<string, number>>((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {});
      if (process.env.CEILING_DEBUG === "1") {
        for (const [i, c] of byTag.entries()) {
          const p = patterns[i];
          say(`   window ${c.room.number ?? c.room.name}: ${p.kind} h${p.counts.horizontal} v${p.counts.vertical} d${p.counts.diagonal} t${p.counts.tiny} half ${(p.window.half * feetPerUnit).toFixed(1)} ft${p.spacingFeet.x || p.spacingFeet.y ? ` spacing ${p.spacingFeet.x?.toFixed(1) ?? "?"}x${p.spacingFeet.y?.toFixed(1) ?? "?"}` : ""}`);
        }
      }
      say(`   LEGEND: sheet ${sheetLegend.length} rows, keynotes ${keynotes.length} [${keynotes.map((k) => `${k.code}=${k.family}${k.existing ? "(existing)" : ""}`).join(" ")}], from the set ${fromSet.length} [${fromSet.slice(0, 6).map((r) => `${r.code}=${r.family} (${r.from})`).join(" ")}]; prefix guesses ${tags.filter((t) => t.familyFrom === "prefix").length}; rooms saying existing ${byTag.filter((c) => c.existing).length}`);
      say(
        `   PATTERNS: swatches [${[...swatches.entries()].map(([k, f]) => `${k}=${f}`).join(" ")}]; rooms by pattern ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ")}; ` +
          `grid spacings ${patterns.filter((p) => p.kind === "grid").map((p) => `${p.spacingFeet.x?.toFixed(1) ?? "?"}x${p.spacingFeet.y?.toFixed(1) ?? "?"}`).slice(0, 8).join(" ")}`,
      );
      if (OUT) {
        writeFileSync(
          join(OUT, `crops__${set.replace(/\.pdf$/, "")}__p${page}.json`),
          JSON.stringify(byTag.map((c, i) => ({ name: `${c.room.number ?? c.room.name}-${patterns[i].kind}${patternFamily(i) ? `-${patternFamily(i)}` : ""}`, x: patterns[i].window.cx, y: patterns[i].window.cy, halfFeet: patterns[i].window.half * feetPerUnit * 1.3 }))),
        );
      }
      const areas = areaByFamily(result.rooms, ceilings);
      const polyByTag = ceilings.filter((c) => c.source === "tag").length;
      const byNote = ceilings.filter((c) => c.source === "note").length;
      const tagsInRooms = ceilings.reduce((n, c) => n + c.tags.length, 0);
      say(
        `\n${set} p${page} (${scaleName}${box ? `, view "${rcp!.name}" of ${views.length} [${box.map((b) => `${b.from.toFixed(2)}-${b.to.toFixed(2)}x${b.fromY.toFixed(2)}-${b.toY.toFixed(2)}`).join(" ")}]` : views.length >= 2 ? `, ${views.length} views, none named ceiling — whole page` : ""}): ${walls.length} ${WALLS} walls, ${result.rooms.length} rooms (${result.rooms.filter((r) => r.tag).length} tagged, ${ceilings.filter((c) => !result.rooms[c.roomIndex].tag && c.roomName !== null).length} named by a ceiling tag); ` +
          `legend ${legend.length} rows [${legend.map((r) => `${r.code}=${r.family}`).join(" ")}]; defaults ${defaults.heightFeet ?? "—"} ft / ${defaults.family ?? "—"}${defaults.phrase ? ` ("${defaults.phrase.slice(0, 50)}…")` : ""}; ` +
          `${tags.length} ceiling tags read (${tags.filter((t) => t.heightFeet !== null).length} with height, ${tags.filter((t) => t.family !== null).length} with type), ${tagsInRooms} inside rooms; ` +
          `polygon rooms by tag ${polyByTag}, by note ${byNote}, none ${ceilings.length - polyByTag - byNote}; sf by family ACT ${Math.round(areas.ACT)} GYP ${Math.round(areas.GYP)} OPEN ${Math.round(areas.OPEN)} OTHER ${Math.round(areas.OTHER)} unknown ${Math.round(areas.UNKNOWN)}; ` +
          `ROOM TAGS ${roomTags.length}: ${pairedTags} ceiling tags paired, rooms with a ceiling by tag ${byTag.filter((c) => c.source === "tag").length}, by note ${byTag.filter((c) => c.source === "note").length}`,
      );
      for (const t of tags.slice(0, process.env.CEILING_DEBUG === "1" ? 40 : 6)) say(`   tag "${t.phrase}" → ${t.family ?? "?"} ${t.heightFeet ?? "?"} ft${t.roomName ? ` (room "${t.roomName}")` : ""} at ${t.x.toFixed(3)},${t.y.toFixed(3)}`);
      say(`   room tags: ${result.rooms.filter((r) => r.tag).map((r) => r.tag!.number ?? r.tag!.name).slice(0, 20).join(", ") || "none"}; open tags: ${result.unplacedTags.map((t) => t.number ?? t.name).slice(0, 20).join(", ") || "none"}`);
      totals.pages += 1;
      totals.tags += tags.length;
      totals.rooms += result.rooms.length;
      totals.byTag += byTag.filter((c) => c.source === "tag").length;
      totals.byNote += byTag.filter((c) => c.source === "note").length;
      if (OUT) {
        writeFileSync(
          join(OUT, `ceilings__${set.replace(/\.pdf$/, "")}__p${page}.json`),
          JSON.stringify({
            pdf, set, sheet: `p${page}`, page, widthPt: W, heightPt: text.heightPt, feetPerUnit, walls,
            rooms: result.rooms.map((r, i) => ({ ...r, ceiling: ceilings[i] })),
            unplacedTags: tags.map((t) => ({ name: t.phrase, number: null, x: t.x, y: t.y })),
            mergedTags: result.unplacedTags,
            legend, defaults, areas,
          }),
        );
      }
      // ── AREA PER CEILING FAMILY, FROM THE FLOOR PLAN'S ROOMS ──
      if (floor !== undefined) {
        const fr = await floorRooms(pdf, floor.page, floor.label, set, floor.page === page ? box : null);
        if (fr === null) say(`   FLOOR p${floor.page}: no scale — no areas`);
        else {
          const rcpBox = box;
          const inRcp = (r: { xs: number[]; ys: number[] }) => {
            if (rcpBox === null || floor.page !== page) return false;
            const cx = r.xs.reduce((a, b) => a + b, 0) / r.xs.length;
            const cy = r.ys.reduce((a, b) => a + b, 0) / r.ys.length;
            return inAny(rcpBox, cx, cy);
          };
          const polys = fr.rooms.filter((r) => r.tag && !inRcp(r));
          // The RCP's rooms for the join: its printed room tags that look like rooms (not keynotes,
          // fixture marks or sheet numbers), plus rooms known only by the name over a ceiling tag (Baker).
          const ROOMISH = /^(?:[A-Z]{0,2}\d{2,4}[A-Z]?(?:\.\d)?|[A-Z]\d{1,2}-\d{1,2})$/;
          type Rcp = { number: string | null; name: string; family: CeilingFamily | null; code: string | null; pattern: (typeof patterns)[number] | null };
          const rcpRooms: Rcp[] = byTag
            .map((c, i) => ({ c, i }))
            // Bunkie's E101 and a sheet's A111 have the same shape; the sheet number is left in and reads as "no such tag".
            .filter(({ c }) => c.room.number !== null && ROOMISH.test(c.room.number))
            .map(({ c, i }) => ({ number: c.room.number, name: c.room.name, family: familyAfter(i), code: c.code, pattern: patterns[i] }));
          for (const t of tags) {
            if (t.roomName === null || rcpRooms.some((r) => r.number === null && norm(r.name) === norm(t.roomName!)) || byTag.some((c) => c.tags.includes(t) && c.room.number !== null && ROOMISH.test(c.room.number))) continue;
            rcpRooms.push({ number: null, name: t.roomName, family: t.family ?? defaults.family, code: t.code, pattern: null });
          }
          const sf: Record<string, number> = { ACT: 0, GYP: 0, OPEN: 0, OTHER: 0, UNKNOWN: 0 };
          const byCode: Record<string, number> = {};
          let joined = 0;
          const unjoined: string[] = [];
          const errs: number[] = [];
          const printedKey = ROOM_KEYS ? printedAreasFor(set) : new Map<string, number>();
          let keyed = 0;
          for (const r of rcpRooms) {
            const poly = polys.find((p) => (r.number && norm(p.tag!.number) === norm(r.number)) || (!r.number && norm(p.tag!.name) === norm(r.name)));
            if (poly === undefined) {
              const openTag = fr.open.find((t) => (r.number && norm(t.number) === norm(r.number)) || (!r.number && norm(t.name) === norm(r.name)));
              unjoined.push(`${r.number ?? r.name}: ${openTag ? "floor room did not close" : "no such tag on the floor plan"}`);
              continue;
            }
            joined += 1;
            const family = r.family ?? "UNKNOWN";
            sf[family] += poly.squareFeet;
            const p = r.pattern;
            const code = r.code ?? (p && p.kind === "grid" && p.spacingFeet.x && p.spacingFeet.y ? `grid ${Math.round(p.spacingFeet.x)}x${Math.round(p.spacingFeet.y)}` : family);
            byCode[code] = (byCode[code] ?? 0) + poly.squareFeet;
            const printed = poly.tag?.areaSf ?? printedKey.get(norm(r.number ?? r.name)) ?? null;
            if (printed) {
              keyed += 1;
              errs.push(Math.abs(poly.squareFeet - printed) / printed);
            }
          }
          const med = errs.length ? [...errs].sort((a, b) => a - b)[Math.floor(errs.length / 2)] : null;
          say(
            `   AREAS from floor p${floor.page}${floor.label ? ` (${floor.label} label: ${fr.labelled} walls)` : ""} + ${fr.raw} raw: ${fr.rooms.length} rooms (${polys.length} tagged); RCP rooms joined ${joined} of ${rcpRooms.length}; ` +
              `sf by family ACT ${Math.round(sf.ACT)} GYP ${Math.round(sf.GYP)} OPEN ${Math.round(sf.OPEN)} OTHER ${Math.round(sf.OTHER)} unknown ${Math.round(sf.UNKNOWN)}; ` +
              `by code ${Object.entries(byCode).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")}` +
              (errs.length ? `; vs printed areas: ${keyed} rooms, median |err| ${(med! * 100).toFixed(1)}%, within 10%: ${errs.filter((e) => e <= 0.1).length}` : "; no printed areas for this floor"),
          );
          for (const u of unjoined.slice(0, 15)) say(`     unjoined ${u}`);
          totals.areaJoined += joined;
          totals.areaRooms += rcpRooms.length;
          totals.areaKeyed += keyed;
          totals.areaWithin10 += errs.filter((e) => e <= 0.1).length;
        }
      }
      const keyFile = KEYS ? join(KEYS, `${set.replace(/\.pdf$/, "")}__p${page}.json`) : "";
      let familyAfterRight = 0;
      if (keyFile && existsSync(keyFile)) {
        const key = JSON.parse(readFileSync(keyFile, "utf8")) as Key;
        if (key.tagsPrinted !== undefined) {
          totals.tagsPrinted += key.tagsPrinted;
          totals.tagsRead += Math.min(tags.length, key.tagsPrinted);
        }
        let joined = 0, fr = 0, fj = 0, hr = 0, hj = 0;
        const misses: string[] = [];
        for (const k of key.rooms) {
          // Join by the printed room tag first; a polygon room's tag or a ceiling tag's own room name second.
          const atTag = byTag.findIndex((x) => (k.number && norm(x.room.number) === norm(k.number)) || (k.name && norm(x.room.name) === norm(k.name)));
          let c: { family: CeilingFamily | null; heightFeet: number | null; source: string; after?: CeilingFamily | null; pattern?: PatternKind } | null =
            atTag >= 0 ? { ...byTag[atTag], heightFeet: heightAfter(atTag), after: familyAfter(atTag), pattern: patterns[atTag].kind } : null;
          if (c === null) {
            const at = result.rooms.findIndex(
              (r, i) =>
                (r.tag && ((k.number && norm(r.tag.number) === norm(k.number)) || (k.name && norm(r.tag.name) === norm(k.name)))) ||
                (k.name && ceilings[i].roomName !== null && norm(ceilings[i].roomName) === norm(k.name)),
            );
            if (at >= 0) c = ceilings[at];
          }
          if (c === null) {
            const named = tags.find((x) => k.name && x.roomName !== null && norm(x.roomName) === norm(k.name));
            if (named) c = { family: named.family ?? defaults.family, heightFeet: named.heightFeet ?? defaults.heightFeet, source: "tag" };
          }
          if (c === null) {
            misses.push(`${k.number ?? k.name}: no room tag read`);
            continue;
          }
          joined += 1;
          if (k.family !== null) {
            fj += 1;
            if (c.family === k.family) fr += 1;
            const after = c.after === undefined ? c.family : c.after;
            if (after === k.family) familyAfterRight += 1;
            if (c.family !== k.family || after !== k.family) misses.push(`${k.number ?? k.name}: family ${c.family ?? "—"} (${c.source}) → with pattern ${after ?? "—"} (${c.pattern ?? "no window"}) vs ${k.family}`);
          }
          if (k.heightFeet !== null) {
            hj += 1;
            if (c.heightFeet !== null && Math.abs(c.heightFeet - k.heightFeet) < 0.05) hr += 1;
            else misses.push(`${k.number ?? k.name}: height ${c.heightFeet ?? "—"} (${c.source}) vs ${k.heightFeet}`);
          }
        }
        totals.keyRooms += key.rooms.length;
        totals.joined += joined;
        totals.familyRight += fr;
        totals.familyAfter += familyAfterRight;
        totals.familyJudged += fj;
        totals.heightRight += hr;
        totals.heightJudged += hj;
        say(`   KEY: ${key.rooms.length} rooms, joined ${joined}; family right ${fr}/${fj} before, ${familyAfterRight}/${fj} with the pattern; height right ${hr}/${hj}${key.tagsPrinted !== undefined ? `; tags printed ${key.tagsPrinted}, read ${tags.length}` : ""}`);
        for (const m of misses.slice(0, 12)) say(`     miss: ${m}`);
      }
    }
    say(`\nAREAS: ${totals.areaJoined} of ${totals.areaRooms} RCP rooms joined to a floor-plan polygon; ${totals.areaWithin10} of ${totals.areaKeyed} with a printed area within 10%`);
    say(`\nTOTALS: ${totals.pages} pages, ${totals.tags} tags read, ${totals.rooms} rooms — by tag ${totals.byTag}, by note ${totals.byNote}${totals.keyRooms ? `; KEYS: ${totals.keyRooms} rooms, joined ${totals.joined}, family right ${totals.familyRight}/${totals.familyJudged} before and ${totals.familyAfter}/${totals.familyJudged} with the pattern, height right ${totals.heightRight}/${totals.heightJudged}, tags read ${totals.tagsRead}/${totals.tagsPrinted}` : ""}`);
    if (OUT) writeFileSync(join(OUT, "summary.txt"), lines.join("\n"));
    expect(PAGES.length, "no ceiling pages named — a run over nothing is not a run").toBeGreaterThan(0);
    expect(totals.pages).toBeGreaterThan(0);
  });
});
