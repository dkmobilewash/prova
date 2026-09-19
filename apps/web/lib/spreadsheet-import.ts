import { MAX_IMPORT_ROWS, parseCsvRecords, type RowProblem } from "./catalog-import";

/**
 * Getting a contractor's existing clients, jobs and crew in without typing
 * them one at a time.
 *
 * A new contractor's records live in a spreadsheet, a QuickBooks export, or
 * their head. Until this existed the only way in was one form per record,
 * and a sub with forty open jobs and a twenty-five-hand crew does not do
 * that — they keep the spreadsheet, and the product never sees their work.
 *
 * Same shape as lib/catalog-import.ts, on purpose, and the same parser: a
 * pure function over pasted text, run once in the browser to show the
 * preview and again on the server to decide what to write. The server never
 * trusts rows the browser sends — it re-reads the text and re-reads what
 * already exists, inside the transaction that writes.
 *
 * Every plan splits the file three ways, and a row is always in exactly one:
 *
 *   create   — will be written on Confirm;
 *   existing — already here, matched by name, case-insensitively, within
 *              this company. This is what makes importing the same file
 *              twice create nothing the second time;
 *   problems — could not be read, with the line number and a sentence.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED, and each is a decision rather than a
 * gap:
 *
 *   - Any money figure on a job. A job's value is the sum of its line items
 *     (ARCHITECTURE.md: one place line-item data lives), so there is no
 *     contract-value column to import it into, and inventing one would be
 *     a second truth the first would disagree with.
 *   - A job status beyond Estimate. Leaving Estimate is `markJobContracted`
 *     and only it, because that is where the evidence gate is — at least
 *     one line item, and a signed contract or a recorded executed one
 *     (lib/job-status-transitions.ts). An import that wrote CONTRACTED
 *     would be a second door into the billable state with no evidence
 *     behind it, and would strand the job besides: a contracted job's line
 *     items can only be added by change order, and an imported job has
 *     none. So the status column is READ, and every job lands as an
 *     estimate with the preview saying so, row by row.
 *   - More than four digits of anyone's Social Security number, ever. See
 *     `parseLast4`.
 */

export { MAX_IMPORT_ROWS };
export type { RowProblem };

export type ImportKind = "clients" | "jobs" | "crew";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** What two names are compared under to decide "same record": trimmed,
 * inner whitespace collapsed, lower-cased. "ACME  Builders " and "Acme
 * Builders" are one client. */
export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A cell's text with the edges trimmed and inner runs of spaces collapsed. */
export function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-.:*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which column holds each field, and which headers were not used.
 *
 * Fields are tried in the order the alias table declares them and a column
 * is only ever given to one field, so an alias two fields share goes to
 * the first. */
export function mapColumns<F extends string>(header: string[], aliases: Record<F, readonly string[]>) {
  const normalised = header.map(normaliseHeader);
  const mapping: Partial<Record<F, number>> = {};
  const used = new Set<number>();

  for (const field of Object.keys(aliases) as F[]) {
    const index = normalised.findIndex((h, i) => !used.has(i) && aliases[field].includes(h));
    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }

  const ignoredColumns = header
    .map((raw, i) => ({ raw: raw.trim(), i }))
    .filter(({ raw, i }) => raw !== "" && !used.has(i))
    .map(({ raw }) => raw);
  return { mapping, ignoredColumns };
}

type Records = { header: string[]; body: { line: number; cells: string[] }[] } | null;

export function readRecords(text: string): Records {
  const records = parseCsvRecords(text);
  if (records.length === 0) return null;
  return { header: records[0].cells, body: records.slice(1) };
}

export const NOTHING_TO_IMPORT: RowProblem = { line: 1, message: "Nothing to import." };

/** The catalog importer's cap, applied the same way: readable rows past
 * the limit are left out, and the first one left out is named. */
