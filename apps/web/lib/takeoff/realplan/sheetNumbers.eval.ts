/**
 * ── EVERY PAGE OF A SCANNED SET: WHAT ITS SHEET NUMBER READS AS ──
 *
 * Two readings per page against a by-eye key, so a change to how the
 * number is read is a count rather than an impression:
 *   strips — what `sheetNumberFrom` finds in the tiled title-block pass (the
 *            read the stage made before the cell re-read existed);
 *   cell   — the bottom-right corner read on its own, sparse mode at 2x.
 * A third, snapping the read to the set's own vocabulary of designations,
 * was measured here on 2026-10-29 and removed: 71 → 67 of 106.
 *
 *   REAL_PLAN_DIR=… SN_SET="<file>.pdf" SN_KEY=~/…/answer-keys/sheet-numbers/<set>.json \
 *   [SN_PAGES=1,2,3] [SN_OUT=dir] \
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/sheetNumbers.eval.ts
 *
 * Keyless: no model, nothing spent. The key lives outside the repo; the
 * page numbers it holds are a client's sheet list.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rasterizeSheet } from "../raster/rasterizeSheet";

const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SN_SET ?? "";
const KEY = process.env.SN_KEY ?? "";
const OUT = process.env.SN_OUT ?? "";
const PAGES = (process.env.SN_PAGES ?? "").split(",").map(Number).filter(Boolean);

type Row = { page: number; truth: string; strips: string | null; cell: string | null; best: string | null; words: string[]; ms: number };

describe.skipIf(!DIR || !SET || !KEY)("sheet numbers on a scanned set", () => {
  it("reads every page three ways and counts them against the key", { timeout: 4 * 3_600_000 }, async () => {
    const key = JSON.parse(readFileSync(KEY, "utf8")) as { pages: Record<string, string> };
    const pages = PAGES.length > 0 ? PAGES : Object.keys(key.pages).map(Number).sort((a, b) => a - b);
    const bytes = new Uint8Array(readFileSync(join(DIR, SET)));
    const rows: Row[] = [];
    for (const page of pages) {
      const t0 = Date.now();
      const read = await rasterizeSheet(bytes.slice(), page);
      rows.push({ page, truth: key.pages[String(page)], strips: read.sheetNumberFromStrips, cell: read.sheetNumberCell, best: read.sheetNumber, words: read.text.map((t) => t.str), ms: Date.now() - t0 });
      const r = rows[rows.length - 1];
      console.log(`p${page} truth ${r.truth} · strips ${r.strips ?? "—"} · cell ${r.cell ?? "—"} · ${r.ms} ms`);
    }
    const same = (a: string | null, truth: string) => a !== null && a.replace(/\s+/g, "").toUpperCase() === truth.toUpperCase();
    const tally = (pick: (r: Row) => string | null, which: (r: Row) => boolean) => {
      const set = rows.filter(which);
      return `${set.filter((r) => same(pick(r), r.truth)).length}/${set.length}`;
    };
    const isA = (r: Row) => /^A/i.test(r.truth);
    const all = () => true;
    console.log(`\nRIGHT — strips: all ${tally((r) => r.strips, all)}, A-sheets ${tally((r) => r.strips, isA)}`);
    console.log(`RIGHT — cell:   all ${tally((r) => r.cell, all)}, A-sheets ${tally((r) => r.cell, isA)}`);
    console.log(`RIGHT — best:   all ${tally((r) => r.best, all)}, A-sheets ${tally((r) => r.best, isA)}`);
    const wrong = rows.filter((r) => !same(r.best, r.truth));
    console.log(`WRONG (${wrong.length}): ${wrong.map((r) => `p${r.page} ${r.truth}→${r.best ?? "—"}`).join(", ")}`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${SET}.sheet-numbers.json`), JSON.stringify({ set: SET, rows: rows.map((r) => ({ ...r, words: undefined })) }, null, 1));
    }
    expect(rows.length).toBeGreaterThan(0);
  });
});
