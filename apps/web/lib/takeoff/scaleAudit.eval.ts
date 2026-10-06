import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agreementRate,
  auditPlanFile,
  auditTargets,
  planFilesUnder,
  summarise,
  type AuditPage,
} from "./scaleAudit";

/**
 * AUTOMATIC SCALE, OVER WHATEVER DRAWINGS YOU POINT IT AT.
 *
 *     SCALE_AUDIT=~/Downloads/some-bid-package pnpm scale:audit
 *     SCALE_AUDIT="~/Downloads/a.pdf,~/Downloads/b.pdf" pnpm scale:audit
 *     SCALE_AUDIT=~/Downloads/pkg SCALE_AUDIT_QUIET=1 pnpm scale:audit
 *
 * Reads only. It writes nothing, stores nothing and sends nothing anywhere — the
 * files it is pointed at are real customer bid packages, and *"never use real
 * customer files in tests or fixtures"* means a tool aimed at them rather than
 * anything that keeps a copy. Nothing it reads enters the repo.
 *
 * ── WHY IT EXISTS, AND WHY IT IS AN EVAL RATHER THAN A TEST ──
 *
 * `scaleFromDimensions` was built against ONE real export, and the part tuned on
 * it is the riskiest: the rule that a dimension label sits centred on the line it
 * measures, within a fixed distance of it. That is how one program draws
 * dimensions. Revit, AutoCAD, Vectorworks and ArchiCAD each place the text a
 * little differently, and if one puts it further off the line this feature
 * DECLINES on every sheet from that program — which looks like nothing rather
 * than like a bug.
 *
 * The suite cannot hold those files, so what CI holds is
 * `scaleFromDimensions.test.ts` — the arithmetic across all twelve scales and
 * every refusal path, on sheets this repo generates. This is the other half, run
 * by hand by whoever has drawings, and it lives here with a name in
 * `package.json` so that costs ONE COMMAND rather than an afternoon of throwaway
 * code every time a new program turns up. It SKIPS with nothing set, so it is
 * never a suite that fails for want of files.
 *
 * ── THE ANSWER KEY IS ALREADY ON THE SHEET ──
 *
 * See `scaleAudit.ts`: most sheets print their scale in the title block, which
 * makes two independent readings of one fact, and comparing them needs no model
 * and no spend. The headline is the agreement rate over pages where BOTH
 * readings exist — the only ones where agreement means anything.
 *
 * ── HOW TO READ IT ──
 *
 * `AGREES`         both readings, same scale. The result.
 * `DISAGREES`      both readings, different scales. **Open this sheet.**
 * `MISSED`         the title block names a scale and the geometry declined —
 *                  there was an answer and it was not found.
 * `NO_TITLE_SCALE` derived a scale; the sheet prints none to check against. NOT
 *                  a failure: the export this feature was built from prints no
 *                  scale anywhere machine-readable.
 * `DECLINED`       neither reading found anything. Usually a cover sheet or a
 *                  detail page, and the right answer.
 * `ERROR`          the page could not be read.
 */

const QUIET = process.env.SCALE_AUDIT_QUIET === "1";

// Path handling lives in `scaleAudit.ts` and is tested there, so that "you
// pointed me at nothing" is a behaviour with a test rather than one assertion in
// a hand-run script. See `planFilesUnder`.
const targets = auditTargets(process.env.SCALE_AUDIT ?? "");
const files = planFilesUnder(targets);

describe.skipIf(targets.length === 0)("automatic scale, over real drawings", () => {
  it("reports every page", async () => {
    // THE RUN'S OWN CONTROL, before any figure is read off it: a path that
    // matched no PDF would otherwise report a clean nothing, and "no
    // disagreements" over zero pages is the vacuous green this repo writes
    // censuses to end.
    expect(files.length, `no PDFs found under: ${targets.join(", ")}`).toBeGreaterThan(0);

    const all: AuditPage[] = [];
    const lines: string[] = [`scale audit — ${files.length} file${files.length === 1 ? "" : "s"}`, ""];

    for (const file of files) {
      const label = basename(file);
      let pages: AuditPage[];
      try {
        pages = await auditPlanFile(label, readFileSync(file));
      } catch (error) {
        lines.push(`${label}: could not be opened — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      all.push(...pages);

      if (!QUIET) {
        for (const page of pages) {
          const size = `${(page.widthPt / 72).toFixed(0)}x${(page.heightPt / 72).toFixed(0)}in`;
          const band = page.inheritedError === null ? "" : `${(page.inheritedError * 100).toFixed(2)}%`;
          lines.push(
            `  p${String(page.pageNumber).padStart(3)} ${page.outcome.padEnd(15)}` +
              `${(page.derived ?? "—").padEnd(16)} title:${(page.printed ?? "—").padEnd(16)} ` +
              `dims ${String(page.agreed).padStart(2)}/${String(page.found).padEnd(3)} ${band.padStart(6)} ${size}`,
          );
          // Printed only for the two outcomes worth acting on, so a 100-page run
          // does not bury them.
          if (page.reason && (page.outcome === "MISSED" || page.outcome === "ERROR")) {
            lines.push(`       ${page.reason}`);
          }
        }
      }
      const s = summarise(pages);
      lines.push(
        `${label} — ${s.pages}pp  agrees ${s.AGREES}  disagrees ${s.DISAGREES}  ` +
          `noTitleScale ${s.NO_TITLE_SCALE}  missed ${s.MISSED}  declined ${s.DECLINED}  error ${s.ERROR}`,
        "",
      );
    }

    const total = summarise(all);
    const rate = agreementRate(all);
    lines.push(
      "─".repeat(78),
      `TOTAL ${total.pages} pages across ${files.length} file${files.length === 1 ? "" : "s"}`,
      `  agrees ${total.AGREES}   disagrees ${total.DISAGREES}   noTitleScale ${total.NO_TITLE_SCALE}   ` +
        `missed ${total.MISSED}   declined ${total.DECLINED}   error ${total.ERROR}`,
      rate === null
        ? "  agreement: NOT MEASURABLE — no page had both a derived and a printed scale."
        : `  agreement where both readings exist: ${(rate * 100).toFixed(1)}%  ` +
          `(${total.AGREES} of ${total.AGREES + total.DISAGREES + total.MISSED})`,
    );

    // EVERY DISAGREEMENT NAMED. One wrong scale on one sheet is the whole risk
    // this feature carries, and a percentage hides it.
    const wrong = all.filter((p) => p.outcome === "DISAGREES");
    if (wrong.length > 0) {
      lines.push("", "DISAGREEMENTS — open these:");
      for (const page of wrong) {
        lines.push(`  ${page.file} p${page.pageNumber}: derived ${page.derived}, title block says ${page.printed}`);
      }
    }

    console.log("\n" + lines.join("\n") + "\n");

    // The run REPORTS rather than judges, deliberately: a threshold picked now,
    // before anybody has seen a second CAD program's output, would be a number
    // invented to pass. What the run must not do is look clean having read
    // nothing, and the control above is what holds that.
    expect(total.pages).toBeGreaterThan(0);
  }, 1_800_000);
});
