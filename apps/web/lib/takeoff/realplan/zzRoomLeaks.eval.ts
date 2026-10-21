import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { leakHints } from "../roomLeaks";
import type { FoundWall } from "../roomsFromWalls";

/**
 * ── MISSED-WALL HINTS FOR THE FINDER LANE ──
 *
 * Reads the BOUNDARY dumps `zzRoomDetect.eval.ts` wrote for the real sheets
 * (`boundary__<set>__<sheet>.json`: the walls it used, the page, the scale)
 * and, for every leaking room tag, finds the single wall extension that
 * closes it. Writes `ROOM_LEAKS_OUT` as markdown: sheet, tag, where the
 * wall end is (feet from the page's left and top, and page-width units),
 * which way, how far, and what the room then measures.
 *
 * Only tags that look like rooms are explained: a number AND a name of
 * three letters or more. Keynote bubbles and sheet references leak too and
 * are nobody's wall.
 */
const DUMPS = process.env.ROOM_DETECT_OUT ?? "";
const OUT = process.env.ROOM_LEAKS_OUT ?? "";
const SHEETS = (process.env.ROOM_LEAKS_SHEETS ?? "boundary__BUNKIE-BID-DRAWINGS__A100,boundary__BUNKIE-BID-DRAWINGS__A104,boundary__2025.07.08_Baker_EOC_BID__A101,boundary__SW-Grand-Junction-CO__A110").split(",");

describe.skipIf(DUMPS === "")("missed-wall hints", () => {
  it("explains each leak on the real sheets", { timeout: 3_600_000 }, async () => {
    const lines: string[] = ["# Missed-wall hints from room leaks", "", `Generated ${new Date().toISOString().slice(0, 16)} by zzRoomLeaks.eval.ts from the BOUNDARY runs. A hint is the single wall end whose straight extension closes the leaking room. "no single extension" = a whole wall or two gaps are missing — look at the crop instead.`, ""];
    let hinted = 0;
    for (const name of SHEETS) {
      const d = JSON.parse(readFileSync(join(DUMPS, `${name}.json`), "utf8")) as {
        pdf: string;
        set: string;
        sheet: string;
        page: number;
        widthPt: number;
        feetPerUnit: number;
        walls: FoundWall[];
      };
      if (OUT) appendFileSync(`${OUT}.progress`, `${new Date().toISOString().slice(11, 19)} start ${d.sheet} ${d.walls.length} walls\n`);
      const doc = await openPlanPdf(Buffer.from(readFileSync(d.pdf)));
      const text = await doc.pageText(d.page);
      await doc.close();
      const hints = leakHints({
        walls: d.walls,
        feetPerUnit: d.feetPerUnit,
        text: text.items,
        widthPt: d.widthPt,
        only: (t) => t.number !== null && /(?:[A-Za-z].*){3}/.test(t.name) && !/^\d+\.$/.test(t.name),
        onTag: (t, ms, tried) => {
          const line = `  ${d.sheet} ${t.number}: ${ms} ms over ${tried} nearby walls`;
          console.log(line);
          if (OUT) appendFileSync(`${OUT}.progress`, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
        },
      });
      lines.push(`## ${d.set} ${d.sheet} (page ${d.page}, ${d.walls.length} boundary walls)`, "");
      lines.push("| tag | at (ft from left, top) | hint: wall end (ft from left, top) | direction | length | room then |", "|---|---|---|---|---|---|");
      for (const h of hints) {
        const f = (u: number) => (u * d.feetPerUnit).toFixed(1);
        const tagAt = `${f(h.tag.x)}, ${f(h.tag.y)}`;
        if (!h.hint) {
          lines.push(`| ${h.tag.number} ${h.tag.name} | ${tagAt} | no single extension closes it | | | |`);
          continue;
        }
        hinted += 1;
        const dir = Math.abs(h.hint.dx) > Math.abs(h.hint.dy) ? (h.hint.dx > 0 ? "→ right" : "← left") : h.hint.dy > 0 ? "↓ down" : "↑ up";
        lines.push(`| ${h.tag.number} ${h.tag.name} | ${tagAt} | ${f(h.hint.x)}, ${f(h.hint.y)} (units ${h.hint.x.toFixed(4)}, ${h.hint.y.toFixed(4)}) | ${dir} | ${h.hint.lengthFeet} ft | ${h.hint.squareFeet.toFixed(0)} sf |`);
      }
      lines.push("");
      console.log(`${d.set} ${d.sheet}: ${hints.length} leaking room tags, ${hints.filter((h) => h.hint).length} with a single-extension hint`);
    }
    if (OUT) writeFileSync(OUT, lines.join("\n"));
    console.log(lines.join("\n"));
    expect(hinted).toBeGreaterThanOrEqual(0);
  });
});
