import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe as group, expect, it } from "vitest";
import { RUNNABLE_STAGES } from "./stages";

/**
 * EVERY STAGE THE RUNNER CAN DO, SOMETHING IN THE APP CAN START.
 *
 * ── THE DEFECT THIS EXISTS FOR, WHICH SHIPPED ──
 *
 * #551 built `TITLE_BLOCK`: a prompt, an extractor, a spend ledger, a review
 * table, an accept action, and an eval that scored nine of nine. `STAGE_WORK`
 * mapped it to real work. Unit tests drove it. And `startPlanIngest` had exactly
 * ONE call site in the whole app, hardcoding `PAGE_INVENTORY` — nothing chained
 * stages server-side either.
 *
 * So the feature could not produce a single sheet proposal in the product. The
 * panel showed a green "5 of 5 — Every sheet read" directly above a review
 * surface reading "Nothing has been read from this plan set yet", and stayed
 * that way. It was found by opening the page, which nobody had done between the
 * PR merging and this test being written.
 *
 * CLAUDE.md names this shape under Traps — "written, documented, and never
 * called" — and records three instances in a single day. Everything stays green
 * throughout, because nothing references the dead code. Typecheck cannot see it:
 * the stage is a valid enum member and the function takes the enum. The unit
 * suite cannot see it: it calls the stage directly, which is the one caller that
 * is not the product.
 *
 * ── WHAT IT CHECKS ──
 *
 * `RUNNABLE_STAGES` is already DERIVED from `STAGE_WORK` by filtering the nulls,
 * so it is the set of stages that can actually do work — no list to maintain
 * here, and a stage deliberately left unbuilt (`CLASSIFY`, `SHEET_INDEX`) is
 * absent from it by construction rather than by exemption.
 *
 * The other end is derived too: every `startPlanIngest(…, "STAGE")` literal
 * found under `app/` and `components/`, which is where a person's click has to
 * reach it from. A call in `lib/` would not count and should not — the product
 * surface is the thing being asserted.
 */

const WEB = new URL("../../", import.meta.url).pathname;
const SURFACES = ["app", "components"];

/** Comments stripped: `PlanIngestPanel.tsx` discusses the stages it starts at
 *  length, and a raw-text census would be satisfied by prose about them —
 *  #185's scar, a census disarmed by a comment quoting its own pattern. */
function sourceOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.(test|dbtest|eval)\./.test(name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Stages named as a literal argument to `startPlanIngest` on a product surface. */
function startableStages(): { stages: Set<string>; filesRead: number } {
  const stages = new Set<string>();
  let filesRead = 0;
  for (const surface of SURFACES) {
    for (const file of filesUnder(join(WEB, surface))) {
      const text = sourceOf(file);
      if (!text.includes("startPlanIngest")) continue;
      filesRead += 1;
      for (const m of text.matchAll(/startPlanIngest\s*\([^)]*?["']([A-Z_]+)["']/g)) {
        stages.add(m[1]!);
      }
    }
  }
  return { stages, filesRead };
}

group("every runnable stage is reachable from the product", () => {
  it("has stages to check and files that call the starter", () => {
    // Both vacuous-pass guards. An empty `RUNNABLE_STAGES` would make the
    // assertion below trivially true, and zero files containing the call would
    // mean the pattern is looking in the wrong place rather than finding nothing.
    expect(RUNNABLE_STAGES.length, "the runner can do some work").toBeGreaterThanOrEqual(2);
    expect(startableStages().filesRead, "some product file calls startPlanIngest").toBeGreaterThanOrEqual(1);
  });

  it("can start each one from a page or a component", () => {
    const { stages } = startableStages();
    const unreachable = RUNNABLE_STAGES.filter((stage) => !stages.has(stage));
    expect(
      unreachable,
      `these stages do work and nothing in the product starts them: ${unreachable.join(", ")}. ` +
        `A stage in STAGE_WORK with no caller is built, tested, metered and unreachable — which is exactly ` +
        `what #551 shipped. Either give it a control, or set it to null in STAGE_WORK so it is honestly unbuilt.`,
    ).toEqual([]);
  });

  it("starts nothing that cannot do work", () => {
    // The other direction: a control that starts a stage whose work is null
    // would create claimable tasks nothing can ever finish, and leave a job
    // stuck at 99% — `stages.ts` says a job stuck with one invisible task is
    // indistinguishable from a finished one.
    const { stages } = startableStages();
    const dead = [...stages].filter((stage) => !RUNNABLE_STAGES.includes(stage as never));
    expect(dead, `started but has no work in STAGE_WORK: ${dead.join(", ")}`).toEqual([]);
  });
});