export function applyCap<R extends { line: number }>(rows: R[], problems: RowProblem[]): R[] {
  if (rows.length <= MAX_IMPORT_ROWS) return rows;
  problems.push({
    line: rows[MAX_IMPORT_ROWS].line,
    message: `Only the first ${MAX_IMPORT_ROWS} rows will be imported — ${
      rows.length - MAX_IMPORT_ROWS
    } more were left out. Split the file and import again.`,
  });
  return rows.slice(0, MAX_IMPORT_ROWS);
}

/**
 * The biggest paste or file a confirm can send, in BYTES.
 *
 * Below Next's 1 MB Server Action body limit (next.config.mjs sets no
 * `serverActions.bodySizeLimit`), with room for the form encoding. A text
 * over Next's limit never reaches the action: the request throws, production
 * redacts the message, and the person gets the error page instead of a
 * sentence. So the browser checks this before sending and the action checks
 * it again. Bytes, not characters: an accented name is two bytes a letter.
 */
export const MAX_IMPORT_BYTES = 900_000;

export const TOO_LARGE_MESSAGE = "That is more than 900 KB of text — split it and import in parts.";

export function importTooLarge(text: string): boolean {
  return new TextEncoder().encode(text).length > MAX_IMPORT_BYTES;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The same email check the sheet importer applies, for the Jobber import. */
export function looksLikeEmail(value: string): boolean {
  return EMAIL.test(value);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export type DateCell = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * A calendar day typed into a spreadsheet, as `YYYY-MM-DD`, or null for a
 * blank cell.
 *
 * Two shapes, because they are the two a US spreadsheet actually exports:
 * `2026-03-01` and `3/1/2026` (month first). Nothing else is guessed at:
 * `1/3/26` is ambiguous about the century and `01.03.2026` about which
 * number is the month, and a date read wrong is worse than one refused —
 * it moves a job silently.
 *
 * Impossible dates are refused rather than rolled over. `new Date(2026, 1,
 * 30)` quietly becomes March 2nd, which is exactly how 2026-02-30 would
 * otherwise import as a real day nobody typed.
 *
 * Stored at UTC midnight by `dateFromDay`, like every date in this app.
 */
export function parseSheetDate(raw: string | undefined): DateCell {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, value: null };

  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    [month, day, year] = [Number(us[1]), Number(us[2]), Number(us[3])];
  } else {
    return {
      ok: false,
      message: `couldn't read the date "${value}" — write it as 2026-03-01 or 3/1/2026`,
    };
  }

  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return { ok: false, message: `"${value}" isn't a real date` };
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return { ok: true, value: `${year}-${pad(month)}-${pad(day)}` };
}

/** `YYYY-MM-DD` to the stored UTC-midnight Date. */
export function dateFromDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/* ------------------------------------------------------------------ */
/* Clients -> Contact                                                  */
/* ------------------------------------------------------------------ */

export const CONTACT_TYPE_VALUES = [
  "GENERAL_CONTRACTOR",
  "DEVELOPER",
  "VENDOR",
  "SUBCONTRACTOR",
] as const;
export type ContactTypeValue = (typeof CONTACT_TYPE_VALUES)[number];

export const CONTACT_TYPE_WORDS: Record<ContactTypeValue, string> = {
  GENERAL_CONTRACTOR: "General contractor",
  DEVELOPER: "Developer",
  VENDOR: "Vendor",
  SUBCONTRACTOR: "Subcontractor",
};

const TYPE_WORDS: Record<string, ContactTypeValue> = {
  gc: "GENERAL_CONTRACTOR",
  "g c": "GENERAL_CONTRACTOR",
  general: "GENERAL_CONTRACTOR",
  "general contractor": "GENERAL_CONTRACTOR",
  contractor: "GENERAL_CONTRACTOR",
  "prime contractor": "GENERAL_CONTRACTOR",
  developer: "DEVELOPER",
  dev: "DEVELOPER",
  owner: "DEVELOPER",
  "owner developer": "DEVELOPER",
  vendor: "VENDOR",
  supplier: "VENDOR",
  "supply house": "VENDOR",
  sub: "SUBCONTRACTOR",
  subcontractor: "SUBCONTRACTOR",
  "sub contractor": "SUBCONTRACTOR",
};

