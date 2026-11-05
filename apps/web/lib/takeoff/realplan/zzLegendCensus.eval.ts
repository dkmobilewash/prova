import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { legendPages, type PageForLegend } from "../legendPages";
import { nameSheet } from "./nameSheet";

/**
 * ── WHICH PAGES THE LEGEND READ WOULD SEND, ON ONE SET, WITH NO MODEL CALL ──
 *
 * The WALL_LEGEND stage reads every page `legendPages` ranks at 2 or better
 * (`LEGEND_RANK_CEILING`, one model call each). This ranks a set's pages the
 * same way — titles from `nameSheet`, the keyless reader the inventory uses —
 * and appends one line to `LC_OUT`: how many pages, which would be read and
 * why, and nothing else. A set with none has no partition legend the stage
 * can find. Held-out sets are listed like any other: this decides nothing.
 */
const PDF = process.env.LC_PDF ?? "";
const OUT = process.env.LC_OUT ?? "";
const CEILING = 2;

async function linesOf(doc: Awaited<ReturnType<typeof openPlanPdf>>, page: number): Promise<string[]> {
  const text = await doc.pageText(page);
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of text.items) {
    if (item.str.trim() === "") continue;
    const key = Math.round(item.y / 6);
    rows.set(key, [...(rows.get(key) ?? []), { x: item.x, str: item.str }]);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((c) => c.str.trim()).join(" | ").replace(/\s+/g, " ").trim()).filter((l) => l !== "");
}

describe.skipIf(PDF === "" || OUT === "")("the legend pages of one set", () => {
  it("ranks every page", { timeout: 3_600_000 }, async () => {
    const doc = await openPlanPdf(Buffer.from(readFileSync(PDF)));
    const pages: PageForLegend[] = [];
    for (let page = 1; page <= doc.pageCount; page += 1) {
      try {
        const lines = await linesOf(doc, page);
        const text = await doc.pageText(page);
        const named = nameSheet(text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })), { widthPt: text.widthPt, heightPt: text.heightPt });
        pages.push({ page, title: `${named.number} ${named.title}`.trim() || null, lines });
      } catch {
        // an unreadable page is not a legend
      }
    }
    const read = legendPages(pages).filter((c) => c.rank <= CEILING);
    appendFileSync(OUT, JSON.stringify({ set: basename(PDF), heldOut: heldOutReason(basename(PDF)) !== null, pages: doc.pageCount, read: read.map((c) => ({ page: c.page, rank: c.rank, why: c.why.slice(0, 120) })) }) + "\n");
    expect(pages.length, "no page of the set could be read").toBeGreaterThan(0);
  });
});
