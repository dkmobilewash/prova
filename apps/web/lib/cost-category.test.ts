import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COST_CATEGORY_VALUES,
  EQUIPMENT_SPLIT_NOTE,
  EQUIPMENT_SPLIT_ON,
  asCostCategory,
  costCategoryLabel,
} from "./cost-category";
import {
  COST_CATEGORY_VALUES as RECAP_VALUES,
  bidRecap,
  directCostByCategory,
  RECAP_RATE_KEYS,
  type CostCategoryValue,
  type RecapLine,
  type RecapRates,
} from "./bid-recap";
import { COST_CATEGORY_ORDER } from "@/components/costCategoryLabels";

/**
 * ONE LIST, AND THE NaN THAT PROVED WHY.
 *
 * `CostCategory` is a Prisma enum and three separate files each kept their
 * own hand-written union over it. Only one had a test reading the schema.
 * The measured consequence of a fifth value, from the real function:
 *
 *   byCategory: {"MATERIAL":1200,…,"EQUIPMENT":null}
 *   total: NaN
 *
 * A $2,500 equipment line and $1,200 of material producing a direct cost of
 * NaN instead of $3,700 — on the document somebody prices work from, and it
 * serialises to blank rather than to anything that looks wrong.
 *
 * These tests exist so the shape cannot come back: one list, no cast, and
 * an accumulator that cannot be handed a key it does not have.
 */

/**
 * A category the enum does not have — and ASSERTED not to have, in the test
 * below, rather than assumed.
 *
 * READ THIS BEFORE CHANGING IT. The previous version of this file used
 * "EQUIPMENT" as its impossible value, and one commit later EQUIPMENT was
 * real: `asCostCategory("EQUIPMENT")).toBeNull()` would have gone red (loudly,
 * which is fine) and the NaN regression below would have gone GREEN while
 * testing nothing at all, because a recognised category cannot reach the
 * unknown-key branch it exists to pin. A test whose subject is "a value this
 * build has never heard of" is one enum addition from having no subject.
 */
const NEVER_A_CATEGORY = "SCAFFOLD_RENTAL";

const schemaPath = fileURLToPath(
  new URL("../../../packages/db/prisma/schema/jobs.prisma", import.meta.url),
);

/** The enum body as the schema writes it. Anchored on the declaration and
 * read to the closing brace rather than pattern-matched over the file: a
 * regex across a whole schema is one formatting change from matching
 * nothing, and an empty parse makes every assertion below vacuous. */
function schemaValues(): string[] {
  const schema = readFileSync(schemaPath, "utf8");
  const start = schema.indexOf("enum CostCategory {");
  expect(start, `no "enum CostCategory {" in ${schemaPath}`).toBeGreaterThan(-1);
  const end = schema.indexOf("}", start);
  expect(end, "unterminated enum CostCategory").toBeGreaterThan(start);
  return schema
    .slice(start + "enum CostCategory {".length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("///"));
}

describe("the list matches the schema, which is the only thing that can drift", () => {
  it("parses a real enum body", () => {
    // Vacuity guard first: an empty parse would make everything below pass.
    expect(schemaValues().length).toBeGreaterThanOrEqual(4);
  });

  it("carries exactly the values jobs.prisma declares", () => {
    expect([...COST_CATEGORY_VALUES].sort()).toEqual(schemaValues().sort());
  });

  it("gives every schema value a label", () => {
    for (const value of schemaValues()) {
      // Not the raw token: `costCategoryLabel` falls back to the value
      // itself, so a missing label shows up as SCREAMING_SNAKE on screen.
      expect(costCategoryLabel(value), `${value} has no label`).not.toBe(value);
    }
  });
});

describe("there is only one list", () => {
  it("bid-recap re-exports it rather than declaring its own", () => {
    // Identity, not equality. Two arrays with the same contents today are
    // exactly what this repo had before, and they drifted.
    expect(RECAP_VALUES).toBe(COST_CATEGORY_VALUES);
  });

  it("the components label module re-exports it too", () => {
    expect(COST_CATEGORY_ORDER).toBe(COST_CATEGORY_VALUES);
  });
});

