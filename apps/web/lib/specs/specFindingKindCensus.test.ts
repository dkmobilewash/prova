import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_FINDING_KINDS } from "@prova/integrations/src/specs";
import { SPEC_FINDING_LABEL } from "./spec-findings";

/**
 * THE POSTGRES ENUM AND THE TS LIST SAY THE SAME THING.
 *
 * `specs.ts` has claimed since it was written that `SpecFindingKind` *"mirrors
 * `BidSpecFindingKind` in `bid-specs.prisma`"*, and until this file existed
 * nothing made that sentence true. Worse than an unguarded copy: the enum is
 * referenced by NO column — `BidSpecReading.findings` is `Json` — so the
 * database never rejected a kind it did not know, and the enum was a `CREATE
 * TYPE` that nothing read. The "written, documented, and never called" shape
 * from CLAUDE.md, wearing a schema.
 *
 * Three of the six places that used to name these kinds are now DERIVED from
 * one array (the type, the tool schema, the runtime guard), which is better
 * than guarding copies. Two cannot be: Postgres owns its own enum, and the
 * on-screen label is prose. This file is the census over those two, and it
 * gives the enum a job.
 *
 * WHY IT MATTERS THAT THE ENUM IS UNUSED. Because nothing breaks when they
 * disagree — not a query, not a write, not a type. The enum is documentation
 * that a reviewer reads to learn what a finding can be, so a stale one teaches
 * the wrong vocabulary silently and forever. That is the only failure mode
 * here, and it is exactly the kind this repo keeps paying for.
 *
 * It parses, so per CLAUDE.md it has two failure modes and only one looks like
 * a failure: it asserts the SIZE of what it parsed against a literal that
 * cannot drift with the pattern, so a regex matching nothing fails loudly
 * instead of passing every assertion below it.
 */

const SCHEMA = path.resolve(__dirname, "../../../../packages/db/prisma/schema/bid-specs.prisma");

/** The enum's members, read out of the schema file rather than out of a
 *  generated client — the generated client reflects whatever was last
 *  generated, which is a different claim from what the schema says. */
function enumMembersFromSchema(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const block = /enum\s+BidSpecFindingKind\s*\{([^}]*)\}/.exec(source);
  if (block === null) {
    throw new Error(
      `bid-specs.prisma has no 'enum BidSpecFindingKind { … }' block. Either the enum was ` +
        `renamed or removed — in which case fix this census deliberately — or the pattern ` +
        `drifted, which is the failure mode that passes everything downstream.`,
    );
  }
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("///") && !line.startsWith("//"))
    .map((line) => {
      const name = /^([A-Z][A-Z0-9_]*)$/.exec(line);
      if (name === null) {
        throw new Error(
          `unparsed line inside enum BidSpecFindingKind: ${JSON.stringify(line)}. A member this ` +
            `census cannot read is a member it cannot compare, so it fails rather than skips.`,
        );
      }
      return name[1];
    });
}

describe("the spec-finding kinds agree everywhere they are written", () => {
  it("parsed a plausible number of members out of the schema, so the rest is not vacuous", () => {
    const members = enumMembersFromSchema();
    // A FLOOR THAT CANNOT DRIFT WITH THE PATTERN. Nine shipped on 2026-10-03;
    // this file's whole job is broken if the parse ever returns a short list,
    // and a short list is what a drifted regex returns.
    expect(members.length, "the enum parsed to fewer members than ever shipped").toBeGreaterThanOrEqual(9);
    expect(members).toContain("GENERAL");
  });

  it("the Postgres enum and the TypeScript list hold exactly the same members", () => {
    // Sorted, because the ORDER is not the claim: Prisma emits members in
    // declaration order and the TS array is grouped for readability, so a
    // positional comparison would fail on a reordering that changes nothing.
    const fromSchema = [...enumMembersFromSchema()].sort();
    const fromCode = [...SPEC_FINDING_KINDS].sort();
    expect(fromCode, "a kind the code can produce that the schema does not document").toEqual(fromSchema);
  });

  it("every kind has an on-screen label that is not the raw enum name", () => {
    for (const kind of SPEC_FINDING_KINDS) {
      const label = SPEC_FINDING_LABEL[kind];
      expect(label, `${kind} has no label`).toBeTruthy();
      // A raw `LIQUIDATED_DAMAGES` on a bid screen reads as a bug. The total
      // `Record` forces a label to EXIST; only this forces it to be prose.
      expect(label, `${kind}'s label is the enum name`).not.toBe(kind);
      expect(label, `${kind}'s label looks like an enum name`).not.toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("names the three Division 00/01 kinds, so this PR's own work cannot be silently reverted", () => {
    // Deliberately specific rather than a count: these three Division 00/01
    // kinds are the whole point of the change that added them, and a count
    // would stay green if somebody swapped one out for another.
    expect(SPEC_FINDING_KINDS).toContain("LIQUIDATED_DAMAGES");
    expect(SPEC_FINDING_KINDS).toContain("WORKING_HOURS");
    expect(SPEC_FINDING_KINDS).toContain("WAGE_REQUIREMENT");
  });
});