/** A contact type from the words a person would type, or undefined when
 * the cell holds something we don't recognise. */
export function parseContactType(raw: string): ContactTypeValue | undefined {
  const key = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if ((CONTACT_TYPE_VALUES as readonly string[]).includes(raw.trim().toUpperCase())) {
    return raw.trim().toUpperCase() as ContactTypeValue;
  }
  return TYPE_WORDS[key];
}

export const CLIENT_COLUMNS = {
  name: ["name", "client", "client name", "company", "company name", "customer", "customer name", "contact", "contact name", "account", "account name"],
  type: ["type", "client type", "contact type", "account type", "kind", "category"],
  email: ["email", "e mail", "email address"],
  phone: ["phone", "phone number", "telephone", "tel", "office phone", "mobile", "cell"],
  address: ["address", "street address", "mailing address"],
} as const;

export type ClientRow = {
  line: number;
  name: string;
  accountType: ContactTypeValue;
  /** The type cell was blank and General contractor was assumed — said in
   * the preview so nobody discovers it later. */
  typeDefaulted: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type ExistingMatch = { line: number; label: string };

export type ClientPlan = {
  create: ClientRow[];
  existing: ExistingMatch[];
  problems: RowProblem[];
  ignoredColumns: string[];
};

export function planClientImport(text: string, existingContactNames: string[]): ClientPlan {
  const records = readRecords(text);
  if (!records) return { create: [], existing: [], problems: [NOTHING_TO_IMPORT], ignoredColumns: [] };

  const { mapping, ignoredColumns } = mapColumns(records.header, CLIENT_COLUMNS);
  if (mapping.name === undefined) {
    return {
      create: [],
      existing: [],
      problems: [
        {
          line: 1,
          message:
            "No name column found. The first row must name the columns — one of them called Name (or Client, or Company).",
        },
      ],
      ignoredColumns: [],
    };
  }

  const problems: RowProblem[] = [];
  let rows: ClientRow[] = [];
  for (const { line, cells } of records.body) {
    const cell = (field: keyof typeof CLIENT_COLUMNS) => {
      const at = mapping[field];
      return at === undefined ? undefined : cells[at];
    };
    const name = clean(cell("name"));
    if (name === "") {
      problems.push({ line, message: "No name — skipped." });
      continue;
    }
    const typeText = clean(cell("type"));
    const accountType = typeText === "" ? "GENERAL_CONTRACTOR" : parseContactType(typeText);
    if (!accountType) {
      problems.push({
        line,
        message: `${name} — type "${typeText}" isn't one we know. Use GC, Developer, Vendor or Sub.`,
      });
      continue;
    }
    const email = clean(cell("email"));
    if (email !== "" && !EMAIL.test(email)) {
      problems.push({ line, message: `${name} — "${email}" doesn't look like an email address.` });
      continue;
    }
    const phone = clean(cell("phone"));
    const address = clean(cell("address"));
    rows.push({
      line,
      name,
      accountType,
      typeDefaulted: typeText === "",
      email: email || null,
      phone: phone || null,
      address: address || null,
    });
  }
  rows = applyCap(rows, problems);

  const existing = new Set(existingContactNames.map(nameKey));
  const firstLine = new Map<string, number>();
  const plan: ClientPlan = { create: [], existing: [], problems, ignoredColumns };
  for (const row of rows) {
    const key = nameKey(row.name);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      problems.push({ line: row.line, message: `${row.name} — same name as line ${earlier}, so it's only added once.` });
      continue;
    }
    firstLine.set(key, row.line);
    if (existing.has(key)) plan.existing.push({ line: row.line, label: row.name });
    else plan.create.push(row);
  }
  problems.sort((a, b) => a.line - b.line);
  return plan;
}

