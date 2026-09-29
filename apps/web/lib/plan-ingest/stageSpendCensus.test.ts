import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlanIngestStage } from "@prova/db";
import { stripComments } from "@/lib/ai/stripComments";
import { RUNNABLE_STAGES, STAGE_SPENDS } from "./stages";

/**
 * `STAGE_SPENDS` SAYS WHAT THE CODE DOES, NOT WHAT SOMEBODY REMEMBERED.
 *
 * That map decides what a Retry button does: a free stage gets its three attempts
 * back, a paid one gets exactly one per click so the click and the charge stay one to
 * one. Getting it wrong in the safe direction makes Retry stingy; getting it wrong the
 * other way restores the defect it was written to fix — one click buying three paid
 * attempts, with the counter resettable without limit.
 *
 * A total `Record` forces a DECISION when a stage is added. It cannot force a CORRECT
 * one, which is what this file is for: the answer is derived from the stage's own
 * implementation and the declaration has to match.
 *
 * WHAT MAKES A STAGE PAID IS THE CLAIM, NOT THE CALL, and that is the definition
 * worth being precise about. A stage could call a model without spending the plan-sheet
 * ledger, or claim and then fail before calling — the ledger is what a person's
 * allowance is measured in, and `claimPlanSheet` is the only way to move it. So that
 * is what this looks for. A stage that starts claiming has to say so here before it
 * compiles a second time.
 */

const HERE = fileURLToPath(new URL("./", import.meta.url));

/**
 * Which file implements each runnable stage, read out of `stages.ts` rather than
 * listed here.
 *
 * `STAGE_WORK` maps a stage to a factory and the imports say which module each
 * factory comes from, so both halves are derived. A list in this file would be the
 * third place the same fact is written, and the one nobody updates.
 */
function implementationOf(stage: PlanIngestStage): string {
  const stages = stripComments(readFileSync(`${HERE}stages.ts`, "utf8"));

  const entry = new RegExp(`${stage}:\\s*([A-Za-z0-9_]+)\\s*,`).exec(stages);
  expect(entry, `stages.ts has no STAGE_WORK entry naming a factory for ${stage}`).not.toBeNull();
  const factory = entry![1]!;

  const imported = new RegExp(`import\\s*\\{[^}]*\\b${factory}\\b[^}]*\\}\\s*from\\s*["']\\./([A-Za-z0-9_]+)["']`).exec(
    stages,
  );
  expect(imported, `stages.ts names ${factory} for ${stage} but does not import it from a sibling module`).not.toBeNull();
  return `${HERE}${imported![1]!}.ts`;
}

/** Does this stage's implementation claim from the paid ledger? */
function spends(stage: PlanIngestStage): boolean {
  const code = stripComments(readFileSync(implementationOf(stage), "utf8"));
  return /\bclaimPlanSheet\b/.test(code);
}

describe("what a stage spends, derived from what it does", () => {
  it("resolved a real implementation for every runnable stage", () => {
    // THE SIZE ASSERTION, and here it is a SCOPE assertion too: a stage whose file
    // cannot be found must fail loudly rather than be skipped, because a stage
    // dropped from the walk can never be missing from it. #265's lesson — nothing is
    // ever missing from a directory you do not look in.
    expect(RUNNABLE_STAGES.length, "no runnable stages found — the derivation broke").toBeGreaterThan(0);
    for (const stage of RUNNABLE_STAGES) {
      const file = implementationOf(stage);
      expect(() => readFileSync(file, "utf8"), `${stage} resolves to ${file}, which does not exist`).not.toThrow();
    }
  });

  it("AGREES WITH THE DECLARATION for every runnable stage", () => {
    const wrong: string[] = [];
    for (const stage of RUNNABLE_STAGES) {
      const derived = spends(stage);
      if (derived !== STAGE_SPENDS[stage]) {
        wrong.push(
          `${stage}: STAGE_SPENDS says ${STAGE_SPENDS[stage]}, but its implementation ` +
            `${derived ? "DOES" : "does not"} claim a plan sheet`,
        );
      }
    }
    expect(
      wrong,
      "a stage that spends must be declared as spending, or one click on Retry buys it three paid attempts — " +
        "and each retry resets the ceiling, so there is no ceiling at all",
    ).toEqual([]);
  });

  it("declares an unbuilt stage as spending nothing", () => {
    // A stage with no work cannot spend, so anything else here is a typo with a
    // consequence: it would make Retry stingy on a stage that costs nothing, which is
    // the harmless direction and therefore the one nobody would notice.
    const built = new Set<PlanIngestStage>(RUNNABLE_STAGES);
    for (const [stage, paid] of Object.entries(STAGE_SPENDS) as [PlanIngestStage, boolean][]) {
      if (built.has(stage)) continue;
      expect(paid, `${stage} is not built, so it cannot spend anything`).toBe(false);
    }
  });

  it("finds the claim when there IS one — the pattern is not matching nothing", () => {
    // The mutation this file most needs and cannot perform on itself: prove the
    // detector recognises a claim, so a rename of `claimPlanSheet` that makes every
    // stage look free fails here rather than passing everything downstream.
    const paid = RUNNABLE_STAGES.filter((stage) => spends(stage));
    expect(
      paid,
      "no runnable stage claims a plan sheet — either TITLE_BLOCK stopped metering, or this " +
        "census stopped being able to see that it does",
    ).toContain("TITLE_BLOCK");
  });
});
