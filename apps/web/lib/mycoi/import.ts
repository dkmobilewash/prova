import {
  NOTHING_TO_IMPORT,
  applyCap,
  clean,
  mapColumns,
  nameKey,
  parseSheetDate,
  readRecords,
  type ExistingMatch,
  type RowProblem,
} from "@/lib/spreadsheet-import";
import { coverageKey } from "@/lib/coi-standing";

/**
 * Certificates of insurance from a myCOI (illumend) export, into C Stream's
 * own compliance documents.
 *
 * WHY A FILE AND NOT THE API. myCOI — now illumend — says it has a REST API
 * but publishes no developer documentation, no authentication guide and no
 * self-serve key (researched 2026-09-18; the sources are in the PR and in
 * lib/mycoi/api.ts). A file export is the one path that works for a myCOI
 * customer today without a contract with them, so it is the one built.
 *
 * WHAT THIS DOES NOT KNOW, said plainly: the exact column headers of a real
 * myCOI export. Nobody on this project has one. So the columns are matched
 * by the same forgiving alias table every importer here uses, and the
 * aliases below are ordinary insurance words (Insured, Coverage,
 * Expiration…), not a copy of myCOI's layout. The preview names every
 * column it did not use, so a file that does not fit says so on screen
 * instead of importing half of itself.
 *
 * WHAT A ROW BECOMES. One ComplianceDocument of type
 * CERTIFICATE_OF_INSURANCE per vendor per line of cover — not a new model.
 * It then reaches the renewal alerts, the /compliance list and the /vendors
 * standing through the paths every COI already takes. "Expired" is never
 * written anywhere: it is the expiry date compared with today, per read.
 *
 * Same shape as lib/spreadsheet-import.ts, on purpose: a pure function over
 * the pasted text, run in the browser for the preview and again on the
 * server, inside the transaction that writes, against a fresh read.
 */

export const COI_COLUMNS = {
  vendor: [
    "vendor",
    "vendor name",
    "insured",
    "insured name",
    "named insured",
    "subcontractor",
    "subcontractor name",
    "sub",
    "partner",
    "partner name",
    "business",
    "business name",
    "company",
    "company name",
    "name",
  ],
  coverage: [
    "coverage",
    "coverage type",
    "coverage line",
    "line of coverage",
    "policy type",
    "insurance type",
    "type of insurance",
    "type",
  ],
  expires: [
    "expiration",
    "expiration date",
    "expires",
    "expires on",
    "expiry",
    "expiry date",
    "exp date",
    "exp",
    "policy expiration",
    "policy expiration date",
    "policy exp",
  ],
  effective: ["effective", "effective date", "policy effective", "policy effective date", "eff date"],
  carrier: ["carrier", "insurer", "insurance company", "insurance carrier", "company providing coverage"],
  policyNumber: ["policy number", "policy #", "policy no", "policy num", "policy"],
  status: ["status", "compliance status", "compliance", "compliant"],
} as const;

/** The words people and exports use for the four common lines, mapped to
 * one label each so a re-import's "GL" and a first import's "General
 * Liability" are the same line. Anything else is kept as written. */
const COVERAGE_WORDS: Record<string, string> = {
  gl: "General liability",
  cgl: "General liability",
  "general liability": "General liability",
  "commercial general liability": "General liability",
  auto: "Automobile liability",
  "auto liability": "Automobile liability",
  automobile: "Automobile liability",
  "automobile liability": "Automobile liability",
  "business auto": "Automobile liability",
  al: "Automobile liability",
  wc: "Workers' compensation",
  "workers comp": "Workers' compensation",
  "workers compensation": "Workers' compensation",
  "work comp": "Workers' compensation",
  "workers compensation and employers liability": "Workers' compensation",
  umbrella: "Umbrella / excess",
  excess: "Umbrella / excess",
  "umbrella liability": "Umbrella / excess",
  "excess liability": "Umbrella / excess",
  "umbrella excess": "Umbrella / excess",
};

export function normaliseCoverage(raw: string): string | null {
  const value = clean(raw);
  if (value === "") return null;
  const key = value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z]+/g, " ").trim();
  return COVERAGE_WORDS[key] ?? value;
}

export type CoiRecord = {
  line: number;
  vendorName: string;
  coverage: string | null;
  carrier: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  expiresOn: string;
  /** What myCOI said about compliance when the file was exported. Their
   * verdict, recorded as theirs — C Stream derives nothing from it. */
  sourceStatus: string | null;
};

export type CoiParse = {
  records: CoiRecord[];
  problems: RowProblem[];
  ignoredColumns: string[];
  /** The file has no coverage column, so no row names a line — said in the
   * preview, because it means a later renewal will not replace these rows. */
  noCoverageColumn: boolean;
};

