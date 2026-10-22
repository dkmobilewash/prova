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
  type ImportKind,
} from "./spreadsheet-import";
import type { ColumnMapping } from "./import-mapping";

/**
 * THE FIRST LAYER OF "BRING IN WHAT YOU ALREADY HAVE": a proposed column
 * mapping from header text alone, with no model.
 *
 * It only PROPOSES. What it returns becomes the starting point of the
 * per-column review in components/SpreadsheetImport.tsx, and that review's
 * choice is applied by `applyColumnMapping` (lib/import-mapping.ts), which
 * rewrites the header line and nothing else — so the parser, the 500-row cap,
 * the SSN refusals and the one insert path per kind in
 * lib/actions/spreadsheetImport.ts are exactly the ones a hand-typed CSV goes
 * through. There is no second write path here and there must never be one.
 *
 * Two confidences come out of this file:
 *   - "exact": the header is one of the parser's own aliases (the
 *     `*_COLUMNS` tables in lib/spreadsheet-import.ts), i.e. the import
 *     would have read it that way with no help.
 *   - "synonym": the header matches the wider dictionary below, after
 *     `headerKey` folds "#", "No", "No." and "Num" to "number" and drops
 *     punctuation and spaces — "Cust. Name", "Job No.", "Phone#".
 * The third, "ai", is the model layer (lib/actions/importSuggest.ts) and only
 * ever sees the columns left over after this one.
 *
 * WHY A PRIORITY LIST AND NOT `mapColumns`. `mapColumns` gives a field the
 * FIRST column, left to right, whose header is any alias. A Sage 100
 * Contractor job list reads "Job#, Job Name, Client" — and "job#" is a name
 * alias, so the job NUMBER became the job name. Here each field takes the
 * column whose header sits highest in that field's list, so "Job Name" beats
 * "Job#" wherever the two columns are. Fields choose in declaration order.
 *
 * ── SOURCES, AND WHAT IS NOT VERIFIED ──
 * Every vendor header below is marked either with the page it was read from
 * or with "unverified" — meaning inferred from the vendor's screen labels,
 * third-party guides or common practice, never from a real export file,
 * which nobody on this build has. An unverified synonym is cheap when wrong:
 * it is a proposal in a dropdown, labelled "matched a similar name".
 *
 *  [S1] Sage 100 Contractor, Entering jobs (3-5 Jobs): "Job#, Job Name, Short
 *       Name … Client, Address 1 …" — https://help-sage100contractor.na.sage.com/Sage100Contractor/US/26_1/Content/Modules/3-Accounts%20Receivable/Entering%20jobs.htm
 *       (read 2026-09-19, see lib/import-presets.ts).
 *  [S2] Sage 100 Contractor, Entering receivable clients (3-6): "Client
 *       Name, Short Name, Status, Type, Address 1, City, State, Zip … Contact
 *       Name, Phone#, Email, Cell#, Fax# … Bill Address 1" —
 *       https://help-sage100contractor.na.sage.com/Sage100Contractor/US/21_2/Content/Modules/3-Accounts_Receivable/Entering_receivable_clients.htm
 *       (read 2026-10-21).
 *  [S3] Sage 100 Contractor, Entering cost codes: "Cost Code#, Description,
 *       Unit" — sage100contractorhelp.sagecre.com (read 2026-09-19).
 *  [Q1] QuickBooks Online Customers page export: "Customer, Company,
 *       Address, Phone, Email, Attachments, Open Balance, Notes" — described
 *       by https://www.thebricks.com/resources/guide-how-to-export-customer-list-from-quickbooks-to-excel
 *       (third-party; unverified against a real file).
 *  [Q2] QuickBooks Desktop Customer:Job list export ("Customer", "Main
 *       Phone", "Main Email", "Bill to 1", "Job Status", "Start Date",
 *       "Projected End", "Job Description") — unverified; Intuit's own help
 *       (https://quickbooks.intuit.com/learn-support/en-za/importing-and-exporting-data/export-customer-data-to-excel/00/382072)
 *       describes the export but names no columns.
 *  [J1] Jobber client export/import: company name or "Organization name",
 *       "Main Phone", "Mobile" — https://help.getjobber.com/es/articles/import-clients/
 *       (import headers; the export page https://help.getjobber.com/hc/en-us/articles/115009619328
 *       names no columns, so the export side is unverified).
 *  [J2] Jobber jobs report ("Job #", "Client name", "Title", "Schedule start
 *       date", "Closed date", "Job status") — unverified.
 *  [F1] Foundation Software ("Job No.", "Description", "Customer", "Cost
 *       Code") — unverified; Foundation's docs sit behind a client login
 *       (see lib/import-presets.ts for the 2026-09-19 search that found
 *       nothing citable).
 */