/* ------------------------------------------------------------------ */
/* Jobs -> Job                                                         */
/* ------------------------------------------------------------------ */

export const JOB_STATUS_VALUES = ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"] as const;
export type SheetJobStatus = (typeof JOB_STATUS_VALUES)[number];

export const JOB_STATUS_WORDS: Record<SheetJobStatus, string> = {
  ESTIMATE: "Estimate",
  CONTRACTED: "Contracted",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

const STATUS_WORDS: Record<string, SheetJobStatus> = {
  estimate: "ESTIMATE",
  estimating: "ESTIMATE",
  bid: "ESTIMATE",
  bidding: "ESTIMATE",
  quote: "ESTIMATE",
  quoted: "ESTIMATE",
  proposal: "ESTIMATE",
  pending: "ESTIMATE",
  lead: "ESTIMATE",
  contracted: "CONTRACTED",
  contract: "CONTRACTED",
  "under contract": "CONTRACTED",
  awarded: "CONTRACTED",
  won: "CONTRACTED",
  signed: "CONTRACTED",
  "in progress": "IN_PROGRESS",
  inprogress: "IN_PROGRESS",
  active: "IN_PROGRESS",
  started: "IN_PROGRESS",
  ongoing: "IN_PROGRESS",
  underway: "IN_PROGRESS",
  "under way": "IN_PROGRESS",
  wip: "IN_PROGRESS",
  complete: "COMPLETE",
  completed: "COMPLETE",
  done: "COMPLETE",
  finished: "COMPLETE",
  closed: "COMPLETE",
};

export function parseJobStatus(raw: string): SheetJobStatus | undefined {
  const key = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return STATUS_WORDS[key];
}

export const JOB_COLUMNS = {
  name: ["job", "job name", "name", "project", "project name", "job title"],
  client: ["client", "client name", "gc", "general contractor", "customer", "customer name", "contact", "company", "builder"],
  status: ["status", "job status", "stage"],
  startDate: ["start", "start date", "starts", "begin", "begin date", "start on"],
  endDate: ["end", "end date", "ends", "finish", "finish date", "completion", "completion date"],
  scope: ["scope", "scope of work", "description", "notes", "work"],
} as const;

/** Headers that look like a money figure. Never imported (see the note at
 * the top of this file); named in the preview so nobody hunts for why a
 * contract value didn't come across. */
const MONEY_HEADER = /\$|value|amount|price|total|budget|cost|revenue|^contract$|contract (sum|value|amount)/i;

export type JobClient =
  /** Matched to a contact already on this account. */
  | { kind: "existing"; name: string }
  /** First mention of a new client in this file — created by this row. */
  | { kind: "new"; name: string }
  /** A new client an earlier row of this file already creates. */
  | { kind: "new-earlier"; name: string; line: number };

export type JobRow = {
  line: number;
  name: string;
  clientName: string;
  /** What the sheet said. Every job is imported as ESTIMATE regardless —
   * see the top of this file. Null when the cell was blank. */
  sheetStatus: SheetJobStatus | null;
  startDate: string | null;
  endDate: string | null;
  scope: string | null;
};

export type JobPlanRow = JobRow & { client: JobClient };

export type JobPlan = {
  create: JobPlanRow[];
  existing: ExistingMatch[];
  problems: RowProblem[];
  ignoredColumns: string[];
  /** Ignored columns that look like money, singled out. */
  moneyColumns: string[];
  /** New clients this import will create, once each, in file order. */
  newClients: string[];
};

export type ExistingJob = { name: string; clientName: string };

function jobKey(name: string, clientName: string) {
  return `${nameKey(name)} ${nameKey(clientName)}`;
}

export function planJobImport(
  text: string,
  existingContactNames: string[],
  existingJobs: ExistingJob[],
): JobPlan {
  const empty = { create: [], existing: [], ignoredColumns: [], moneyColumns: [], newClients: [] };
  const records = readRecords(text);
  if (!records) return { ...empty, problems: [NOTHING_TO_IMPORT] };

  const { mapping, ignoredColumns } = mapColumns(records.header, JOB_COLUMNS);
  const missing = [
    mapping.name === undefined ? "Job name" : null,
    mapping.client === undefined ? "Client" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      ...empty,
      problems: [
        {
          line: 1,
          message: `No ${missing.join(" or ")} column found. The first row must name the columns — every job needs a Job name and a Client.`,
        },
      ],
    };
  }

  const problems: RowProblem[] = [];
  let rows: JobRow[] = [];
  for (const { line, cells } of records.body) {
    const cell = (field: keyof typeof JOB_COLUMNS) => {
      const at = mapping[field];
      return at === undefined ? undefined : cells[at];
    };
    const name = clean(cell("name"));
    const clientName = clean(cell("client"));
    if (name === "") {
      problems.push({ line, message: "No job name — skipped." });
      continue;
    }
    if (clientName === "") {
      problems.push({ line, message: `${name} — no client. Every job needs one.` });
      continue;
    }

    const bad: string[] = [];
    const statusText = clean(cell("status"));
    const sheetStatus = statusText === "" ? null : (parseJobStatus(statusText) ?? undefined);
    if (sheetStatus === undefined) {
      bad.push(`status "${statusText}" isn't one we know — use Estimate, Contracted, In progress or Complete`);
    }
    const start = parseSheetDate(cell("startDate"));
    const end = parseSheetDate(cell("endDate"));
    if (!start.ok) bad.push(`start date: ${start.message}`);
    if (!end.ok) bad.push(`end date: ${end.message}`);
    if (start.ok && end.ok && start.value && end.value && end.value < start.value) {
      bad.push("the end date is before the start date");
    }
    if (bad.length > 0 || sheetStatus === undefined || !start.ok || !end.ok) {
      problems.push({ line, message: `${name} — ${bad.join("; ")}.` });
      continue;
    }

    const scope = (cell("scope") ?? "").trim();
    rows.push({
      line,
      name,
      clientName,
      sheetStatus,
      startDate: start.value,
      endDate: end.value,
      scope: scope || null,
    });
  }
  rows = applyCap(rows, problems);

  const knownClients = new Set(existingContactNames.map(nameKey));
  const knownJobs = new Set(existingJobs.map((job) => jobKey(job.name, job.clientName)));
  const newClientLine = new Map<string, number>();
  const firstLine = new Map<string, number>();
  const plan: JobPlan = {
    create: [],
    existing: [],
    problems,
    ignoredColumns,
    moneyColumns: ignoredColumns.filter((header) => MONEY_HEADER.test(header)),
    newClients: [],
  };

  for (const row of rows) {
    const key = jobKey(row.name, row.clientName);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) {
      problems.push({
        line: row.line,
        message: `${row.name} for ${row.clientName} — same job as line ${earlier}, so it's only added once.`,
      });
      continue;
    }
    firstLine.set(key, row.line);

    if (knownJobs.has(key)) {
      plan.existing.push({ line: row.line, label: `${row.name} — ${row.clientName}` });
      continue;
    }

    const clientKey = nameKey(row.clientName);
    let client: JobClient;
    if (knownClients.has(clientKey)) {
      client = { kind: "existing", name: row.clientName };
    } else {
      const createdBy = newClientLine.get(clientKey);
      if (createdBy === undefined) {
        newClientLine.set(clientKey, row.line);
        plan.newClients.push(row.clientName);
        client = { kind: "new", name: row.clientName };
      } else {
        client = { kind: "new-earlier", name: row.clientName, line: createdBy };
      }
    }
    plan.create.push({ ...row, client });
  }
  problems.sort((a, b) => a.line - b.line);
  return plan;
}

