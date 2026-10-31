import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { textRows } from "../existingWalls";
import { heldOutReason } from "../heldOutSets";

/**
 * ── WHICH SETS CARRY AN EXISTING OR DEMOLITION PLAN BESIDE THE NEW ONE ──
 *
 * Plan comparison needs both drawings. Every page of every labelled set is
 * read for short rows naming an existing or demolition plan; a row is a
 * heading only if it is a whole short line. Training sets are listed page by
 * page; held-out sets as a count of sets only, never named.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
export const OLD_PLAN = /^(?:\S+\s+){0,5}(?:DEMO(?:LITION)?|EXISTING|EX\.|AS[- ]BUILT)\b.{0,40}\b(?:PLAN|LAYOUT)S?\b/i;
export const NOT_FLOOR = /\b(?:ROOF|REFLECTED|RCP|CEILING|SITE|ELECTRICAL|LIGHTING|POWER|PLUMBING|MECHANICAL|HVAC|DUCT|FOUNDATION|FRAMING|GRADING|UTILITY|LANDSCAPE)\b/i;

describe.skipIf(DIR === "" || LABELS === "")("which sets have an existing or demolition plan", () => {
  it("lists them", { timeout: 3_600_000 }, async () => {
    let read = 0;
    let heldWith = 0, heldAll = 0;
    const lines: string[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      const pdf = findPdf(dir);
      if (pdf === null) continue;
      const held = heldOutReason(dir) !== null;
      const labelled = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")).map((n) => (JSON.parse(readFileSync(join(LABELS, dir, n), "utf8")) as { page: number }).page);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const hits: string[] = [];
      for (let page = 1; page <= doc.pageCount; page += 1) {
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const titles = [...new Set(textRows(items).map((r) => r.str.trim()).filter((s) => s.length <= 60 && OLD_PLAN.test(s) && !NOT_FLOOR.test(s)))];
        if (titles.length > 0) hits.push(`p${page}: ${titles.slice(0, 3).join(" | ").slice(0, 110)}`);
      }
      await doc.close();
      read += 1;
      if (held) {
        heldAll += 1;
        if (hits.length > 0) heldWith += 1;
      } else lines.push(`  ${dir.slice(0, 34)} (${doc.pageCount} pages; labelled p${labelled.join(",p")}): ${hits.length === 0 ? "none" : `\n      ${hits.slice(0, 12).join("\n      ")}`}`);
    }
    console.log(`\nTRAINING\n${lines.join("\n")}\nHELD-OUT: ${heldWith} of ${heldAll} sets have a candidate page`);
    expect(lines.length + heldAll, "no set was read").toBeGreaterThan(0);
  });
});
