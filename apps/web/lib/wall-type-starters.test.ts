import { describe, expect, it } from "vitest";
import { STARTER_TYPES, TRADE_ONLY_STARTERS } from "./wall-type-starters";

/**
 * Every starter part says whether it is the crew's work or material, because
 * the bid recap marks a line up by its category and a line with none takes no
 * markup (new-job walkthrough v2, F2). The type makes the field required; this
 * says the answers are the right way round.
 */
describe("starter parts carry a cost category", () => {
  const parts = [...STARTER_TYPES, ...TRADE_ONLY_STARTERS].flatMap((type) => type.parts.map((part) => ({ code: type.code, ...part })));

  it("has parts to check", () => {
    expect(parts.length).toBeGreaterThan(40);
  });

  it("calls the crew's work LABOR and everything bought MATERIAL", () => {
    const work = /^(hang|install|place|form|apply|fireproof one|prime and paint|lath and plaster|level 5)\b/i;
    for (const part of parts) {
      expect([part.code, part.description, part.costCategory]).toEqual([part.code, part.description, work.test(part.description) ? "LABOR" : "MATERIAL"]);
    }
  });

  it("gives every type a labor line, so its crew's time is marked up as labor", () => {
    for (const type of [...STARTER_TYPES, ...TRADE_ONLY_STARTERS]) {
      expect(type.parts.some((part) => part.costCategory === "LABOR"), type.code).toBe(true);
    }
  });
});