/** The file -> records. No knowledge of what C Stream already has. */
export function readCoiExport(text: string): CoiParse {
  const records = readRecords(text);
  if (!records) return { records: [], problems: [NOTHING_TO_IMPORT], ignoredColumns: [], noCoverageColumn: false };

  const { mapping, ignoredColumns } = mapColumns(records.header, COI_COLUMNS);
  const missing: string[] = [];
  if (mapping.vendor === undefined) missing.push("a vendor column (Vendor, Insured or Company)");
  if (mapping.expires === undefined) missing.push("an expiration column (Expiration or Expires)");
  if (missing.length > 0) {
    return {
      records: [],
      problems: [{ line: 1, message: `The first row must name the columns, and this file has no ${missing.join(" and no ")}.` }],
      ignoredColumns,
      noCoverageColumn: mapping.coverage === undefined,
    };
  }

  const problems: RowProblem[] = [];
  let rows: CoiRecord[] = [];
  for (const { line, cells } of records.body) {
    const cell = (field: keyof typeof COI_COLUMNS) => {
      const at = mapping[field];
      return at === undefined ? undefined : cells[at];
    };
    const vendorName = clean(cell("vendor"));
    if (vendorName === "") {
      problems.push({ line, message: "No vendor name — skipped." });
      continue;
    }
    const expires = parseSheetDate(cell("expires"));
    if (!expires.ok) {
      problems.push({ line, message: `${vendorName} — ${expires.message}.` });
      continue;
    }
    if (expires.value === null) {
      problems.push({
        line,
        message: `${vendorName} — no expiration date, so there is nothing to warn you about. Skipped.`,
      });
      continue;
    }
    const effective = parseSheetDate(cell("effective"));
    if (!effective.ok) {
      problems.push({ line, message: `${vendorName} — effective date: ${effective.message}.` });
      continue;
    }
    rows.push({
      line,
      vendorName,
      coverage: normaliseCoverage(cell("coverage") ?? ""),
      carrier: clean(cell("carrier")) || null,
      policyNumber: clean(cell("policyNumber")) || null,
      effectiveDate: effective.value,
      expiresOn: expires.value,
      sourceStatus: clean(cell("status")) || null,
    });
  }
  rows = applyCap(rows, problems);
  problems.sort((a, b) => a.line - b.line);
  return { records: rows, problems, ignoredColumns, noCoverageColumn: mapping.coverage === undefined };
}

/** A COI already on file, as far as "is this the same certificate" needs. */
export type ExistingCoi = { partyName: string; coverageType: string | null; expiresOn: string | null };

/** Who in C Stream a vendor name matches, for the preview. */
export type PartyMatch =
  | { kind: "vendor"; name: string }
  | { kind: "contact"; name: string }
  | { kind: "none" };

export type KnownParties = { vendors: string[]; subsAndSuppliers: string[] };

export type CoiPlanRow = CoiRecord & { match: PartyMatch };

export type CoiPlan = {
  create: CoiPlanRow[];
  existing: ExistingMatch[];
  problems: RowProblem[];
  ignoredColumns: string[];
  noCoverageColumn: boolean;
};

function sameKey(party: string, coverage: string | null, expiresOn: string | null): string {
  return [nameKey(party), coverage ? coverageKey(coverage) : "", expiresOn ?? ""].join(" ");
}

export function coiLabel(row: Pick<CoiRecord, "vendorName" | "coverage" | "expiresOn">): string {
  return `${row.vendorName}${row.coverage ? ` — ${row.coverage}` : ""}, expires ${row.expiresOn}`;
}

/**
 * The records against what this company already has.
 *
 * "Already here" is the same party, the same line of cover and the same
 * expiry date — the same certificate. A renewal has a new date, so it is
 * NEW, and it is the new row that makes the old one stop alerting
 * (lib/coi-standing.ts). Importing the same export twice creates nothing
 * the second time.
 */
export function planCoiImport(parse: CoiParse, existing: ExistingCoi[], known: KnownParties): CoiPlan {
  const have = new Set(existing.map((row) => sameKey(row.partyName, row.coverageType, row.expiresOn)));
  const vendors = new Map(known.vendors.map((name) => [nameKey(name), name]));
  const contacts = new Map(known.subsAndSuppliers.map((name) => [nameKey(name), name]));
  const problems = [...parse.problems];
  const firstLine = new Map<string, number>();
  const plan: CoiPlan = {
    create: [],
    existing: [],
    problems,
    ignoredColumns: parse.ignoredColumns,
    noCoverageColumn: parse.noCoverageColumn,
  };

  for (const record of parse.records) {
    const key = sameKey(record.vendorName, record.coverage, record.expiresOn);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      problems.push({ line: record.line, message: `${coiLabel(record)} — same as line ${earlier}, so it's only added once.` });
      continue;
    }
    firstLine.set(key, record.line);
    if (have.has(key)) {
      plan.existing.push({ line: record.line, label: coiLabel(record) });
      continue;
    }
    const party = nameKey(record.vendorName);
    const match: PartyMatch = vendors.has(party)
      ? { kind: "vendor", name: vendors.get(party)! }
      : contacts.has(party)
        ? { kind: "contact", name: contacts.get(party)! }
        : { kind: "none" };
    plan.create.push({ ...record, match });
  }
  problems.sort((a, b) => a.line - b.line);
  return plan;
}

/**
 * What goes in the document's notes: where it came from, and the facts the
 * schema has no column for. myCOI's own compliance verdict is quoted as
 * theirs and dated, never turned into a C Stream status.
 */
export function coiNotes(row: CoiRecord, importedOn: string): string {
  const parts = [`Imported from a myCOI export on ${importedOn}.`];
  if (row.carrier) parts.push(`Carrier: ${row.carrier}.`);
  if (row.policyNumber) parts.push(`Policy: ${row.policyNumber}.`);
  if (row.sourceStatus) parts.push(`myCOI status in the export: ${row.sourceStatus}.`);
  return parts.join(" ");
}

export const COI_TEMPLATE = {
  fileName: "mycoi-certificates-template.csv",
  csv: "Vendor,Coverage,Carrier,Policy number,Effective date,Expiration date,Status\nAcme Scaffold LLC,General liability,Example Mutual,GL-12345,2026-01-01,2027-01-01,Compliant\n",
};
