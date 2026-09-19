import { parseCsvRecords } from "./catalog-import";

/**
 * The column-mapping step every spreadsheet importer shares: showing the
 * headers a file actually has, letting a person point each target field at
 * one of them, and turning that choice into text the existing importers
 * (lib/spreadsheet-import.ts) can read with no second parser.
 *
 * WHY THIS IS THE FEATURE THAT MATTERS MOST HERE. `mapColumns` already
 * guesses a mapping from header TEXT — "Client Name" reads as `client`,
 * "First Name" as `legalFirstName` — but a guess that misses (an export
 * that calls the client column "Owner/GC", a cost-code list headed
 * "GL Code") had no way to be corrected short of renaming a column in the
 * source file and re-exporting. Any accounting system's export becomes
 * importable the moment a person can say "that column is the client" with
 * a dropdown, which is why this exists as one generic layer rather than
 * bespoke handling per vendor.
 *
 * HOW IT WORKS, WITHOUT A SECOND PARSER. A mapping is never applied by
 * rewriting rows: it REWRITES ONLY THE HEADER LINE, replacing a mapped
 * column's header text with that field's canonical alias text (its
 * `FieldOption.label` — see the note on `FieldOption` in
 * spreadsheet-import.ts for why that string is safe to write back in). The
 * body — every data row, exactly as typed or exported, blank lines,
 * embedded newlines inside quoted fields — is untouched. The result is
 * text `mapColumns` would have matched correctly on its own if the file's
 * own header had said that. So the 500-row cap, the SSN refusals, the
 * server's fresh re-parse of the CONFIRMED text, and the "Line N" numbers
 * in every problem message all keep working with no separate code path to
 * drift from the paste-and-guess path.
 *
 * Nothing here is remembered server-side. The mapping lives in the
 * component's state until Confirm, exactly like the pasted text itself —
 * see the note at the top of components/SpreadsheetImport.tsx.
 */

export type ColumnMapping<F extends string> = Partial<Record<F, number>>;

/** Quote a field only when the CSV parser would otherwise misread it — the
 * same rule lib/xlsx-import.ts uses, so a rewritten header round-trips
 * through `parseCsvRecords` exactly like a pasted one. */
function csvField(text: string): string {
  if (/[,\t\r\n]/.test(text) || text.startsWith('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** The header row of a file's text, or null for an empty file — the same
 * "nothing to import" case `readRecords` in lib/spreadsheet-import.ts
 * reports. Exposed so the mapping UI can show the detected headers before
 * any target field has been picked. */
export function headerOf(text: string): string[] | null {
  const records = parseCsvRecords(text);
  return records.length === 0 ? null : records[0].cells;
}

/**
 * The text with its header line rewritten to match a chosen mapping —
 * everything from the first line break onward is copied through
 * byte-for-byte, so a header cell's original text survives unchanged for
 * any column left unmapped (it still shows as an "ignored column", exactly
 * as an unrecognised header does today).
 *
 * `mapping` maps FIELD to the ORIGINAL header's column index (as
 * `headerOf` numbers them) — the shape the mapping UI naturally builds
 * from a person's dropdown choices. A field with no chosen column is
 * simply absent from `mapping`; its original header, if any, is left in
 * place for whatever downstream chance match or "ignored column" note it
 * would already get.
 */
export function applyColumnMapping<F extends string>(
  text: string,
  mapping: ColumnMapping<F>,
  labelFor: Record<F, string>,
): string {
  const records = parseCsvRecords(text);
  if (records.length === 0) return text;
  const header = records[0].cells;

  const labelForIndex = new Map<number, string>();
  for (const field of Object.keys(mapping) as F[]) {
    const index = mapping[field];
    if (index !== undefined) labelForIndex.set(index, labelFor[field]);
  }

  const newHeader = header.map((original, index) => labelForIndex.get(index) ?? original);
  const headerText = newHeader.map(csvField).join(",");

  // Everything after the header's own line break, verbatim — including a
  // file with no body at all, where there is nothing to keep.
  const lineBreak = /\r\n|\r|\n/.exec(text);
  const rest = lineBreak ? text.slice(lineBreak.index) : "";
  return headerText + rest;
}
