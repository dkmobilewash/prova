import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { readRoomTags, type RoomTag } from "../roomTags";

/**
 * ── ROOM ANSWER KEYS WITHOUT NEW LABELLING ──
 *
 * Three sources, one file shape, written under `ROOM_KEYS_OUT/<source>/`:
 *
 *   printed   training-set pages whose room tags PRINT an area
 *             (`zzRoomAreaInventory.eval.ts` found them; held-out sets are
 *             excluded by name and never opened);
 *   bim       `bim-sheets/*.json` — every IFC space's area, joined to the
 *             tag the r1-section renderer printed for it, so the room has a
 *             position on the page;
 *   synthetic `fixtures/truth/S*.json` areas joined to the NAME / NUMBER
 *             tag read off `plans-only/S*.pdf`.
 *
 * Positions are in PAGE-WIDTH units, y from the top — what the finder, the
 * label files and `TakeoffMeasurement` all use — so a detected region can be
 * asked "which tag is inside you" with no conversion.
 *
 * Prints COUNTS only. Names and numbers go to the key files, which live
 * beside the confidential plans and outside git.
 *
 *     REAL_PLAN_DIR=…/real-plans/new BIM_DIR=…/bim-sheets \
 *     PLANS_ONLY_DIR=…/plans-only ROOM_KEYS_OUT=…/answer-keys/rooms \
 *       pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzRoomKeys
 */
const REAL = process.env.REAL_PLAN_DIR ?? "";
const BIM = process.env.BIM_DIR ?? "";
const SYN = process.env.PLANS_ONLY_DIR ?? "";
const OUT = process.env.ROOM_KEYS_OUT ?? "";

/** BOARD.md rules 3, 4 and 5: the wall and plan-text held-outs, plus Jefferson
 *  City, which is kept out of everything as Albany's twin. Matched on the file
 *  name, so a held-out set is never even opened. */
const HELD_OUT = [
  "central-bank", "gen-bbq", "sln-terminal", "stem-bid",
  "lodi-memorial", "missouri-new", "nall-wealth",
  "ksu-fairchild", "albany-readiness", "oreillys", "jefferson-city",
];

/**
 * The pages the inventory found, by hand, 2026-10-21 and 2026-10-22.
 *
 * `bareAreas`: the page prints an area INSIDE each room with no name stacked
 * over it (Camp Clark's code plan: `375 SF` sitting in the room, the name
 * elsewhere). Those become rooms with no name and no number, joined to a
 * detected region by POSITION. `tagsOnly`: the page prints NAME / NUMBER tags
 * and no areas at all (Joplin, Topeka, the Supreme Court library — none of
 * the 2026-10-22 training sets prints room areas on its plans); the key then
 * says which rooms exist and where, so closed / open / merged can be counted,
 * and nothing about their size.
 */
const PRINTED: { file: string; page: number; note: string; bareAreas?: boolean; tagsOnly?: boolean }[] = [
  { file: "Camp-Clark-60-Soldier-Barracks.pdf", page: 3, note: "code plan: areas printed inside the rooms, no name over them", bareAreas: true },
  { file: "Topeka-Senior-Villas.pdf", page: 6, note: "code plan, NAME / NUMBER tags, no areas", tagsOnly: true },
  { file: "Joplin-community-center.pdf", page: 46, note: "A-101, NAME / NUMBER tags, no areas", tagsOnly: true },
  { file: "Joplin-community-center.pdf", page: 47, note: "the sheet after A-101, NAME / NUMBER tags, no areas", tagsOnly: true },
  { file: "Supreme-Court-of-Missouri-Judiciary-Library.pdf", page: 6, note: "floor plan, NAME / NUMBER tags, no areas", tagsOnly: true },
  { file: "2025.07.08_Baker_EOC_BID.pdf", page: 4, note: "code/area plan, NAME over SF, no numbers; same building as A100/A101" },
  { file: "BUNKIE-BID-DRAWINGS.pdf", page: 31, note: "A100, a labelled sheet" },
  { file: "BUNKIE-BID-DRAWINGS.pdf", page: 32, note: "the sheet after A100, tags with corridor and toilet" },
  { file: "BUNKIE-BID-DRAWINGS.pdf", page: 35, note: "A104, a labelled sheet: one tag prints an area" },
  { file: "BUNKIE-BID-DRAWINGS.pdf", page: 46, note: "finish-schedule page; prints the staff toilets' areas (K107, E101)" },
  { file: "SW-Grand-Junction-CO.pdf", page: 43, note: "NAME / NUMBER / SF tags" },
];

