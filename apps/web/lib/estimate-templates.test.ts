import { describe, expect, it } from "vitest";

import {
  quantityFor,
  templateApplication,
  templateItemProblem,
  templateProblem,
  templatesForTrade,
  dominantTradeScope,
  type ExistingLine,
  type TemplateItemInput,
} from "./estimate-templates";

const item = (
  over: Partial<TemplateItemInput> & Pick<TemplateItemInput, "id" | "description">,
): TemplateItemInput => ({
  unit: "SF",
  defaultQuantity: null,
  catalogEntryId: null,
  ...over,
});

const existing = (description: string, isDeleted = false): ExistingLine => ({ description, isDeleted });

describe("a template item with no default quantity starts at 1, never 0", () => {
  it("THE DEFECT THIS EXISTS FOR: zero prices to nothing and looks finished", () => {
    // A line reading "0 SF" contributes nothing to the total, so an estimate
    // carrying it looks complete. "1 SF" is obviously unfinished and gets
    // fixed. Being visibly wrong is the safe direction.
    expect(quantityFor(null)).toBe(1);
    expect(quantityFor(0)).toBe(1);
    expect(quantityFor(-5)).toBe(1);
  });

  it("keeps a real default", () => {
    expect(quantityFor(250)).toBe(250);
    expect(quantityFor(0.5)).toBe(0.5);
  });

  it("refuses a non-finite number rather than propagating it", () => {
    expect(quantityFor(Number.NaN)).toBe(1);
    expect(quantityFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("applying a template to an estimate", () => {
  it("turns every item into a line, carrying the catalog link", () => {
    const result = templateApplication(
      [
        item({ id: "a", description: "3-5/8 metal stud", defaultQuantity: 400, catalogEntryId: "cat-1" }),
        item({ id: "b", description: "5/8 Type X board", unit: "SF" }),
      ],
      [],
    );
    expect(result.lines).toEqual([
      { description: "3-5/8 metal stud", unit: "SF", quantity: 400, catalogEntryId: "cat-1" },
      { description: "5/8 Type X board", unit: "SF", quantity: 1, catalogEntryId: null },
    ]);
    expect(result.caution).toBeNull();
  });

  it("trims the description it will write", () => {
    const result = templateApplication([item({ id: "a", description: "  Tape and finish  " })], []);
    expect(result.lines[0].description).toBe("Tape and finish");
  });
});

describe("applying twice is the way this feature sends a bid out double", () => {
  it("SAYS SO BEFORE ANYTHING IS WRITTEN when the estimate already has a line", () => {
    const result = templateApplication(
      [item({ id: "a", description: "Tape and finish" }), item({ id: "b", description: "Corner bead" })],
      [existing("Tape and finish")],
    );
    expect(result.alreadyPresent).toEqual(["Tape and finish"]);
    expect(result.caution).toContain("already has Tape and finish");
    expect(result.caution).toContain("second copy");
    // Reported, NOT refused: a second floor's worth is legitimate, and a rule
    // guessing which case this is would be wrong half the time.
    expect(result.lines).toHaveLength(2);
  });

  it("has a stronger sentence when EVERY line is already there", () => {
    const result = templateApplication(
      [item({ id: "a", description: "Tape and finish" }), item({ id: "b", description: "Corner bead" })],
      [existing("Tape and finish"), existing("Corner bead")],
    );
    expect(result.caution).toContain("already has every line");
    expect(result.caution).toContain("a second copy of each");
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    const result = templateApplication(
      [item({ id: "a", description: "Tape and Finish" })],
      [existing("  tape and finish  ")],
    );
    expect(result.alreadyPresent).toEqual(["Tape and Finish"]);
  });

  it("IGNORES a line the estimator deleted", () => {
    // A removed line is a decision. Warning that the template "already has"
    // it would be arguing with that decision.
    const result = templateApplication(
      [item({ id: "a", description: "Tape and finish" })],
      [existing("Tape and finish", true)],
    );
    expect(result.alreadyPresent).toEqual([]);
    expect(result.caution).toBeNull();
  });

  it("is quiet on an empty estimate", () => {
    const result = templateApplication([item({ id: "a", description: "Corner bead" })], []);
    expect(result.caution).toBeNull();
  });
});

describe("which templates are offered on a bid", () => {
  const templates = [
    { name: "General TI", tradeScope: null },
    { name: "Framing", tradeScope: "METAL_FRAMING_DRYWALL" },
    { name: "EIFS re-clad", tradeScope: "EIFS" },
  ];

  it("offers the matching trade and the untagged ones", () => {
    expect(templatesForTrade(templates, "EIFS").map((t) => t.name)).toEqual(["General TI", "EIFS re-clad"]);
  });

  it("offers everything when the bid has no trade", () => {
    expect(templatesForTrade(templates, null)).toHaveLength(3);
  });

  it("can return nothing, and the caller is expected to handle that", () => {
    expect(templatesForTrade([{ name: "Framing", tradeScope: "METAL_FRAMING_DRYWALL" }], "EIFS")).toEqual([]);
  });
});

describe("validation", () => {
  it("a template needs a name", () => {
    expect(templateProblem({ name: "  " })).toContain("Give the template a name");
    expect(templateProblem({ name: "TI, metal stud" })).toBeNull();
  });

  it("an item needs a description", () => {
    expect(templateItemProblem({ description: "", defaultQuantity: null })).toContain("Say what the line is");
  });

  it("a blank default quantity is fine — that is the takeoff-decides case", () => {
    expect(templateItemProblem({ description: "Board", defaultQuantity: null })).toBeNull();
  });

  it("refuses zero with the reason, rather than silently storing it", () => {
    const problem = templateItemProblem({ description: "Board", defaultQuantity: 0 });
    expect(problem).toContain("price to nothing");
    expect(problem).toContain("Leave it blank");
  });

  it("refuses a non-number", () => {
    expect(templateItemProblem({ description: "Board", defaultQuantity: Number.NaN })).toContain("has to be a number");
  });
});

describe("the trade an estimate is mostly about", () => {
  const line = (tradeScope: string | null, isDeleted = false) => ({ tradeScope, isDeleted });

  it("is null on an empty estimate — which is when a template is most wanted", () => {
    expect(dominantTradeScope([])).toBeNull();
  });

  it("is the commonest trade on the live lines", () => {
    expect(
      dominantTradeScope([line("EIFS"), line("METAL_FRAMING_DRYWALL"), line("EIFS")]),
    ).toBe("EIFS");
  });

  it("ignores deleted lines and untagged ones", () => {
    expect(dominantTradeScope([line("EIFS", true), line(null), line("FIREPROOFING")])).toBe("FIREPROOFING");
  });

  it("RETURNS NULL ON A TIE rather than picking one", () => {
    // Guessing between two trades to hide half the library is worse than
    // showing all of it.
    expect(dominantTradeScope([line("EIFS"), line("METAL_FRAMING_DRYWALL")])).toBeNull();
  });

  it("feeds templatesForTrade, which is the whole reason it exists", () => {
    const templates = [
      { name: "General", tradeScope: null },
      { name: "EIFS re-clad", tradeScope: "EIFS" },
      { name: "Framing", tradeScope: "METAL_FRAMING_DRYWALL" },
    ];
    const scope = dominantTradeScope([line("EIFS"), line("EIFS")]);
    expect(templatesForTrade(templates, scope).map((t) => t.name)).toEqual(["General", "EIFS re-clad"]);
  });
});
