import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { SheetRow } from "../../plan-ingest/sheetIndex";
import { UNFILED, buildSheetTree, disciplineName } from "../sheetTree";
import { nameSheet } from "./nameSheet";

/**
 * ── THE SHEET TREE, ON REAL SETS ──
 *
 * `sheetTree.test.ts` proves the grouping rules against sixteen cases somebody
 * wrote. This asks the only question those cannot: what happens when the rules
 * meet twenty-nine and a hundred and seventy-five sheets nobody controlled.
 *
 * It answers three things the Phase 1 screenshots could not, because the e2e
 * harness stubs the blob store so ingest never runs and every sheet there
 * files under "Not filed":
 *
 *   1. how many real sheets fall into UNFILED, and WHY — no number read, or a
 *      number whose prefix is not a discipline;
 *   2. whether the numbers and titles read correctly at all, which this repo
 *      has already been burned by once: `titleBlockText` in reading order gave
 *      titles like "DRAWN BY: MC CHECKED BY: BBL" and every sheet defaulted to
 *      "floor plan";
 *   3. what the groups actually come out as, in the standard's order.
 *
 * ── IT CALLS NO MODEL ──
 *
 * The product's own ingest reads a title block with one, but the glyph-height
 * reader in `nameSheet.ts` does not, and it is what identified the floor plans
 * in this folder in the first place. So this runs with no key and its findings
 * are about the GROUPING, not about the model's reading.
 *
 * ── THE DRAWINGS ARE A CLIENT'S AND STAY OUTSIDE THE REPOSITORY ──
 *
 * Read in place from `REAL_PLAN_DIR`, report written to `REAL_PLAN_OUT`,
 * nothing copied and no fixture derived. With no `REAL_PLAN_DIR` the file
 * skips loudly rather than passing on nothing.
 *
 *   REAL_PLAN_DIR="/path/to/sets" npx vitest run lib/takeoff/realplan/sheetTreeReal.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.REAL_PLAN_OUT ?? "/tmp/prova-real-plan";

/** Letters the National CAD Standard defines; see `sheetTree.ts`. */
const KNOWN = new Set("GHVBCLSAIQFPDMEWTRXZ".split(""));

type PageName = { page: number; number: string; title: string };

function rowsFrom(named: readonly PageName[]): SheetRow[] {
  return named.map((entry) => ({
    pageNumber: entry.page,
    hasTextLayer: true,
    proposal:
      entry.number === "" && entry.title === ""
        ? null
        : {
            id: `p${entry.page}`,
            sheetNumber: entry.number || null,
            title: entry.title || null,
            // DELIBERATELY NULL. The product's ingest fills `discipline` with
            // a model's answer; this eval is measuring what the PREFIX rule
            // does on its own, which is the fallback every set without a
            // finished ingest actually uses.
            discipline: null,
            pageType: null,
            scale: null,
            revision: null,
            issueDate: null,
            reason: "",
            confidence: "HIGH",
            status: "PROPOSED",
            acceptedSheetNumber: null,
            acceptedTitle: null,
          },
  })) as SheetRow[];
}

describe.skipIf(DIR === "")("the sheet tree on real plan sets", () => {
  it("groups them, and says what it could not place", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    expect(files.length, `no PDFs under ${DIR} — this eval would report a clean nothing`).toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });

    const lines: string[] = ["# The sheet tree on real sets", ""];
    const namesBySet: Record<string, PageName[]> = {};

    for (const file of files.sort()) {
      const label = basename(file, ".pdf");
      const doc = await openPlanPdf(readFileSync(join(DIR, file)));
      const named: PageName[] = [];
      try {
        for (let page = 1; page <= doc.pageCount; page += 1) {
          try {
            const text = await doc.pageText(page);
            const { number, title } = nameSheet(
              text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })),
              { widthPt: text.widthPt, heightPt: text.heightPt },
            );
            named.push({ page, number, title });
          } catch {
            // A page whose text will not read is a page with no number, which
            // is a finding rather than an error — it files under UNFILED and
            // the report counts it.
            named.push({ page, number: "", title: "" });
          }
        }
      } finally {
        await doc.close?.();
      }

      expect(named.length, `${label} produced no pages`).toBeGreaterThan(0);
      namesBySet[file] = named;

      const rows = rowsFrom(named);
      const tree = buildSheetTree({
        rows,
        calibratedPages: new Set(),
        printedScaleByPage: {},
        measurementCountByPage: {},
        bookmarks: new Set(),
      });

      const unfiled = tree.find((group) => group.key === UNFILED)?.sheets ?? [];
      const noNumber = unfiled.filter((sheet) => !sheet.sheetNumber).length;
      const oddPrefix = unfiled.length - noNumber;
      const unknownLetters = tree
        .filter((group) => group.key !== UNFILED && !KNOWN.has(group.key))
        .map((group) => `${group.key}(${group.sheets.length})`);

      lines.push(
        `## ${label}`,
        "",
        `- pages: **${named.length}**`,
        `- groups: ${tree.map((g) => `${g.key} ${g.sheets.length}`).join(" · ")}`,
        `- NOT FILED: **${unfiled.length}** — ${noNumber} with no number read, ${oddPrefix} whose prefix is not a letter`,
        `- letters outside the standard: ${unknownLetters.length ? unknownLetters.join(", ") : "none"}`,
        "",
        "| page | number | title | group |",
        "| ---: | --- | --- | --- |",
      );
      for (const group of tree) {
        for (const sheet of group.sheets) {
          lines.push(
            `| ${sheet.pageNumber} | ${sheet.sheetNumber ?? "—"} | ${(sheet.title ?? "—").slice(0, 60)} | ${
              group.key === UNFILED ? "NOT FILED" : `${group.key} ${disciplineName(group.key)}`
            } |`,
          );
        }
      }
      lines.push("");

      // eslint-disable-next-line no-console -- this eval's output IS its report.
      console.log(
        `[tree] ${label}: ${named.length} pages · ${tree.length} groups · ${unfiled.length} not filed ` +
          `(${noNumber} unnumbered, ${oddPrefix} odd prefix)` +
          (unknownLetters.length ? ` · outside the standard: ${unknownLetters.join(", ")}` : ""),
      );
    }

    const report = join(OUT, "sheet-tree-real.md");
    writeFileSync(report, lines.join("\n"));

    /**
     * ── AND A JSON SIDECAR, FOR THE BROWSER SPEC ──
     *
     * `e2e/specs/takeoff-tree-real.spec.ts` seeds these names and photographs
     * the tree. It cannot read them itself: parsing ELEVEN03's 340 MB in the
     * same worker that has already parsed another set dies with `Zone
     * Allocation failed`, a V8 allocator the heap flag does not govern. This
     * process does nothing else, so it can.
     *
     * Producer and consumer, rather than one process doing both — and the
     * sidecar lives beside the report, OUTSIDE the repository, because sheet
     * numbers and titles are the client's drawing.
     */
    writeFileSync(join(OUT, "sheet-names.json"), JSON.stringify(namesBySet, null, 2));
    // eslint-disable-next-line no-console -- ditto.
    console.log(`[tree] report: ${report}`);
  }, 900_000);
});
