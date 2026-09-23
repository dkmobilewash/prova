import { describe, expect, it } from "vitest";
import { mapColumns, type FieldOption } from "./spreadsheet-import";
import { applyColumnMapping, headerOf } from "./import-mapping";

/**
 * The column-mapping engine on its own, over text no vendor's export ever
 * produced — headers a person mapped BY HAND to fields C Stream already
 * knows by other names. What matters is that the rewritten header is text
 * `mapColumns` (the same function every importer's auto-guess already
 * uses) would have matched correctly on its own, and that nothing besides
 * the header line moves.
 */

const ALIASES = { name: ["job name", "name"], client: ["client"] } as const;
type F = keyof typeof ALIASES;
const LABELS: Record<F, string> = { name: "Job name", client: "Client" };

describe("headerOf", () => {
  it("is the first record's cells, or null for nothing to import", () => {
    expect(headerOf("A,B\n1,2")).toEqual(["A", "B"]);
    expect(headerOf("")).toBeNull();
    // A whitespace-only line is "nothing to import" to parseCsvRecords
    // itself (catalog-import.ts drops any record whose cells are all
    // blank) — headerOf agrees rather than inventing a second rule.
    expect(headerOf("   \n")).toBeNull();
  });
});

describe("applyColumnMapping", () => {
  it("rewrites only the mapped columns' header text, leaving the rest of the header and every body row untouched", () => {
    const text = 'Owner/GC,Job Title,Notes\nAcme,Tower,"has a, comma"\nZenith,Harbor,plain';
    const mapped = applyColumnMapping<F>(text, { client: 0, name: 1 }, LABELS);
    expect(mapped).toBe('Client,Job name,Notes\nAcme,Tower,"has a, comma"\nZenith,Harbor,plain');
    // And the result is exactly what mapColumns would now match on its own —
    // the whole point of rewriting the header rather than teaching a second
    // parser about mappings.
    const { mapping } = mapColumns(headerOf(mapped)!, ALIASES);
    expect(mapping).toEqual({ client: 0, name: 1 });
  });

  it("leaves an unmapped column's original header exactly as it was", () => {
    const mapped = applyColumnMapping<F>("Owner/GC,Extra Stuff\nA,B", { client: 0 }, LABELS);
    expect(mapped).toBe("Client,Extra Stuff\nA,B");
  });

  it("does nothing to a file with no header at all", () => {
    expect(applyColumnMapping<F>("", { client: 0 }, LABELS)).toBe("");
  });

  it("keeps a header-only file's trailing newline and produces no body from nothing", () => {
    expect(applyColumnMapping<F>("Owner/GC\n", { client: 0 }, LABELS)).toBe("Client\n");
    expect(applyColumnMapping<F>("Owner/GC", { client: 0 }, LABELS)).toBe("Client");
  });

  it("preserves CRLF line endings and blank lines in the body, byte for byte", () => {
    const text = "Owner/GC\r\nAcme\r\n\r\nZenith\r\n";
    expect(applyColumnMapping<F>(text, { client: 0 }, LABELS)).toBe("Client\r\nAcme\r\n\r\nZenith\r\n");
  });

  it("preserves a quoted header cell inside a mapped column's row-following text (Line N numbering is untouched)", () => {
    // Two body rows, the second wrapping a quoted line break — the mapping
    // must not renumber or reparse it; it is copied through verbatim.
    const text = 'Owner/GC,Notes\nAcme,plain\nZenith,"two\nlines"';
    const mapped = applyColumnMapping<F>(text, { client: 0 }, LABELS);
    expect(mapped).toBe('Client,Notes\nAcme,plain\nZenith,"two\nlines"');
  });

  it("quotes a canonical header that would otherwise be misread (defensive — none of this file's real labels need it)", () => {
    const weirdLabels: Record<F, string> = { name: "Job, name", client: "Client" };
    const mapped = applyColumnMapping<F>("A,B\n1,2", { name: 0, client: 1 }, weirdLabels);
    expect(mapped).toBe('"Job, name",Client\n1,2');
    expect(headerOf(mapped)).toEqual(["Job, name", "Client"]);
  });

  it("an override of undefined leaves that field unmapped even if a guess would have picked something", () => {
    const mapped = applyColumnMapping<F>("Owner/GC,Job Title\nAcme,Tower", {}, LABELS);
    // Passing an empty mapping is exactly "the person cleared every guess" —
    // nothing is rewritten.
    expect(mapped).toBe("Owner/GC,Job Title\nAcme,Tower");
  });
});

/** A `FieldOption<F>` list can be handed to `applyColumnMapping` directly,
 * since a label IS the canonical header text — this is the shape the
 * component actually uses, pinned here so the two do not drift apart. */
describe("a FieldOption list used as the label table", () => {
  it("resolves the same way a hand-built label record does", () => {
    const options: FieldOption<F>[] = [
      { field: "name", label: "Job name", required: true },
      { field: "client", label: "Client", required: true },
    ];
    const labelFor = Object.fromEntries(options.map((o) => [o.field, o.label])) as Record<F, string>;
    expect(applyColumnMapping<F>("A,B\n1,2", { name: 0, client: 1 }, labelFor)).toBe("Job name,Client\n1,2");
  });
});
