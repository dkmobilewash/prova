import {
  JOB_COLUMNS,
  PHASE_CODE_COLUMNS,
  normaliseHeader,
  type ImportKind,
} from "./spreadsheet-import";

/**
 * Named presets for known accounting-system exports: when a file's headers
 * look like that vendor's, the review screen says "Looks like a X". The
 * columns themselves are placed by lib/import-smart-map.ts, whose
 * dictionary carries these same headers; see
 * components/SpreadsheetImport.tsx.
 *
 * Presets are DATA, not a code path: this table is the only place vendor
 * knowledge lives, so adding one later is an edit here, not a new branch
 * anywhere else. `matchPreset` below is the one function that reads it.
 *
 * WHAT IS VERIFIED HERE AND WHAT IS NOT — read before adding a row.
 *
 * Sage 100 Contractor: `fieldHeaders` below is the vendor's OWN field
 * label text, read from Sage's own published help documentation on
 * 2026-09-19 (WebFetch, quoted in full in the comment on each preset).
 * That documents the DATA-ENTRY FORM's field labels, not a byte-for-byte
 * capture of an actual exported file — Sage's own docs say exporting
 * "captures all the data on any grid" (About exporting to Microsoft
 * Excel), i.e. whatever report or grid is on screen, and grid columns are
 * user-configurable. So the header TEXT below is the vendor's own naming
 * for these fields and is highly likely to be what a straightforward
 * export shows, but it was not confirmed against an actual Sage-produced
 * spreadsheet, which nobody on this build has access to. Detection is
 * kept to the two or three fields whose header text was actually read off
 * Sage's docs, never a whole row invented to look complete.
 *
 * Foundation Software: NOT verified, and deliberately not shipped as a
 * preset. Foundation's own documentation for the Job Setup and Cost Code
 * screens sits behind a client login (clients.foundationsoft.com); public
 * pages describe the FEATURES ("track actual job costs... cost code,
 * cost type") but never name the column headers a report or export
 * actually carries. Eight searches and three page fetches (2026-09-19)
 * turned up nothing citable. Rather than invent header text for a preset
 * that would claim "Detected: looks like Foundation Software" on a guess,
 * Foundation's export goes through the generic mapper only — which is the
 * primary path this feature exists for regardless, and works for any
 * export shape sight-unseen. If someone gets real column names off a
 * Foundation export later, add a preset here the same way the Sage one is
 * built, and cite the source the same way.
 */

export type ImportPreset<F extends string = string> = {
  id: string;
  vendorLabel: string;
  kind: ImportKind;
  /** The vendor's own header text for a field, exactly as documented —
   * matched case- and punctuation-insensitively via `normaliseHeader`, the
   * same normalisation `mapColumns` matches an ordinary header against. */
  fieldHeaders: Partial<Record<F, string>>;
  /** How many of `fieldHeaders`' entries must be present (normalised) in
   * the uploaded header row before this preset is offered. Below the count
   * of entries in `fieldHeaders`, one matching column is treated as too
   * weak a signal — "Client" alone is any CRM's export, not evidence of a
   * specific vendor. */
  minMatches: number;
};

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    id: "sage100contractor-jobs",
    vendorLabel: "Sage 100 Contractor",
    kind: "jobs",
    // "Job Name" and "Client" are both named on the Jobs entry screen —
    // help-sage100contractor.na.sage.com, "Entering jobs", read 2026-09-19:
    // "Header Information: Job#, Job Name, Short Name... General
    // Information Tab: Client, Address 1, Address 2, City, State, Zip...".
    fieldHeaders: { name: "Job Name", client: "Client" } satisfies Partial<
      Record<keyof typeof JOB_COLUMNS, string>
    >,
    minMatches: 2,
  },
  {
    id: "sage100contractor-costcodes",
    vendorLabel: "Sage 100 Contractor",
    kind: "costCodes",
    // sage100contractorhelp.sagecre.com, "Entering cost codes", read
    // 2026-09-19: "Cost Code#, Description, Unit, Division, CompCode1,
    // Wage Maximum, CompCode2, Department" — Division/CompCode/Wage
    // Maximum/Department are payroll fields with no home in `PhaseCode`
    // and are left out rather than forced somewhere they don't fit.
    fieldHeaders: { code: "Cost Code#", name: "Description", unit: "Unit" } satisfies Partial<
      Record<keyof typeof PHASE_CODE_COLUMNS, string>
    >,
    minMatches: 2,
  },
];

/** The best-matching preset for this kind and header row, or null. Ties
 * (more than one preset clearing its own threshold) go to whichever
 * matches the most fields, so a more specific preset beats a vaguer one. */
export function matchPreset(kind: ImportKind, header: string[]): ImportPreset | null {
  const normalised = new Set(header.map(normaliseHeader));
  let best: { preset: ImportPreset; matches: number } | null = null;
  for (const preset of IMPORT_PRESETS) {
    if (preset.kind !== kind) continue;
    const entries = Object.values(preset.fieldHeaders) as string[];
    const matches = entries.filter((text) => normalised.has(normaliseHeader(text))).length;
    if (matches < preset.minMatches) continue;
    if (!best || matches > best.matches) best = { preset, matches };
  }
  return best?.preset ?? null;
}

// `presetMapping` lived here until the smart mapper (lib/import-smart-map.ts)
// took over placing columns; a preset now only names the vendor in the
// banner, and import-presets.test.ts pins that the mapper places every
// preset header on the preset's field.
