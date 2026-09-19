import { describe, expect, it } from "vitest";
import {
  CLIENT_COLUMNS,
  CLIENT_FIELD_OPTIONS,
  CREW_COLUMNS,
  CREW_FIELD_OPTIONS,
  JOB_COLUMNS,
  JOB_FIELD_OPTIONS,
  PHASE_CODE_COLUMNS,
  PHASE_CODE_FIELD_OPTIONS,
  normaliseHeader,
  type FieldOption,
} from "./spreadsheet-import";

/**
 * The precondition the column-mapping UI depends on and cannot check
 * itself at runtime: every `FieldOption.label` (components/SpreadsheetImport
 * .tsx writes it back into a file's header when a person picks that field —
 * see lib/import-mapping.ts) must be text `mapColumns` already recognises
 * as an alias of that SAME field. If it isn't, picking that field from the
 * dropdown silently does nothing — the rewritten header matches no alias,
 * the row reads as unmapped, and nobody sees an error; the field is simply
 * never importable through the UI meant to fix exactly that.
 *
 * Two failure modes, per the lesson repeated elsewhere in this codebase for
 * every check that DERIVES a set it then reasons about: the label can be
 * WRONG (checked in the loop), or the field list itself can be INCOMPLETE —
 * a field the alias table declares but no FieldOption offers can never be
 * chosen at all, which looks identical to "there was nothing to check".
 * Both are asserted below, against the alias tables themselves rather than
 * a count copied out of them, so adding a column to either side of a pair
 * fails this file until the other side is updated to match.
 */

const KINDS = [
  { name: "clients", aliases: CLIENT_COLUMNS, options: CLIENT_FIELD_OPTIONS },
  { name: "jobs", aliases: JOB_COLUMNS, options: JOB_FIELD_OPTIONS },
  { name: "crew", aliases: CREW_COLUMNS, options: CREW_FIELD_OPTIONS },
  { name: "costCodes", aliases: PHASE_CODE_COLUMNS, options: PHASE_CODE_FIELD_OPTIONS },
] as const satisfies readonly {
  name: string;
  aliases: Record<string, readonly string[]>;
  options: readonly FieldOption<string>[];
}[];

describe("column-mapping census", () => {
  it("checked every kind, and none had an empty field list to pass vacuously", () => {
    expect(KINDS.length).toBe(4);
    for (const kind of KINDS) {
      expect(Object.keys(kind.aliases).length, `${kind.name} has no aliased fields`).toBeGreaterThan(0);
    }
  });

  for (const kind of KINDS) {
    it(`${kind.name}: the mapping UI offers exactly the fields the parser knows, and every label is one of its own aliases`, () => {
      const aliasFields = Object.keys(kind.aliases).sort();
      const optionFields = kind.options.map((o) => o.field).sort();
      // Neither side may be missing a field the other declares — a field
      // with no option can't be picked; an option for no field maps a
      // dropdown choice nowhere.
      expect(optionFields).toEqual(aliasFields);

      for (const option of kind.options) {
        const aliases = (kind.aliases as Record<string, readonly string[]>)[option.field];
        const normalised = normaliseHeader(option.label);
        expect(
          aliases.includes(normalised),
          `${kind.name}.${option.field}'s label "${option.label}" normalises to "${normalised}", ` +
            `which is not in its own alias list: ${JSON.stringify(aliases)}`,
        ).toBe(true);
      }
    });
  }
});