describe("asCostCategory narrows — the thing a cast could not do", () => {
  it("accepts every real value", () => {
    for (const value of COST_CATEGORY_VALUES) expect(asCostCategory(value)).toBe(value);
  });

  it("the token standing in for an unknown category is genuinely unknown", () => {
    // The premise of every assertion below and of the NaN regression. If this
    // ever goes red, pick a new token — do not delete the test.
    expect(COST_CATEGORY_VALUES).not.toContain(NEVER_A_CATEGORY);
  });

  it("accepts EQUIPMENT, which was the unknown value that produced the NaN", () => {
    expect(asCostCategory("EQUIPMENT")).toBe("EQUIPMENT");
  });

  it("returns null for a value this build has never heard of", () => {
    // `as CostCategoryValue` asserted this could not happen. It can: the
    // database holds whatever the enum holds, and the enum grows.
    expect(asCostCategory(NEVER_A_CATEGORY)).toBeNull();
    expect(asCostCategory("")).toBeNull();
    expect(asCostCategory(null)).toBeNull();
    expect(asCostCategory(undefined)).toBeNull();
    expect(asCostCategory(42)).toBeNull();
  });

  it("is case-sensitive, because the database is", () => {
    expect(asCostCategory("labor")).toBeNull();
  });
});

describe("the accumulator cannot produce NaN", () => {
  /**
   * TYPED, with the cast narrowed to the one field that needs it.
   *
   * This said `as never` on the whole object until #524 landed, and that is
   * worth a sentence in a file about casts: #524 made `RecapLine.unitCost`
   * required precisely so every caller passing a price-as-cost became a
   * typecheck failure — and a blanket `as never` here opted these fixtures out
   * of exactly that check. Six of them silently went to $0 direct cost and only
   * the assertions caught it. The cast is now on `costCategory` alone, which is
   * the one thing being deliberately faked: a value the database can hold and
   * this build cannot name.
   *
   * `unitCost` carries the money, because that is the column the recap marks
   * up. `unitPrice` keeps the line billable.
   */
  const line = (id: string, cost: number, costCategory: string | null): RecapLine => ({
    id,
    quantity: 1,
    unitCost: cost,
    unitPrice: cost,
    costCategory: costCategory as CostCategoryValue | null,
  });

  it("REGRESSION: an unrecognised category does not poison the total", () => {
    // The exact shape that was measured as NaN.
    const result = directCostByCategory([
      line("lift", 2500, NEVER_A_CATEGORY),
      line("board", 1200, "MATERIAL"),
    ]);

    expect(Number.isNaN(result.total), "the total went NaN again").toBe(false);
    expect(result.total).toBe(3700);
    for (const [key, value] of Object.entries(result.byCategory)) {
      expect(Number.isNaN(value), `byCategory.${key} is NaN`).toBe(false);
    }
  });

  it("counts the unknown money as UNCATEGORISED rather than dropping it", () => {
    // Dropping it would understate the bid silently, which is the same
    // failure wearing a tidier number.
    const result = directCostByCategory([line("lift", 2500, NEVER_A_CATEGORY)]);
    expect(result.uncategorised).toBe(2500);
    expect(result.uncategorisedLineCount).toBe(1);
  });

  it("still treats a genuinely null category as uncategorised", () => {
    const result = directCostByCategory([line("tbd", 900, null)]);
    expect(result.uncategorised).toBe(900);
    expect(result.uncategorisedLineCount).toBe(1);
  });
});