export type MapConfidence = "exact" | "synonym" | "ai";

/** Each kind's parser aliases, keyed the way `mapColumns` reads them. */
export const PARSER_ALIASES: Record<ImportKind, Record<string, readonly string[]>> = {
  clients: CLIENT_COLUMNS,
  jobs: JOB_COLUMNS,
  crew: CREW_COLUMNS,
  costCodes: PHASE_CODE_COLUMNS,
};

export const KIND_FIELD_OPTIONS: Record<ImportKind, FieldOption<string>[]> = {
  clients: CLIENT_FIELD_OPTIONS,
  jobs: JOB_FIELD_OPTIONS,
  crew: CREW_FIELD_OPTIONS,
  costCodes: PHASE_CODE_FIELD_OPTIONS,
};

export const KIND_WORDS: Record<ImportKind, string> = {
  clients: "Clients and GCs",
  jobs: "Jobs",
  crew: "Crew",
  costCodes: "Cost codes",
};

/**
 * The synonym dictionary, per kind and field, BEST FIRST. Parser aliases
 * not named here are appended after these by `priorityList`, so every
 * header the parser reads is still reachable — `import-smart-map.test.ts`
 * asserts that rather than trusting this comment.
 */
export const SYNONYMS: Record<ImportKind, Record<string, readonly string[]>> = {
  clients: {
    name: [
      "client name", "company name", "customer name", "company", "customer", "client",
      "display name", // [J1] unverified
      "organization name", "organization", "org", // [J1]
      "cust name", "cust", "customer company", "bill to", "bill to name", "account name", "account",
      "gc", "gc name", "general contractor", "builder", "name",
      "contact name", "contact", // last: on a Sage [S2] or QuickBooks sheet this is a PERSON
    ],
    type: ["type", "client type", "customer type", "contact type", "account type", "category", "kind"], // [S2] "Type"
    email: [
      "email", "e mail", "email address", "main email", // [Q2] unverified
      "emails", "e mails", "primary email", "statement email", // [S2]
    ],
    phone: [
      "phone", "phone number", "main phone", // [Q2] unverified, [J1]
      "phone#", "phone numbers", "office phone", "work phone", "business phone", "telephone", "tel",
      "cell#", "cell", "mobile", "mobile phone", // [S2] Cell#, [J1] Mobile
    ],
    address: [
      "address", "address 1", // [S2]
      "street address", "mailing address", "billing address", "bill address 1", // [S2]
      "bill to 1", "bill to address", // [Q2] unverified
      "billing street 1", "street", "address line 1", // [J1] unverified
    ],
  },
  jobs: {
    name: [
      "job name", // [S1]
      "project name", "job title", "project title",
      "title", // [J2] unverified
      "job", "project", "name",
      "job description", "description", // [F1] unverified: Foundation names a job by its description
      // A job NUMBER only becomes the name when the file has nothing better —
      // C Stream has no separate job-number field (adding one is a schema change).
      "job#", "job number", "project number", "contract number", // [S1] Job#, [J2] Job #, [F1] Job No.
    ],
    client: [
      "client", // [S1]
      "client name", "customer", "customer name", // [Q1] [J2] [F1]
      "cust name", "cust", "bill to", "bill to name", "gc", "gc name", "general contractor", "builder",
      "owner", "company", "contact",
      "customer job", // [Q2] "Customer:Job" — unverified, and holds "Customer:Job" pairs
    ],
    status: ["status", "job status", "project status", "stage"], // [Q2] [J2] unverified
    startDate: [
      "start date", "start", "starts", "begin", "begin date", "start on",
      "schedule start date", "scheduled start", "projected start", "estimated start", "actual start", // [J2] [Q2] unverified
    ],
    endDate: [
      "end date", "end", "ends", "finish", "finish date", "completion", "completion date",
      "projected end", "closed date", "estimated completion", "substantial completion", "actual end", // [Q2] [J2] unverified
    ],
    scope: ["scope", "scope of work", "work", "notes", "job description", "description", "project description"],
  },
  crew: {
    legalFirstName: ["first name", "legal first name", "first", "given name", "firstname", "employee first name"],
    legalMiddleName: ["middle name", "legal middle name", "middle", "middle initial", "mi", "m i"],
    legalLastName: ["last name", "legal last name", "last", "surname", "family name", "lastname", "employee last name"],
    employeeNumber: [
      "employee number", "employee#", "employee id", "emp number", "emp id", "badge number", "badge",
      "payroll number", "payroll id", "worker id", // "Employee#" folds to "employee number"
    ],
    identifyingNumberLast4: ["ssn last 4", "last 4 of ssn", "last 4 ssn", "last 4", "last four", "ssn4", "last4"],
    phone: ["phone", "phone number", "phone#", "cell", "cell#", "mobile", "telephone", "home phone"],
    addressLine1: ["address", "address 1", "address line 1", "street", "street address"],
    addressLine2: ["address 2", "address line 2", "apt", "suite", "unit"],
    city: ["city", "town"],
    state: ["state", "st"],
    zip: ["zip", "zip code", "zipcode", "postal code"],
    hiredOn: ["hire date", "hired on", "date hired", "hired", "start date", "date of hire"], // unverified
  },
  costCodes: {
    code: [
      "cost code", // [S3] "Cost Code#" folds to "cost code number"
      "cost code number", "code", "phase code", "phase", "phase number", "cc", "cost code id", "job cost code",
    ],
    name: ["description", "name", "cost code description", "phase description", "phase name", "cost code name"], // [S3] [F1]
    unit: ["unit", "uom", "unit of measure", "units"], // [S3]
  },
};

