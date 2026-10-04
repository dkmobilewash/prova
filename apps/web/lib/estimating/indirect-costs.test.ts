import { describe as group, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INDIRECT_COST_KINDS,
  INDIRECT_COST_LABEL,
  missingIndirects,
  missingIndirectsSentence,
  type IndirectCatalogEntry,
} from "./indirect-costs";

/**
 * Which general conditions this bid has nothing for.
 *
 * The thing worth testing hardest is the NEGATIVE: that a kind already on the
 * estimate is not reported, by every route it can get there. A checklist that
 * reports something already done is the one people stop reading — the failure
 * `bid-margin.ts` was shaped around, and the reason Diego chose a warning that
 * cannot cry wolf.
 */

const entry = (over: Partial<IndirectCatalogEntry> & { indirectKind: string | null }): IndirectCatalogEntry => ({
  id: `cat_${over.indirectKind ?? "none"}`,
  description: "Supervision — per week",
  defaultBudgetedUnitCost: 2400,
  ...over,
});

const kindsIn = (missing: ReturnType<typeof missingIndirects>) => missing.map((m) => m.kind);

group("it names what is absent", () => {
  it("reports every kind on an estimate with no indirects at all", () => {
    const missing = missingIndirects([{ indirectKind: null }, { indirectKind: null }], []);
    expect(kindsIn(missing)).toEqual([...INDIRECT_COST_KINDS]);
  });

  it("reports nothing on an estimate that carries all of them", () => {
    const lines = INDIRECT_COST_KINDS.map((kind) => ({ indirectKind: kind }));
    expect(missingIndirects(lines, [])).toEqual([]);
    expect(missingIndirectsSentence([])).toBeNull();
  });

  it("reports nothing on an empty list of kinds, rather than an empty sentence", () => {
    // NULL, not "". The caller renders nothing instead of an empty box — the
    // same contract `proposalPriceWarning` and `underCostWarning` keep.
    expect(missingIndirectsSentence([])).toBeNull();
  });

  it("keeps declaration order, not discovery order", () => {
    // A list that reorders itself as lines are added is one nobody can scan
    // twice. `bid-recap.ts` states the same rule for its markup steps.
    const missing = missingIndirects([{ indirectKind: "SUPERVISION" }], []);
    expect(kindsIn(missing)).toEqual(INDIRECT_COST_KINDS.filter((k) => k !== "SUPERVISION"));
  });
});

group("present means TAGGED, by any route", () => {
  it("a HAND-TAGGED line covers its kind", () => {
    // The reason the column is on JobLineItem and not only on the catalog
    // entry: an estimator who typed "Mobilization — $2,500" and tagged it must
    // not be told they have no mobilization.
    const missing = missingIndirects([{ indirectKind: "MOBILIZATION" }], []);
    expect(kindsIn(missing)).not.toContain("MOBILIZATION");
  });

  it("a tagged line with NO COST still counts as present", () => {
    // An estimator who added a cleanup line and left it at zero has decided
    // cleanup is free on this job. Saying "you have nothing for cleanup" after
    // that is arguing with somebody who already answered. The costless line is
    // `bid-margin.ts`'s business, not this module's.
    const missing = missingIndirects([{ indirectKind: "CLEANUP" }], []);
    expect(kindsIn(missing)).not.toContain("CLEANUP");
  });

  it("an UNTAGGED line never covers a kind, however it is described", () => {
    // Nothing is inferred from a description string — the rule jobs.prisma
    // already states for costCategory, craftClassificationId and phaseCodeId.
    // The `IndirectLine` type carries no description at all, which is the
    // strongest form of that guarantee: this module cannot read one.
    const missing = missingIndirects([{ indirectKind: null }], []);
    expect(kindsIn(missing)).toEqual([...INDIRECT_COST_KINDS]);
  });

  it("ignores a kind the enum does not know", () => {
    // A value from an older or hand-edited row must not silently cover a kind,
    // and must not throw either.
    const missing = missingIndirects([{ indirectKind: "SCAFFOLD_WATCH" }], []);
    expect(kindsIn(missing)).toEqual([...INDIRECT_COST_KINDS]);
  });
});