describe("every category is actually marked up — the silent-zero guard", () => {
  const lineOf = (costCategory: string): RecapLine[] => [
    { id: "x", quantity: 1, unitCost: 1000, unitPrice: 1000, costCategory: costCategory as CostCategoryValue },
  ];

  /** A rate per category. If a key is MISSING here the matching category gets
   * no markup and the loop below goes red naming it, which is the same
   * direction of failure as the defect this guards — so a stale fixture cannot
   * hide a stale `MARKUP`. */
  const ALL_AT_100 = {
    materialMarkupPercent: 100,
    laborMarkupPercent: 100,
    subcontractorMarkupPercent: 100,
    equipmentMarkupPercent: 100,
    otherMarkupPercent: 100,
  };

  it("adds markup for EVERY value in the enum, not just the ones somebody listed", () => {
    // `MARKUP` in bid-recap.ts is a total Record so this cannot compile while a
    // category is missing. The test covers the other half: that the rate wired
    // to each category is a rate this recap actually reads. A category present
    // in the Record but pointed at a key nobody sets is sold at cost.
    for (const category of COST_CATEGORY_VALUES) {
      const recap = bidRecap(lineOf(category), ALL_AT_100);
      expect(recap.addedTotal, `${category} was marked up at nothing`).toBe(1000);
    }
  });

  it("EQUIPMENT reads its OWN rate, not the one it used to be filed under", () => {
    // The failure this rules out is invisible in a total: point EQUIPMENT at
    // otherMarkupPercent and every test above still passes.
    const equipmentOnly = { equipmentMarkupPercent: 50 };
    expect(bidRecap(lineOf("EQUIPMENT"), equipmentOnly).addedTotal).toBe(500);
    expect(bidRecap(lineOf("OTHER"), equipmentOnly).addedTotal).toBe(0);

    const otherOnly = { otherMarkupPercent: 50 };
    expect(bidRecap(lineOf("OTHER"), otherOnly).addedTotal).toBe(500);
    expect(bidRecap(lineOf("EQUIPMENT"), otherOnly).addedTotal).toBe(0);
  });

  it("names the step after the category, so a recap reader can see which rate applied", () => {
    const recap = bidRecap(lineOf("EQUIPMENT"), { equipmentMarkupPercent: 10 });
    expect(recap.steps.map((step) => step.key)).toContain("markup:EQUIPMENT");
  });
});

describe("the history split is stated, not implied", () => {
  it("carries the date the enum actually changed", () => {
    // Same date as the migration. A note claiming the wrong date is worse than
    // none: it tells somebody their older equipment costs should be there.
    expect(EQUIPMENT_SPLIT_ON).toBe("2026-09-26");
    expect(EQUIPMENT_SPLIT_NOTE).toContain(EQUIPMENT_SPLIT_ON);
  });

  it("says equipment is UNDERSTATED for earlier work, in those terms", () => {
    // The direction is the whole content. "Categories changed" tells a reader
    // nothing about which way to distrust the number.
    expect(EQUIPMENT_SPLIT_NOTE).toMatch(/understated/);
    expect(EQUIPMENT_SPLIT_NOTE).toMatch(/not reclassified/);
  });
});

