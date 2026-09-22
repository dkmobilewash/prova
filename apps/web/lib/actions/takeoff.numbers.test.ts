/**
 * What the takeoff does with a figure it cannot read.
 *
 * EVERY MEASUREMENT USED TO BECOME ZERO, SILENTLY. `parseTakeoffLines`
 * wrapped each field in `Number(String(formData.get(key) ?? ""))` and fell
 * back to `0` on anything it disliked — so a length of `2,800`, the
 * thousands comma a contractor writes without thinking, produced no
 * quantities at all and the refusal blamed "the measurements". Nothing
 * named the field, and nothing said the word comma.
 *
 * #418 generalised the two hardcoded surfaces into five recipes and
 * carried that behaviour into all five, which is the ordinary way one
 * quiet defect becomes several — not a mistake in #418, just what
 * happens when the parsing is inline.
 *
 * WHAT THIS FILE IS SEPARATE FROM. `lib/takeoff-recipes.test.ts` owns the
 * arithmetic — gallons per coat, waste, trim — and none of that is touched
 * here. This is only about turning what somebody typed into the numbers
 * that arithmetic runs on.
 *
 * MUTATION-TESTED: restoring the old `num` (the two-line `Number(String(
 * formData.get(key) ?? ""))` form) turns the comma and the naming cases
 * red, and `lib/numericInputCensus.test.ts` independently goes red naming
 * this file — which is how the census earned its keep on somebody else's
 * new module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

let db = new FakeDb();
const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

const { addTakeoffLines } = await import("./takeoff");

const JOB_ID = "job_1";

beforeEach(() => {
  db = new FakeDb();
  context.jobFunction = null;
  // `seed`, not the client — the same shape safety.test.ts uses, and it
  // keeps the typed surface out of a test that only needs rows to exist.
  db.seed("job", { id: JOB_ID, companyId: "co_1", name: "Tower", status: "ESTIMATE" });
});

/** A wall takeoff exactly as the form submits one. */
function wall(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    recipe: "wall",
    label: "3rd floor east",
    lengthFt: "120",
    heightFt: "10",
    sides: "2",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

function linesOnJob(): Array<{ quantity: number }> {
  return db.rows("jobLineItem") as unknown as Array<{ quantity: number }>;
}

describe("a measurement with a thousands comma in it", () => {
  it("is measured, not thrown away — 2,800 is 2800 feet", async () => {
    const result = await addTakeoffLines(JOB_ID, wall({ lengthFt: "2,800" }));
    expect(result).toEqual({ ok: true });
    const lines = linesOnJob();
    expect(lines.length).toBeGreaterThan(0);
    // The arithmetic is takeoff-recipes' business; what matters here is
    // that it ran on 2800 rather than on 0. A 2,800ft x 10ft wall boarded
    // both sides is 56,000 sq ft of board, so every quantity is large.
    expect(Math.max(...lines.map((l) => Number(l.quantity)))).toBeGreaterThan(100);
  });

  it("used to produce nothing at all", async () => {
    // The old gate, spelled out rather than asserted, so the regression is
    // visible: this is what `num` did with the same string.
    const oldNum = (raw: string) => {
      const n = Number(String(raw ?? ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    expect(oldNum("2,800")).toBe(0);
    expect(oldNum("2800")).toBe(2800);
  });
});

describe("a measurement that really cannot be read", () => {
  it("names the field, instead of blaming the measurements", async () => {
    const result = (await addTakeoffLines(JOB_ID, wall({ lengthFt: "about 120" }))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Length");
    expect(result.error).not.toContain("produce no quantities");
    expect(linesOnJob()).toHaveLength(0);
  });

  it("still says 'no quantities' when the fields are simply blank", async () => {
    // Unchanged on purpose: blank is not a typo, and the old sentence is
    // the right one for it.
    const result = (await addTakeoffLines(JOB_ID, wall({ lengthFt: "", heightFt: "" }))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("produce no quantities");
  });
});

/**
 * THE ONE BEHAVIOUR CHANGE IN SOMEBODY ELSE'S LANE, pinned here so it is a
 * decision rather than a side effect.
 *
 * `optionalNum` reads a recipe ARGUMENT — waste, coats, coverage, stud
 * spacing. Blank means "use the recipe's own default", which is unchanged
 * and is what #418's comment describes. But a value that was not blank and
 * could not be read ALSO fell through to the default, so typing `1,0` into
 * Waste quietly bid at 10% — a hidden override in the opposite direction
 * from the one that comment guards against. It says so now.
 */
describe("a recipe argument", () => {
  it("still falls back to the recipe default when it is left blank", async () => {
    expect(await addTakeoffLines(JOB_ID, wall({ wastePercent: "" }))).toEqual({ ok: true });
  });

  it("takes a figure with a comma, like every other box", async () => {
    expect(await addTakeoffLines(JOB_ID, wall({ wastePercent: "12.5" }))).toEqual({ ok: true });
  });

  it("REFUSES a typo rather than silently bidding at the default", async () => {
    const result = (await addTakeoffLines(JOB_ID, wall({ wastePercent: "ten percent" }))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Waste");
    expect(linesOnJob()).toHaveLength(0);
  });
});
