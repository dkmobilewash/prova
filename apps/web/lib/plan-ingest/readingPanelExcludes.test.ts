/**
 * THE READING PANEL EXCLUDES EVERY BACKGROUND STAGE, NOT WHICHEVER ONE WAS
 * WRITTEN LAST.
 *
 * #820 (whole-set walls) and #825 (scanned sheets) each added a background
 * stage with its own panel, and each taught the sheet-reading panel to exclude
 * its stage so one feature's run could not surface in the other's panel. Alone,
 * both were right. Merged, the two lines collided on the same argument — and
 * EITHER side taken as written reintroduces the bug the other PR exists to fix,
 * because `{ not: X }` names one stage and there are now two to exclude.
 *
 * That is why this reads the PAGE rather than the function: the defect is not
 * in `latestIngestFor`, which did what it was asked. It is in what the page
 * asks for, and nothing else in this repo can see a wrong argument there — the
 * screen suite does not render this server component, and a one-stage
 * exclusion is perfectly valid code.
 *
 * Comments are stripped before matching, per `clerkMountGate.test.ts`: this
 * file's own prose names the strings being forbidden, and so does the page's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = new URL("../../app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx", import.meta.url).pathname;
const CLAIM = new URL("./claim.ts", import.meta.url).pathname;

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = strip(readFileSync(PAGE, "utf8"));
const claim = strip(readFileSync(CLAIM, "utf8"));

/** Every stage that runs in the background and owns its own panel. */
const BACKGROUND_STAGES = ["WALLS", "RASTER"] as const;

describe("the sheet-reading panel's ingest query", () => {
  it("read a page that really does call latestIngestFor", () => {
    // Without this the assertions below pass over an empty question.
    const calls = page.match(/latestIngestFor\(/g) ?? [];
    expect(calls.length, "the page does not call latestIngestFor at all").toBeGreaterThanOrEqual(3);
  });

  it("excludes EVERY background stage, in one exclusion", () => {
    const exclusion = page.match(/latestIngestFor\([^)]*\{\s*not:\s*(\[[^\]]*\]|"[A-Z_]+")\s*\}/);
    expect(exclusion, "no exclusion-shaped latestIngestFor call found").not.toBeNull();
    const named = exclusion![1];
    for (const stage of BACKGROUND_STAGES) {
      expect(named, `the reading panel does not exclude ${stage}, so a ${stage} run will surface in it`).toContain(
        stage,
      );
    }
  });

  it("still gives each background panel its own single-stage query", () => {
    for (const stage of BACKGROUND_STAGES) {
      expect(page, `${stage}'s own panel lost its query`).toContain(`latestIngestFor(plan.id, "${stage}")`);
    }
  });

  it("latestIngestFor builds a notIn for a list, not a not", () => {
    // Prisma spells a multi-value exclusion `notIn`; `{ not: [...] }` is not a
    // filter it accepts, so a list has to take its own branch.
    expect(claim).toMatch(/Array\.isArray\(stage\.not\)/);
    expect(claim).toMatch(/notIn:\s*stage\.not/);
  });
});