describe("a consumer that ITERATES the rate keys gets the same bid as one that does not", () => {
  /**
   * The Ask divergence, pinned.
   *
   * `lib/ask/handlers.ts` does not receive a `RecapRates`; it builds one by
   * mapping a list of key names over a database row. That is a second way to
   * be wrong that no amount of care inside `bidRecap` can catch — the math is
   * handed a rates object that is simply missing a rate, which is
   * indistinguishable from a rate nobody set.
   *
   * Measured before the fix, on exactly this fixture: the screen said
   * $25,987.50 and Ask said $24,255.00, understating by $1,732.50, with Ask's
   * own ten tests green. The list said "the recap's ten rates" and the recap
   * had eleven.
   *
   * So this asserts the two roads meet. `RECAP_RATE_KEYS` is exhaustive over
   * `RecapRates` by construction, and this is the behavioural half: drop a key
   * and the totals diverge here rather than on a GC's desk.
   */
  const lines: RecapLine[] = [
    { id: "labor", quantity: 1, unitCost: 10000, unitPrice: 10000, costCategory: "LABOR" },
    { id: "lifts", quantity: 1, unitCost: 10000, unitPrice: 10000, costCategory: "EQUIPMENT" },
  ];

  const stored: Record<string, number> = {
    laborMarkupPercent: 10,
    equipmentMarkupPercent: 15,
    overheadPercent: 10,
    profitPercent: 5,
  };

  it("REGRESSION: the bid is the same built either way", () => {
    // Built the way Ask builds it — key list over a row.
    const viaKeys = Object.fromEntries(
      RECAP_RATE_KEYS.map((key) => [key, stored[key] ?? null]),
    ) as RecapRates;

    const direct = bidRecap(lines, stored as RecapRates);
    const iterated = bidRecap(lines, viaKeys);

    expect(iterated.bidTotal, "a rate is missing from RECAP_RATE_KEYS").toBe(direct.bidTotal);
    // The measured figure, so a drift shows as a number somebody can recognise
    // rather than as two equal wrong answers.
    expect(direct.bidTotal).toBe(25987.5);
    expect(iterated.bidTotal).not.toBe(24255);
  });

  it("carries the equipment markup specifically, which is the one that was lost", () => {
    const viaKeys = Object.fromEntries(
      RECAP_RATE_KEYS.map((key) => [key, stored[key] ?? null]),
    ) as RecapRates;
    expect(bidRecap(lines, viaKeys).steps.map((step) => step.key)).toContain("markup:EQUIPMENT");
  });
});

describe("nobody hand-writes the rate list a second time", () => {
  /**
   * THE HALF THE REGRESSION ABOVE CANNOT SEE, and it was found by mutation
   * rather than by thinking.
   *
   * Restoring a local ten-name rate array in `lib/ask/handlers.ts` — the exact
   * code that shipped the $1,732.50 divergence — left every test in this repo
   * GREEN, including the regression directly above. That test proves the
   * SHARED list is complete; it cannot notice a consumer that has stopped
   * reading it. `nothing is ever missing from a directory you do not walk`,
   * arriving as: nothing is ever missing from a list nobody imports.
   *
   * So this census asks the other question — not "is the list complete" but
   * "is there a second one". A rate key written as a STRING LITERAL is the
   * signature of a hand-rolled list: the real consumers either import
   * `RECAP_RATE_KEYS` or use the names as object KEYS (`RATE_LABELS`,
   * `RATE_FIELD_SPECS`), which are identifiers and do not match.
   */
  const WEB = fileURLToPath(new URL("..", import.meta.url));
  const CANONICAL = join(WEB, "lib/bid-recap.ts");
  const NEEDLE = '"materialMarkupPercent"';

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const scanned = ["app", "components", "lib"].flatMap((d) => sources(join(WEB, d)));

  it("walks a real set of files", () => {
    // Anti-vacuity on SCOPE: an empty walk would make the census below pass
    // while looking everywhere and seeing nothing.
    expect(scanned.length).toBeGreaterThan(300);
    expect(scanned).toContain(CANONICAL);
  });

  it("finds the canonical list, so the needle still matches something", () => {
    // Anti-vacuity on the PATTERN: if the rate names are ever renamed, this
    // fails here rather than silently approving every file in the app.
    expect(readFileSync(CANONICAL, "utf8")).toContain(NEEDLE);
  });

  it("finds it NOWHERE else", () => {
    const offenders = scanned
      .filter((file) => file !== CANONICAL)
      .filter((file) => readFileSync(file, "utf8").includes(NEEDLE))
      .map((file) => file.slice(WEB.length));
    expect(
      offenders,
      `these files hand-write the recap's rate names instead of importing RECAP_RATE_KEYS. ` +
        `A list written out by hand is one rate behind the day a rate is added, and the bid it ` +
        `computes is short by that rate with every test green — that is exactly how Ask reported ` +
        `a bid $1,732.50 under the Estimate screen's.`,
    ).toEqual([]);
  });
});
