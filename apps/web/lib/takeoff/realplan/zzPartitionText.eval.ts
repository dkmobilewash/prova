import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/**
 * ── WHAT A REAL PARTITION SCHEDULE ACTUALLY SAYS ──
 *
 * Before anything parses a partition row into components, somebody has to read
 * one. `wallTags.ts` records that the set it was written against had NO
 * partition schedule at all — "its A-601 sheets are a DOOR SCHEDULE and a
 * WINDOW SCHEDULE, and zero thickness strings appear on any page" — so the
 * shape of the text is not something to assume from memory of other drawings.
 *
 * This prints the text of the pages named, grouped into lines, so the next
 * step is written against words somebody has seen.
 *
 *     REAL_PLAN_DIR=… PT_SHEETS="<file>:16" npx vitest run \
 *       --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzPartitionText.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.PT_SHEETS ?? "").trim();
/** Only lines containing one of these, unless PT_ALL is set. */
const INTERESTING = process.env.PT_RE !== undefined ? new RegExp(process.env.PT_RE, "i") :
  /\b(STUD|GYP|GWB|BOARD|TYPE\s*X|BATT|INSUL|MTL|METAL|O\.?C\.?|RATED|UL\b|STC|TRACK|SHAFT|FURR|PARTITION|LAYER|THICK)\b/i;

describe.skipIf(DIR === "" || SHEETS === "")("what a partition schedule says", () => {
  it("prints the lines", { timeout: 1_800_000 }, async () => {
    const pagesSeen: number[] = [];
    for (const token of SHEETS.split(";").filter((t) => t.includes(":"))) {
      const at = token.lastIndexOf(":");
      const file = token.slice(0, at);
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      const asked = token.slice(at + 1);
      const pages =
        asked.trim() === "*"
          ? [...Array(doc.pageCount).keys()].map((i) => i + 1)
          : asked.split(",").map(Number);
      for (const page of pages) {
        const text = await doc.pageText(page);
        pagesSeen.push(page);
        // Group items into lines by y, then order by x — the same idea
        // `scheduleTable.ts` uses, kept simple because this only has to be
        // readable by a person.
        const rows = new Map<number, { x: number; str: string }[]>();
        for (const item of text.items) {
          if (item.str.trim() === "") continue;
          const key = Math.round(item.y / 6);
          rows.set(key, [...(rows.get(key) ?? []), { x: item.x, str: item.str }]);
        }
        const lines = [...rows.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, cells]) =>
            cells
              .sort((a, b) => a.x - b.x)
              .map((c) => c.str.trim())
              .join(" | ")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter((line) => line !== "");
        const show = process.env.PT_ALL === "1" ? lines : lines.filter((l) => INTERESTING.test(l));
        // In SURVEY mode print one line per page and only where the page
        // carries enough assembly words to BE a partition legend — scanning
        // 250 pages otherwise buries the answer in the question.
        const floor = Number(process.env.PT_MIN ?? "0");
        if (show.length < floor) continue;
        // eslint-disable-next-line no-console
        console.log(
          `\n${file.slice(0, 26)} p${page} — ${text.items.length} items, ${lines.length} lines, ` +
            `${show.length} assembly lines\n` +
            show
              .slice(0, Number(process.env.PT_LINES ?? "70"))
              .map((l) => `  ${l.slice(0, 150)}`)
              .join("\n"),
        );
      }
    }
    // The input resolved: a REAL_PLAN_DIR or a PT_SHEETS naming no real file
    // would otherwise print nothing and pass as a quiet success.
    expect(
      pagesSeen.length,
      "no page was read at all — check REAL_PLAN_DIR and PT_SHEETS",
    ).toBeGreaterThan(0);
  });
});
