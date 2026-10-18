import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { readLayers } from "./layerProbe";

/**
 * THE RUNNER for `layerProbe.ts`, whose header carries the reasoning.
 *
 *     REAL_PLAN_PDF="/path/to/a real set.pdf" REAL_PLAN_PAGES=1,21,30 \
 *       pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/layers.eval.ts
 *
 * Split from the reader so the reader can be TESTED against a PDF this repo
 * wrote — a probe nobody has proved can see a layer would report `0 layers` on
 * every file in the world and read as a finding.
 */

const PDF = process.env.REAL_PLAN_PDF ?? "";
const PAGES = (process.env.REAL_PLAN_PAGES ?? "1")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 1);

describe.skipIf(PDF === "")("what a real plan set says about its own layers", () => {
  // SKIPPED RATHER THAN PASSING ON NOTHING, which `harness.test.ts` holds every
  // keyless eval to: a run with no `REAL_PLAN_PDF` must not score a clean zero
  // and read as "no plan set has layers".
  it(`reads the layers off ${PDF === "" ? "nothing" : basename(PDF)}`, async () => {
    const bytes = readFileSync(PDF);
    const pages = await readLayers(bytes, PAGES);
    // THE INPUT RESOLVED TO SOMETHING. A mistyped path or a page number past
    // the end would otherwise print an empty report that looks like a finding.
    expect(pages.length).toBeGreaterThan(0);

    const lines: string[] = ["", `${basename(PDF)} — ${pages.length} page(s) read`, ""];
    for (const page of pages) {
      const share =
        page.pathOperators === 0
          ? "—"
          : `${((page.underOptionalContent / page.pathOperators) * 100).toFixed(0)}%`;
      lines.push(
        `page ${page.pageNumber}: ${page.pathOperators} path operators, ` +
          `${page.underOptionalContent} on a layer (${share}), ${page.byLayer.length} layer(s)`,
      );
      // THE CONTROL. Zero path operators means a scan or a failed read, and
      // without saying so "this file has no layers" would be the wrong lesson
      // drawn from the right number.
      if (page.pathOperators === 0) {
        lines.push("    no vector geometry at all — a scan, or the page did not parse");
      } else if (page.byLayer.length === 0) {
        lines.push("    no optional content: this export carries no layer information");
      }
      for (const layer of page.byLayer.slice(0, 25)) {
        lines.push(`    ${layer.visible ? " " : "✗"} ${layer.name.padEnd(28)} ${layer.pathOperators}`);
      }
      if (page.byLayer.length > 25) lines.push(`    … and ${page.byLayer.length - 25} more`);
      lines.push("");
    }
    lines.push("✗ marks a layer the drawing has switched OFF — drawn in the file, not on the sheet.");
    lines.push("");
    console.log(lines.join("\n"));
  });
});