group("the company's own figure rides along", () => {
  it("attaches the catalog entry for a kind the company has priced", () => {
    const missing = missingIndirects([], [entry({ indirectKind: "SUPERVISION" })]);
    const supervision = missing.find((m) => m.kind === "SUPERVISION")!;
    expect(supervision.entry?.defaultBudgetedUnitCost).toBe(2400);
    // And a kind they have NOT catalogued still gets offered, with no figure —
    // the press then adds a named line with no cost, which is honest.
    expect(missing.find((m) => m.kind === "DUMPSTERS")!.entry).toBeNull();
  });

  it("offers a tagged entry that carries NO cost rather than hiding it", () => {
    // Hiding it would be the app deciding an untyped figure means "not needed".
    const missing = missingIndirects([], [entry({ indirectKind: "PERMITS", defaultBudgetedUnitCost: null })]);
    expect(missing.find((m) => m.kind === "PERMITS")!.entry).not.toBeNull();
  });

  it("takes the FIRST entry when a company has catalogued two of a kind", () => {
    // Not the cheapest and not the newest — picking one would be inventing a
    // rule nobody asked for. A company with two supervision entries has a
    // catalog to tidy, which is not this module's question.
    const missing = missingIndirects(
      [],
      [
        entry({ id: "first", indirectKind: "SUPERVISION", defaultBudgetedUnitCost: 2400 }),
        entry({ id: "second", indirectKind: "SUPERVISION", defaultBudgetedUnitCost: 99 }),
      ],
    );
    expect(missing.find((m) => m.kind === "SUPERVISION")!.entry?.id).toBe("first");
  });

  it("ignores an untagged catalog entry entirely", () => {
    const missing = missingIndirects([], [entry({ indirectKind: null })]);
    expect(missing.every((m) => m.entry === null)).toBe(true);
  });
});

group("the sentence", () => {
  it("names one kind without a stray conjunction", () => {
    const missing = missingIndirects(
      INDIRECT_COST_KINDS.filter((k) => k !== "CLEANUP").map((kind) => ({ indirectKind: kind })),
      [],
    );
    const sentence = missingIndirectsSentence(missing)!;
    expect(sentence).toContain("nothing for Cleanup.");
    expect(sentence).not.toContain(" and Cleanup");
  });

  it("joins two with 'and', and three with commas and an 'and'", () => {
    const keep = (...kinds: string[]) =>
      missingIndirectsSentence(
        missingIndirects(
          INDIRECT_COST_KINDS.filter((k) => !kinds.includes(k)).map((kind) => ({ indirectKind: kind })),
          [],
        ),
      )!;
    expect(keep("CLEANUP", "DUMPSTERS")).toContain("Cleanup and Dumpsters");
    expect(keep("PERMITS", "CLEANUP", "DUMPSTERS")).toContain("Permits & testing, Cleanup and Dumpsters");
  });

  it("never says the bid is wrong, and never says what to do", () => {
    // An estimate with no dumpster line is usually an estimate that needs no
    // dumpster. Adding the line, excluding the scope in the proposal, and
    // leaving it alone are all right answers — `lien-waiver.ts`'s rule, that
    // refusing to accept the world as it is teaches people to route around you.
    const sentence = missingIndirectsSentence(missingIndirects([], []))!.toLowerCase();
    for (const forbidden of ["missing", "incomplete", "you must", "you should", "error", "required"]) {
      expect(sentence, forbidden).not.toContain(forbidden);
    }
    expect(sentence).toContain("on purpose");
  });
});

group("the labels cannot fall behind the enum", () => {
  it("names every kind, with what it covers", () => {
    // `INDIRECT_COST_LABEL` is a total Record so this cannot compile otherwise —
    // this asserts the content rather than the type, since a label of "" would
    // typecheck and render as nothing.
    for (const kind of INDIRECT_COST_KINDS) {
      expect(INDIRECT_COST_LABEL[kind].label.length, kind).toBeGreaterThan(2);
      expect(INDIRECT_COST_LABEL[kind].covers.length, kind).toBeGreaterThan(10);
    }
  });

  it("MATCHES THE PRISMA ENUM, member for member", () => {
    // The list here is hand-written and the database's is the real one. A
    // member added to the schema and not to this file would silently never be
    // checked for, which is the "nothing is ever missing from a list nobody
    // imports" shape CLAUDE.md records — so the schema is read and compared.
    const schema = readFileSync(
      fileURLToPath(new URL("../../../../packages/db/prisma/schema/jobs.prisma", import.meta.url)),
      "utf8",
    );
    const block = schema.match(/enum IndirectCostKind \{([\s\S]*?)\n\}/);
    expect(block, "IndirectCostKind is not in jobs.prisma").toBeTruthy();
    const members = [...block![1].matchAll(/^\s{2}([A-Z_]+)\s*$/gm)].map((m) => m[1]);
    expect(members.length, "parsed no members at all").toBeGreaterThanOrEqual(8);
    expect(members).toEqual([...INDIRECT_COST_KINDS]);
  });
});
