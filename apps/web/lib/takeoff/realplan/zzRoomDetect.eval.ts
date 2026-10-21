import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { roomsFromWalls, type FoundWall, type RoomFromWalls } from "../roomsFromWalls";

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

type Key = { rooms: { name: string; number: string | null; areaSf: number; at: { x: number; y: number } | null }[] };
type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number; verdict: string }[];
  traced: { x1: number; y1: number; x2: number; y2: number }[];
};

/** Labelled sheet → the key that prints its rooms' areas, and how to join. */
const LABELLED: { set: string; sheet: string; key: string; join: "number" | "name" }[] = [
  { set: "BUNKIE-BID-DRAWINGS.pdf", sheet: "A100", key: "printed/BUNKIE-BID-DRAWINGS__p32.json", join: "number" },
  { set: "2025.07.08_Baker_EOC_BID.pdf", sheet: "A100", key: "printed/2025.07.08_Baker_EOC_BID__p4.json", join: "name" },
  { set: "2025.07.08_Baker_EOC_BID.pdf", sheet: "A101", key: "printed/2025.07.08_Baker_EOC_BID__p4.json", join: "name" },
  { set: "SW-Grand-Junction-CO.pdf", sheet: "A110", key: "printed/SW-Grand-Junction-CO__p43.json", join: "number" },
];

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9#]+/g, " ").trim();

type Row = { id: string; keySf: number; gotSf: number | null; why?: "OPEN" | "MERGED" | "MERGED-NO-WALL" };

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
  const errs = rows.filter((r) => r.gotSf !== null).map((r) => Math.abs((r.gotSf as number) - r.keySf) / r.keySf);
  errs.sort((a, b) => a - b);
  const median = errs.length ? errs[Math.floor(errs.length / 2)] : null;
  const within10 = errs.filter((e) => e <= 0.1).length;
  const signed = rows.filter((r) => r.gotSf !== null).map((r) => ((r.gotSf as number) - r.keySf) / r.keySf);
  const mean = signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : null;
  console.log(
    `${title}: ${rooms.length} regions, ${rooms.filter((r) => r.tag).length} tagged, ${unplaced.length} tags open, ${merged.length} merged; ` +
      `key rooms ${key.rooms.length}, joined ${rows.length}, measured ${errs.length}, within 5%: ${errs.filter((e) => e <= 0.05).length}, within 10%: ${within10}, ` +
      `median |err| ${median === null ? "—" : (median * 100).toFixed(1) + "%"}, mean signed ${mean === null ? "—" : (mean * 100).toFixed(1) + "%"}`,
  );
  for (const r of rows) {
    if (r.gotSf !== null && Math.abs(r.gotSf - r.keySf) / r.keySf <= 0.1) continue;
    console.log(
      `    ${r.id.padEnd(7)} key ${r.keySf.toFixed(0).padStart(6)} sf  got ${r.gotSf === null ? `  ${r.why}` : r.gotSf.toFixed(0).padStart(8)}` +
        (r.gotSf === null ? "" : `  ${(((r.gotSf - r.keySf) / r.keySf) * 100).toFixed(1).padStart(7)}%`),
    );
  }
  return rows;
}

function dump(name: string, result: ReturnType<typeof roomsFromWalls>, extra: object) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ ...extra, ...result }, null, 1));
}

describe("rooms from walls, measured", () => {
  it.skipIf(REAL === "" || LABELS === "" || KEYS === "")("labels arm: accepted + traced walls", { timeout: 1_800_000 }, async () => {
    const all: Row[] = [];
    for (const { set, sheet, key: keyFile, join: how } of LABELLED) {
      const labelPath = join(LABELS, set, `${sheet}.json`);
      const keyPath = join(KEYS, keyFile);
      if (!existsSync(labelPath) || !existsSync(keyPath)) {
        console.log(`${set} ${sheet}: missing ${existsSync(labelPath) ? "key" : "label"}`);
        continue;
      }
      const saved = JSON.parse(readFileSync(labelPath, "utf8")) as Saved;
      const key = JSON.parse(readFileSync(keyPath, "utf8")) as Key;
      const walls: FoundWall[] = [
        ...saved.verdicts.filter((v) => v.verdict === "wall").map((v) => ({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, thicknessFeet: v.thicknessFeet })),
        ...(saved.traced ?? []).map((t) => ({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 })),
      ];
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(REAL, set))));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const result = roomsFromWalls({ walls, feetPerUnit: saved.feetPerUnit, text: text.items, widthPt: text.widthPt });
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
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it.skipIf(BIM === "" || KEYS === "")("bim arm: the key's own centrelines", { timeout: 1_800_000 }, async () => {
    const all: Row[] = [];
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
        const result = roomsFromWalls({ walls, feetPerUnit: 1 / key.unitsPerFoot, text: text.items, widthPt: text.widthPt });
        dump(`bim__${k.id}`, result, { pdf: join(BIM, model.name, k.file), set: k.id, page: 1, widthPt: text.widthPt, heightPt: text.heightPt, feetPerUnit: 1 / key.unitsPerFoot, walls });
        all.push(...score(`${k.id} (${walls.length} wall pieces)`, result.rooms, result.unplacedTags, result.mergedTags, key, "number", walls));
      }
    }
    const errs = all.filter((r) => r.gotSf !== null).map((r) => Math.abs((r.gotSf as number) - r.keySf) / r.keySf).sort((a, b) => a - b);
    console.log(
      `\nBIM TOTAL: ${all.length} key rooms joined, ${errs.length} measured, ${all.filter((r) => r.why === "OPEN").length} open, ${all.filter((r) => r.why === "MERGED").length} merged through a wall (a leak), ${all.filter((r) => r.why === "MERGED-NO-WALL").length} merged with no wall in the model; ` +
        `median ${(errs[Math.floor(errs.length / 2)] * 100).toFixed(1)}%, within 5%: ${errs.filter((e) => e <= 0.05).length}, within 10%: ${errs.filter((e) => e <= 0.1).length}`,
    );
    expect(all.length).toBeGreaterThan(0);
  });
});