/**
 * What two headers are compared under for a SYNONYM match: the parser's own
 * normalisation, then "#", "no", "num", "nbr" read as "number" and every
 * remaining non-letter-or-digit dropped. "Job No.", "Job #", "job number"
 * and "JOB_NUMBER" are one key.
 */
export function headerKey(header: string): string {
  return normaliseHeader(header)
    .replace(/#/g, " number ")
    .replace(/\b(no|num|nbr)\b/g, "number")
    .replace(/[^a-z0-9]+/g, "");
}

function priorityList(kind: ImportKind, field: string): string[] {
  const own = SYNONYMS[kind][field] ?? [];
  const parser = PARSER_ALIASES[kind][field] ?? [];
  const keys: string[] = [];
  for (const text of [...own, ...parser]) {
    const key = headerKey(text);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export type ColumnProposal = { field: string | null; confidence: MapConfidence | null };

/**
 * One proposal per column of `header`, in column order. Fields choose in
 * the order `KIND_FIELD_OPTIONS` lists them — the name and client before scope,
 * each taking the free column whose header ranks highest in its list.
 */
export function proposeColumns(kind: ImportKind, header: string[]): ColumnProposal[] {
  const keys = header.map(headerKey);
  const proposals: ColumnProposal[] = header.map(() => ({ field: null, confidence: null }));
  for (const { field } of KIND_FIELD_OPTIONS[kind]) {
    const list = priorityList(kind, field);
    let index = -1;
    let bestRank = Infinity;
    for (let at = 0; at < keys.length; at++) {
      if (proposals[at].field !== null || !keys[at]) continue;
      const rank = list.indexOf(keys[at]);
      if (rank !== -1 && rank < bestRank) {
        index = at;
        bestRank = rank;
      }
    }
    if (index === -1) continue;
    const exact = (PARSER_ALIASES[kind][field] ?? []).includes(normaliseHeader(header[index]));
    proposals[index] = { field, confidence: exact ? "exact" : "synonym" };
  }
  return proposals;
}

/** The `{ field: column }` shape `applyColumnMapping` takes. */
export function toMapping(proposals: { field: string | null }[]): ColumnMapping<string> {
  const mapping: ColumnMapping<string> = {};
  proposals.forEach((proposal, index) => {
    if (proposal.field) mapping[proposal.field] = index;
  });
  return mapping;
}

/**
 * Which kind of file this probably is, from its headers. Scored by how
 * COMPLETE each kind's required fields are (×10) plus how many columns it
 * placed, so a "Name, Email" sheet reads as clients (1 of 1 required) rather
 * than jobs (1 of 2). Ties go to the earlier kind. Null when no kind places
 * a single required field — the person is asked instead.
 */
export function detectKind(header: string[]): ImportKind | null {
  let best: { kind: ImportKind; score: number } | null = null;
  for (const kind of Object.keys(KIND_FIELD_OPTIONS) as ImportKind[]) {
    const proposals = proposeColumns(kind, header);
    const required = KIND_FIELD_OPTIONS[kind].filter((option) => option.required);
    const found = required.filter((option) => proposals.some((p) => p.field === option.field)).length;
    if (found === 0) continue;
    const score = (found / required.length) * 10 + proposals.filter((p) => p.field).length;
    if (!best || score > best.score) best = { kind, score };
  }
  return best?.kind ?? null;
}

/** At most this many sample rows ever leave the browser for a suggestion. */
export const MAX_SAMPLE_ROWS = 5;
const MAX_CELL = 80;

/**
 * What the model is allowed to see of one column: its header and at most
 * five values, each cut to 80 characters with EVERY DIGIT masked as "#".
 * The shape of a phone, a date or an SSN is what tells a column apart; the
 * number itself is none of the model's business — and a crew sheet can
 * carry whole Social Security numbers.
 */
export function sampleForModel(header: string, values: string[]): { header: string; samples: string[] } {
  const mask = (text: string) => text.slice(0, MAX_CELL).replace(/\d/g, "#");
  return {
    header: header.slice(0, MAX_CELL),
    samples: values
      .slice(0, MAX_SAMPLE_ROWS)
      .map((value) => mask(value.trim()))
      .filter(Boolean),
  };
}

/** A column's state on the review screen: the three machine confidences,
 * "you" for a person's own pick, null for a skipped column. */
export type ReviewedColumn = { field: string | null; confidence: MapConfidence | "you" | null };

/** One dropdown change, in the order it was made. `field: null` = skip. */
export type ColumnOverride = { index: number; field: string | null };

/**
 * The review screen's answer, layered: the dictionary's proposals, then the
 * model's guesses for columns still empty (and only for fields still free),
 * then the person's own picks IN THE ORDER MADE — a pick takes its field off
 * whichever column held it, so a field is never on two columns. A person's
 * pick always wins; nothing a model says can overwrite one.
 */
export function resolveColumns(
  proposals: ColumnProposal[],
  aiMatches: Record<number, string>,
  overrides: ColumnOverride[],
): ReviewedColumn[] {
  const out: ReviewedColumn[] = proposals.map((proposal) => ({ ...proposal }));
  for (const [key, field] of Object.entries(aiMatches)) {
    const index = Number(key);
    if (!out[index] || out[index].field !== null) continue;
    if (out.some((column) => column.field === field)) continue;
    out[index] = { field, confidence: "ai" };
  }
  for (const { index, field } of overrides) {
    if (!out[index]) continue;
    if (field !== null) {
      for (const column of out) {
        if (column.field === field) {
          column.field = null;
          column.confidence = null;
        }
      }
    }
    out[index] = { field, confidence: field === null ? null : "you" };
  }
  return out;
}
