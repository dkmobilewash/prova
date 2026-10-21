import { Buffer } from "node:buffer";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/**
 * ── WHICH PLAN SETS PRINT ROOM AREAS? ──
 *
 * The rooms lane needs answer keys without new labelling. A set that prints
 * "361 SF" under its room tags IS an answer key for area-per-room. This scans
 * every page of every set in `REAL_PLAN_DIR` (held-out sets EXCLUDED by name,
 * never opened) for text items of the form `<number> SF` / `<number> SQ. FT.`
 * / `<number> m2`, and for finish-schedule titles, and prints a per-set
 * inventory. Metadata only: counts, pages, the first three area strings.
 *
 *     REAL_PLAN_DIR="$HOME/Claude Folder/takeoff/real-plans/new" \
 *       pnpm --filter @prova/web exec vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzRoomAreaInventory
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.ROOM_INVENTORY_OUT ?? "";

/** BOARD.md rules 3 and 4. Matched case-insensitively on the file name. */
const HELD_OUT = ["central-bank", "gen-bbq", "sln-terminal", "stem-bid", "lodi-memorial", "missouri-new", "nall-wealth"];

const AREA = /^\s*(\d[\d,]*(?:\.\d+)?)\s*(SF|S\.F\.|SQ\.?\s*FT\.?|SQFT|m2|m²|SM)\s*$/i;
const FINISH = /ROOM\s+FINISH|FINISH\s+SCHEDULE|ROOM\s+SCHEDULE/i;

describe.skipIf(DIR === "")("room-area inventory of the training sets", () => {
  it("counts printed areas per page", { timeout: 3_600_000 }, async () => {
    const files = readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter((f) => !HELD_OUT.some((h) => f.toLowerCase().includes(h)))
      .sort();
    const lines: string[] = [];
    const say = (s: string) => {
      lines.push(s);
      console.log(s);
    };
    say(`\n${files.length} sets scanned (held-out excluded by name)`);
    for (const file of files) {
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      const pages: { page: number; areas: number; samples: string[]; finish: boolean; items: number }[] = [];
      for (let p = 1; p <= doc.pageCount; p += 1) {
        const text = await doc.pageText(p);
        const areas = text.items.filter((i) => AREA.test(i.str));
        const finish = text.items.some((i) => FINISH.test(i.str));
        if (areas.length > 0 || finish) {
          pages.push({ page: p, areas: areas.length, samples: areas.slice(0, 3).map((a) => a.str.trim()), finish, items: text.items.length });
        }
      }
      await doc.close();
      const total = pages.reduce((n, q) => n + q.areas, 0);
      say(`\n${file}: ${doc.pageCount} pages, ${total} printed areas on ${pages.filter((q) => q.areas > 0).length} pages, finish-schedule title on ${pages.filter((q) => q.finish).length} pages`);
      for (const q of pages.filter((q) => q.areas >= 3 || q.finish).slice(0, 12)) {
        say(`  p${q.page}: ${q.areas} areas${q.finish ? " + FINISH SCHEDULE" : ""} (${q.samples.join(" | ")})`);
      }
    }
    if (OUT) writeFileSync(OUT, lines.join("\n"));
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * ROOM_INVENTORY_DETAIL="file.pdf:4,15;other.pdf:31" — for each printed area
   * on those pages, the text items stacked just above it (a room tag prints
   * NAME / NUMBER / AREA top-down), so a page can be judged as a key or not.
   */
  const DETAIL = process.env.ROOM_INVENTORY_DETAIL ?? "";
  it.skipIf(DETAIL === "")("shows the tag text above each printed area", { timeout: 600_000 }, async () => {
    for (const spec of DETAIL.split(";")) {
      const [file, pages] = spec.split(":");
      if (HELD_OUT.some((h) => file.toLowerCase().includes(h))) throw new Error(`held-out set: ${file}`);
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      for (const p of pages.split(",").map(Number)) {
        const t = await doc.pageText(p);
        const areas = t.items.filter((i) => AREA.test(i.str));
        console.log(`\n== ${file} p${p}: ${areas.length} areas, ${t.items.length} items, ${t.widthPt}x${t.heightPt}pt`);
        for (const a of areas.slice(0, 40)) {
          const near = t.items
            .filter((i) => i !== a && Math.abs(i.x + i.width / 2 - (a.x + a.width / 2)) < 60 && i.y < a.y && a.y - i.y < 4 * a.height + 2)
            .sort((u, v) => u.y - v.y)
            .map((i) => i.str.trim());
          console.log(`  ${a.str.trim().padEnd(14)} @(${a.x.toFixed(0)},${a.y.toFixed(0)}) h${a.height.toFixed(1)}  above: ${near.join(" | ")}`);
        }
      }
      await doc.close();
    }
  });
});