/* ------------------------------------------------------------------ */
/* Crew -> CrewMember                                                  */
/* ------------------------------------------------------------------ */

/**
 * The refusal for a whole Social Security number, and it deliberately
 * never repeats the value back: a problem message is rendered on screen,
 * and the point is that the number stops travelling.
 */
export const FULL_SSN_REFUSAL =
  "this looks like a whole Social Security number. C Stream only keeps the LAST 4 digits, never the full number — delete it from your file, put just the last 4 in that column, and import again. Nothing from this row was saved.";

const LAST4_SHAPE =
  "the last-4 column must be exactly 4 digits (it looks like a leading zero may have been dropped — format that column as Text in your spreadsheet)";

export type Last4Cell = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * The last four digits of an SSN, and nothing more — ever.
 *
 * The column is CHECKed in the database to exactly four digits
 * (`CrewMember_identifying_number_last4`), and there is no column anywhere
 * for a whole number. This refuses a whole one BEFORE it gets near a query,
 * with a message a person can act on rather than a constraint violation,
 * and without echoing the value.
 *
 * Accepts `1234`, and a masked form with exactly four digits in it
 * (`XXX-XX-1234`, `***-**-1234`), since that is what a payroll export
 * that already respects the rule writes.
 */
export function parseLast4(raw: string | undefined): Last4Cell {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, value: null };

  const digits = value.replace(/\D/g, "");
  if (digits.length >= 9) return { ok: false, message: FULL_SSN_REFUSAL };
  if (/^\d{4}$/.test(value)) return { ok: true, value };

  const masked = /^[x*#•]{3}[-\s]?[x*#•]{2}[-\s]?(\d{4})$/i.exec(value);
  if (masked) return { ok: true, value: masked[1] };

  if (/^\d{1,3}$/.test(value)) return { ok: false, message: LAST4_SHAPE };
  return { ok: false, message: "the last-4 column must be exactly 4 digits" };
}