export type RoomKey = {
  format: "room-keys-v1";
  source: "printed" | "bim" | "synthetic";
  set: string;
  page: number;
  note?: string;
  widthPt: number;
  heightPt: number;
  /** Page-width units per foot, when the key knows it (BIM, synthetic). */
  unitsPerFoot: number | null;
  rooms: {
    name: string;
    number: string | null;
    /** Null on a tags-only key: the room exists and is here; its size is unknown. */
    areaSf: number | null;
    perimeterLf: number | null;
    /** Page-width units, y from the top; null when the key has no position. */
    at: { x: number; y: number } | null;
  }[];
};

function write(key: RoomKey) {
  if (!OUT) return;
  const dir = join(OUT, key.source);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key.set.replace(/\.pdf$/i, "")}__p${key.page}.json`), JSON.stringify(key, null, 2));
}

const toUnits = (tags: RoomTag[], widthPt: number) =>
  tags.map((t) => ({ ...t, at: { x: t.x / widthPt, y: t.y / widthPt } }));

describe.skipIf(REAL === "" && BIM === "" && SYN === "")("room answer keys", () => {
  it.skipIf(REAL === "")("printed tags on training pages", { timeout: 600_000 }, async () => {
    let total = 0;
    for (const { file, page, note, bareAreas, tagsOnly } of PRINTED) {
      if (HELD_OUT.some((h) => file.toLowerCase().includes(h))) throw new Error(`held-out: ${file}`);
      if (!existsSync(join(REAL, file))) {
        console.log(`printed  ${file}: not on disk, skipped`);
        continue;
      }
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(REAL, file))));
      const text = await doc.pageText(page);
      let tags = toUnits(readRoomTags(text.items), text.widthPt).filter((t) => tagsOnly ? t.number !== null && /(?:[A-Za-z].*){3}/.test(t.name) && t.name.length <= 40 : t.areaSf !== null);
      if (bareAreas) {
        // Every `N SF` on the page that is not a tally column and not a
        // building total (`SQ. FT.`), at its own position.
        const AREA = /^\s*(\d[\d,]*(?:\.\d+)?)\s*SF\s*$/i;
        const items = text.items.filter((i) => AREA.test(i.str));
        const inColumn = (a: typeof items[number]) =>
          items.some((o) => o !== a && Math.abs(o.x + o.width / 2 - (a.x + a.width / 2)) < Math.max(o.width, a.width) / 2 && Math.abs(o.y - a.y) > a.height * 0.5 && Math.abs(o.y - a.y) <= a.height * 1.8);
        tags = items
          .filter((i) => !inColumn(i))
          .map((i) => ({ name: "", number: null, areaSf: Number(i.str.replace(/[^\d.]/g, "")), x: (i.x + i.width / 2) / text.widthPt, y: (i.y + i.height / 2) / text.widthPt, at: { x: (i.x + i.width / 2) / text.widthPt, y: (i.y + i.height / 2) / text.widthPt } }));
      }
      await doc.close();
      write({
        format: "room-keys-v1",
        source: "printed",
        set: file,
        page,
        note,
        widthPt: text.widthPt,
        heightPt: text.heightPt,
        unitsPerFoot: null,
        rooms: tags.map((t) => ({ name: t.name, number: t.number, areaSf: t.areaSf, perimeterLf: null, at: t.at })),
      });
      console.log(`printed  ${file} p${page}: ${tags.length} rooms (${tags.filter((t) => t.areaSf !== null).length} with an area, ${tags.filter((t) => t.number).length} numbered)`);
      total += tags.length;
    }
    expect(PRINTED.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
  });

  it.skipIf(BIM === "")("BIM spaces joined to their printed tags", () => {
    let rooms = 0;
    let placed = 0;
    let sheets = 0;
    for (const model of readdirSync(BIM, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const name of readdirSync(join(BIM, model.name)).filter((f) => f.endsWith(".json")).sort()) {
        const key = JSON.parse(readFileSync(join(BIM, model.name, name), "utf8")) as {
          id: string;
          file: string;
          page_size_pt: [number, number];
          views: { origin_pt: [number, number]; pt_per_ft: number }[];
          features: { id: number; type: string; subtype: string | null; space_id?: string }[];
          rooms: { id: string; number: string; name: string; area_sf: number }[];
          pieces: { texts: [number, number, number, number, string, number, number][] };
        };
        const [W, H] = key.page_size_pt;
        const tagOfSpace = new Map<string, number>();
        for (const f of key.features) if (f.type === "tag" && f.subtype === "room" && f.space_id) tagOfSpace.set(f.space_id, f.id);
        const textsOf = new Map<number, typeof key.pieces.texts>();
        for (const t of key.pieces.texts) {
          const list = textsOf.get(t[5]);
          if (list) list.push(t);
          else textsOf.set(t[5], [t]);
        }
        const out: RoomKey["rooms"] = key.rooms.map((r) => {
          const tag = tagOfSpace.get(r.id);
          const texts = tag === undefined ? [] : (textsOf.get(tag) ?? []);
          let at: { x: number; y: number } | null = null;
          if (texts.length > 0) {
            const xs = texts.flatMap((t) => [t[0], t[2]]);
            const ys = texts.flatMap((t) => [t[1], t[3]]);
            // PDF user space, y UP → page-width units, y from the top.
            at = { x: (Math.min(...xs) + Math.max(...xs)) / 2 / W, y: (H - (Math.min(...ys) + Math.max(...ys)) / 2) / W };
            placed += 1;
          }
          return { name: r.name, number: r.number, areaSf: r.area_sf, perimeterLf: null, at };
        });
        rooms += out.length;
        sheets += 1;
        write({
          format: "room-keys-v1",
          source: "bim",
          set: basename(key.file),
          page: 1,
          widthPt: W,
          heightPt: H,
          unitsPerFoot: key.views[0] ? key.views[0].pt_per_ft / W : null,
          rooms: out,
        });
      }
    }
    console.log(`bim      ${sheets} sheets, ${rooms} rooms, ${placed} with a tag position`);
    expect(rooms).toBeGreaterThan(0);
  });

  it.skipIf(SYN === "")("synthetic truth joined to the tag on the sheet", { timeout: 600_000 }, async () => {
    const truthDir = join(__dirname, "..", "fixtures", "truth");
    let rooms = 0;
    let placed = 0;
    for (const name of readdirSync(truthDir).filter((f) => /^S\d+\.json$/.test(f)).sort()) {
      const truth = JSON.parse(readFileSync(join(truthDir, name), "utf8")) as {
        id: string;
        scale_ratio: number;
        rooms: { label: string; area_sf: number; perimeter_lf: number }[];
      };
      const pdf = join(SYN, `${truth.id}.pdf`);
      if (!existsSync(pdf)) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(1);
      await doc.close();
      const tags = toUnits(readRoomTags(text.items), text.widthPt);
      const out: RoomKey["rooms"] = truth.rooms.map((r) => {
        const tag = tags.find((t) => `${t.name} ${t.number ?? ""}`.trim() === r.label);
        if (tag) placed += 1;
        const [n, num] = [r.label.replace(/\s+\S+$/, ""), r.label.split(/\s+/).pop() ?? null];
        return { name: n, number: num, areaSf: r.area_sf, perimeterLf: r.perimeter_lf, at: tag ? tag.at : null };
      });
      rooms += out.length;
      write({
        format: "room-keys-v1",
        source: "synthetic",
        set: `${truth.id}.pdf`,
        page: 1,
        widthPt: text.widthPt,
        heightPt: text.heightPt,
        // 72 points to the inch, scale_ratio inches of building per inch of paper.
        unitsPerFoot: (12 * 72) / truth.scale_ratio / text.widthPt,
        rooms: out,
      });
    }
    console.log(`synthetic ${rooms} rooms, ${placed} with a tag position`);
    expect(placed).toBeGreaterThan(0);
  });
});
