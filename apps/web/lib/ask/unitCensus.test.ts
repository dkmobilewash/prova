import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, expect, it } from "vitest";
import { stripComments } from "@/lib/ai/stripComments";

/**
 * EVERY METERED UNIT APPEARS IN THE COST PANEL.
 *
 * ── THE DEFECT THAT EARNED THIS, AND WHY NOTHING EXISTING COULD SEE IT ──
 *
 * The spec reader (#604) registered its unit in eight places that FAIL TO
 * COMPILE if one is missed — `AI_FEATURES`, `FEATURE_MODEL`, the `AiFeature`
 * enum, `AI_FEATURE_LABEL`, `AI_FEATURE_DESCRIPTION`, `AskUsageFeature`, the
 * gate census and `FEATURE_LABELS`. Every one of them was done.
 *
 * `unitDefs` in `cost-query.ts` is a ninth, and it is a hand-written array.
 * Nothing forced it, so spec pages were missing from it — and the symptom was
 * the quietest possible one: the per-FEATURE spend showed `spec-read` and its
 * tokens correctly, while the per-UNIT cost, the single figure step 2 of the AI
 * plan exists to produce, was never computed for the unit. The allowance
 * question it was meant to answer — is 1,800 spec pages a month sustainable —
 * could not be answered from a screen that looked complete.
 *
 * Found by a human clicking the page, not by any test here. That is the whole
 * reason this file exists.
 *
 * ── IT ASKS THE SECOND-LIST QUESTION, NOT THE COMPLETENESS ONE ──
 *
 * CLAUDE.md's #526 entry: *"A completeness test proves the SHARED list has
 * every member; it cannot see a consumer that has stopped reading it."* Every
 * census in this repo asserts the first. This asserts that the ledger's units
 * and the panel's units are THE SAME SET — from two sources that cannot drift
 * together, because one is a Prisma schema and the other is TypeScript.
 *
 * The schema is the right source for "what is metered": a unit exists exactly
 * when `AskAllowancePeriod` carries a column counting it. A unit someone meters
 * without a column is not metered at all.
 *
 * ── HOW IT KEEPS ITSELF HONEST ──
 *
 * Both ends are derived and both sizes are asserted against something that
 * cannot move with the pattern, because a regex matching nothing passes every
 * downstream assertion — the `scratch-cleanup-order` scar, where a parse
 * returned 180 of 181 and thirteen tests passed. Comments are stripped before
 * anything is matched, since `cost-query.ts` now DISCUSSES the missing spec row
 * at length in prose and a raw-text census would find it there and call it
 * registered. That is the #185 shape exactly.
 */

const here = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** `AskAllowancePeriod`'s `…Used` columns — the definition of a metered unit. */
function meteredUnits(): string[] {
  const schema = here("../../../../packages/db/prisma/schema/ask-allowance.prisma");
  const model = schema.match(/model AskAllowancePeriod \{([\s\S]*?)\n\}/);
  expect(model, "AskAllowancePeriod is not in ask-allowance.prisma").toBeTruthy();
  const body = stripComments(model![1]);
  const used = [...body.matchAll(/^\s*(\w+)Used\s+Int/gm)].map((m) => m[1]);

  // SIZE, against a count taken a different way: every `Used` column, however
  // it is typed. If the `Int` in the pattern above ever stops matching, this
  // disagrees instead of the set quietly shrinking to nothing.
  const loose = [...body.matchAll(/^\s*\w+Used\s/gm)].length;
  expect(
    used.length,
    `parsed ${used.length} metered units but the model declares ${loose} "…Used" fields`,
  ).toBe(loose);
  expect(used.length, "no metered units parsed at all").toBeGreaterThanOrEqual(5);
  return used;
}

/** The `key` of every unit the cost panel renders. */
function panelUnits(): string[] {
  const source = stripComments(here("./cost-query.ts"));
  const block = source.match(/const unitDefs: Unit\[\] = \[([\s\S]*?)\n  \];/);
  expect(block, "unitDefs is not in cost-query.ts in the shape this census reads").toBeTruthy();
  const keys = [...block![1].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

  // SIZE, from the number of objects in the array rather than from the key
  // pattern — two different things to get wrong.
  const entries = [...block![1].matchAll(/^\s{4}\{/gm)].length;
  expect(
    keys.length,
    `unitDefs holds ${entries} entries and this census read ${keys.length} keys`,
  ).toBe(entries);
  expect(keys.length, "no unit keys parsed at all").toBeGreaterThanOrEqual(5);
  return keys;
}

/**
 * Ledger column → panel key. The one place the two vocabularies meet.
 *
 * Named rather than inferred, because the mapping is genuinely not mechanical:
 * `pagesUsed` is the SHARED document ledger that compliance uploads and quote
 * reads both claim against, and the panel calls it `documentPages`. A census
 * that guessed by string-munging would have to be wrong about that one or be
 * taught about it anyway — so it is taught, visibly, where a reviewer can
 * disagree with it.
 */
const LEDGER_TO_PANEL: Record<string, string> = {
  questions: "questions",
  pages: "documentPages",
  planSheets: "planSheets",
  addendumPages: "addendumPages",
  specPages: "specPages",
};

group("the cost panel meters every unit the ledger counts", () => {
  it("knows how to translate every metered unit", () => {
    // A new ledger column with no entry here fails LOUDLY rather than being
    // skipped — otherwise this census would silently stop covering it, which
    // is the failure it was written to prevent, one level up.
    for (const unit of meteredUnits()) {
      expect(
        LEDGER_TO_PANEL[unit],
        `${unit}Used is metered on AskAllowancePeriod and LEDGER_TO_PANEL does not name it. ` +
          `Add it, and add the matching row to unitDefs in cost-query.ts — the per-unit cost is ` +
          `the figure the allowance decision rests on.`,
      ).toBeTruthy();
    }
  });

  it("renders a unit row for each one", () => {
    const panel = panelUnits();
    const missing = meteredUnits()
      .map((unit) => LEDGER_TO_PANEL[unit])
      .filter((key) => key !== undefined && !panel.includes(key));
    expect(
      missing,
      `metered but absent from the cost panel: ${missing.join(", ")}. The money still appears in the ` +
        `per-FEATURE table, so the screen looks complete while the cost PER UNIT is never computed — ` +
        `which is how spec pages shipped in #604.`,
    ).toEqual([]);
  });

  it("renders no unit row the ledger does not meter", () => {
    // The other direction. A panel row with no column behind it divides by a
    // number nothing maintains, and `costPerUnit` calls an invented per-unit
    // figure "the most confidently wrong number on the page".
    const known = new Set(Object.values(LEDGER_TO_PANEL));
    const orphans = panelUnits().filter((key) => !known.has(key));
    expect(orphans, `cost-panel units with no ledger column: ${orphans.join(", ")}`).toEqual([]);
  });

  it("names spec pages specifically, since that is the one that was missing", () => {
    // A named member, because a count of a set that lost its newest entry
    // looks perfectly healthy — the roll-call lesson from `counterCensus`.
    expect(meteredUnits()).toContain("specPages");
    expect(panelUnits()).toContain("specPages");
  });
});