/** A whole SSN as people write one: 3-2-4 digits, split by dashes or
 * spaces. Refused in any crew column (see planCrewImport). Nine bare digits
 * are only refused where a number that long has no other reading — the
 * last-4 and employee-number columns — because a zip+4 typed without its
 * dash is nine digits too. */
const WHOLE_SSN = /^\d{3}[-\s]\d{2}[-\s]\d{4}$/;

/**
 * A whole SSN written anywhere INSIDE free text — a Jobber note, a job's
 * instructions, a phone field somebody misused. The cell check above is
 * anchored because a sheet cell holds one value; free text does not. The
 * 3-2-4 grouping is what keeps a phone number (3-3-4) out of it.
 */
export function mentionsWholeSsn(value: string | null | undefined): boolean {
  return /(^|[^\d])\d{3}[-\s]\d{2}[-\s]\d{4}($|[^\d])/.test(value ?? "");
}

/** An employee number shaped like an SSN is refused for the same reason. */
function looksLikeSsn(value: string): boolean {
  return /^\d{3}[-\s]\d{2}[-\s]\d{4}$/.test(value) || /^\d{9}$/.test(value);
}

export const CREW_COLUMNS = {
  legalFirstName: ["first", "first name", "legal first name", "given name", "firstname"],
  legalMiddleName: ["middle", "middle name", "legal middle name", "middle initial", "mi"],
  legalLastName: ["last", "last name", "legal last name", "surname", "family name", "lastname"],
  employeeNumber: [
    "employee number", "employee #", "employee no", "employee id", "emp #", "emp no", "emp id",
    "badge", "badge number", "badge #", "payroll number", "payroll id", "worker id",
  ],
  identifyingNumberLast4: [
    "last 4", "last four", "ssn last 4", "last 4 ssn", "last 4 of ssn", "ssn last four",
    "ssn", "ssn4", "last4", "social", "ss#", "ssn #", "identifying number",
  ],
  phone: ["phone", "phone number", "cell", "mobile", "telephone"],
  addressLine1: ["address", "address 1", "address line 1", "street", "street address"],
  addressLine2: ["address 2", "address line 2", "apt", "suite", "unit"],
  city: ["city", "town"],
  state: ["state", "st"],
  zip: ["zip", "zip code", "zipcode", "postal code"],
  hiredOn: ["hired", "hired on", "hire date", "date hired"],
} as const;

export type CrewRow = {
  line: number;
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
  employeeNumber: string | null;
  identifyingNumberLast4: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hiredOn: string | null;
};

export type ExistingCrew = {
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
  employeeNumber: string | null;
};

export type CrewPlan = {
  create: CrewRow[];
  existing: ExistingMatch[];
  problems: RowProblem[];
  ignoredColumns: string[];
};

export function crewName(person: {
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
}): string {
  return [person.legalFirstName, person.legalMiddleName, person.legalLastName].filter(Boolean).join(" ");
}

function crewKey(person: Parameters<typeof crewName>[0]) {
  return [person.legalFirstName, person.legalMiddleName ?? "", person.legalLastName].map(nameKey).join(" ");
}

export function planCrewImport(text: string, existingCrew: ExistingCrew[]): CrewPlan {
  const records = readRecords(text);
  if (!records) return { create: [], existing: [], problems: [NOTHING_TO_IMPORT], ignoredColumns: [] };

  const { mapping, ignoredColumns } = mapColumns(records.header, CREW_COLUMNS);
  if (mapping.legalFirstName === undefined || mapping.legalLastName === undefined) {
    return {
      create: [],
      existing: [],
      problems: [
        {
          line: 1,
          message:
            "Crew needs a First name column and a Last name column. A single Name column isn't split for you — guessing where a first name ends goes wrong on the first two-word surname, and this is the name a certified payroll prints.",
        },
      ],
      ignoredColumns: [],
    };
  }

  const problems: RowProblem[] = [];
  let rows: CrewRow[] = [];
  for (const { line, cells } of records.body) {
    const cell = (field: keyof typeof CREW_COLUMNS) => {
      const at = mapping[field];
      return at === undefined ? undefined : cells[at];
    };
    const first = clean(cell("legalFirstName"));
    const last = clean(cell("legalLastName"));
    const middle = clean(cell("legalMiddleName"));

    // Checked before anything else about the row, so a whole SSN is never
    // carried any further than this line — not into a row, not into a
    // name-based message, not into the preview. EVERY stored column is
    // checked, not only the last-4 one: phone, address and zip are free
    // text, and a sheet whose columns are one off would otherwise store the
    // number verbatim. The message names the row by first and last name
    // only, because the middle-name cell is one of the cells being checked.
    const last4 = parseLast4(cell("identifyingNumberLast4"));
    const strayWholeSsn = (Object.keys(CREW_COLUMNS) as (keyof typeof CREW_COLUMNS)[]).some(
      (field) => field !== "identifyingNumberLast4" && WHOLE_SSN.test(clean(cell(field))),
    );
    if (!last4.ok || strayWholeSsn) {
      const named = [first, last].filter(Boolean).join(" ") || "This row";
      problems.push({ line, message: `${named} — ${last4.ok ? FULL_SSN_REFUSAL : last4.message}` });
      continue;
    }
    const who = [first, middle, last].filter(Boolean).join(" ");
    if (first === "" || last === "") {
      problems.push({ line, message: `${who || "This row"} — needs both a first and a last name. Skipped.` });
      continue;
    }
    const employeeNumber = clean(cell("employeeNumber"));
    if (employeeNumber !== "" && looksLikeSsn(employeeNumber)) {
      problems.push({ line, message: `${who} — the employee number column holds something shaped like a Social Security number. C Stream never stores one. If it really is a badge number, add a letter in front of it. Nothing from this row was saved.` });
      continue;
    }
    const hired = parseSheetDate(cell("hiredOn"));
    if (!hired.ok) {
      problems.push({ line, message: `${who} — hire date: ${hired.message}.` });
      continue;
    }

    const optional = (field: keyof typeof CREW_COLUMNS) => clean(cell(field)) || null;
    rows.push({
      line,
      legalFirstName: first,
      legalMiddleName: middle || null,
      legalLastName: last,
      employeeNumber: employeeNumber || null,
      identifyingNumberLast4: last4.value,
      phone: optional("phone"),
      addressLine1: optional("addressLine1"),
      addressLine2: optional("addressLine2"),
      city: optional("city"),
      state: optional("state"),
      zip: optional("zip"),
      hiredOn: hired.value,
    });
  }
  rows = applyCap(rows, problems);

  const byNumber = new Map<string, ExistingCrew>();
  const byName = new Map<string, ExistingCrew[]>();
  for (const person of existingCrew) {
    if (person.employeeNumber) byNumber.set(person.employeeNumber.trim().toLowerCase(), person);
    const key = crewKey(person);
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }

  const plan: CrewPlan = { create: [], existing: [], problems, ignoredColumns };
  const numberLine = new Map<string, number>();
  const nameLine = new Map<string, { line: number; employeeNumber: string | null }[]>();

  for (const row of rows) {
    const name = crewName(row);
    const key = crewKey(row);
    const number = row.employeeNumber?.toLowerCase() ?? null;

    // Within the file first: a row repeated in the same upload is only
    // ever added once.
    if (number) {
      const earlier = numberLine.get(number);
      if (earlier !== undefined) {
        problems.push({ line: row.line, message: `${name} — employee number ${row.employeeNumber} is already used on line ${earlier}.` });
        continue;
      }
    }
    const sameName = nameLine.get(key) ?? [];
    const twin = sameName.find(
      (seen) => !seen.employeeNumber || !row.employeeNumber || seen.employeeNumber.toLowerCase() === number,
    );
    if (twin) {
      problems.push({ line: row.line, message: `${name} — same person as line ${twin.line}, so they're only added once.` });
      continue;
    }
    if (number) numberLine.set(number, row.line);
    nameLine.set(key, [...sameName, { line: row.line, employeeNumber: row.employeeNumber }]);

    // Then against the crew list already on this account.
    if (number) {
      const holder = byNumber.get(number);
      if (holder) {
        if (crewKey(holder) === key) {
          plan.existing.push({ line: row.line, label: name });
        } else {
          problems.push({
            line: row.line,
            message: `${name} — employee number ${row.employeeNumber} already belongs to ${crewName(holder)} on your crew list.`,
          });
        }
        continue;
      }
    }
    // Same name and nothing telling them apart is the same person. Two
    // people who share a name but carry different employee numbers are
    // two people, which is the one case a name alone cannot settle.
    const namesakes = byName.get(key) ?? [];
    const samePerson = namesakes.find((person) => !person.employeeNumber || !row.employeeNumber);
    if (samePerson) {
      plan.existing.push({ line: row.line, label: name });
      continue;
    }
    plan.create.push(row);
  }
  problems.sort((a, b) => a.line - b.line);
  return plan;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

/** The header row each downloadable template carries, plus one example
 * line so the shape is obvious when it opens in Excel. */
export const IMPORT_TEMPLATES: Record<ImportKind, { fileName: string; csv: string }> = {
  clients: {
    fileName: "c-stream-clients-template.csv",
    csv: "Name,Type,Email,Phone,Address\nAcme Builders,GC,pm@acmebuilders.com,555-201-4400,\"100 Main St, Reno NV\"\n",
  },
  jobs: {
    fileName: "c-stream-jobs-template.csv",
    csv: "Job name,Client,Status,Start date,End date,Scope\nRiverside Medical TI,Acme Builders,Estimate,2026-10-01,12/18/2026,Metal framing and drywall\n",
  },
  crew: {
    fileName: "c-stream-crew-template.csv",
    csv: "First name,Middle name,Last name,Employee number,Last 4 of SSN,Phone,Address,Address 2,City,State,Zip,Hire date\nMaria,Elena,Lopez,E-104,1234,555-201-4401,12 Oak Ave,,Reno,NV,89501,3/2/2024\n",
  },
};
