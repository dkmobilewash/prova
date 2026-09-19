import { parseCsvRecords, type RowProblem } from "./catalog-import";
import {
  FULL_SSN_REFUSAL,
  applyCap,
  clean,
  crewName,
  dateFromDay,
  mapColumns,
  nameKey,
  parseLast4,
  parseSheetDate,
} from "./spreadsheet-import";

/**
 * Reading a weekly payroll register out of the payroll system a contractor
 * already runs — Gusto, ADP RUN, Sage 100 Contractor, Foundation — so the
 * WH-347's columns 8 and 9 stop being blocking fields.
 *
 * Same arrangement as lib/spreadsheet-import.ts, on purpose: a pure
 * function over pasted text, run in the browser for the preview and again
 * on the server inside the transaction that writes. The server never
 * trusts the browser's rows.
 *
 * WHAT WAS VERIFIED ABOUT VENDOR FORMATS, and what deliberately was not
 * (researched 2026-09-19 from the vendors' own documentation):
 *
 *   - GUSTO documents an exact column vocabulary for its report exports
 *     (docs.gusto.com, the create-report endpoint's `columns` enum):
 *     gross_earnings, net_pay, check_amount, employee_federal_income_tax,
 *     employee_social_security_tax, employee_medicare_tax,
 *     employee_state_income_tax, employee_deductions, pay_period_start,
 *     pay_period_end, check_date, employee_first_name, employee_last_name
 *     and more. Those spellings are in the alias table below, verbatim
 *     (normalised: underscores become spaces).
 *   - ADP RUN, SAGE 100 CONTRACTOR and FOUNDATION publish NO fixed
 *     register layout — all three are report-writer/column-picker exports.
 *     No column name for them is invented here; their files go through the
 *     same mapping, auto-matched where a header happens to be a common
 *     spelling and hand-mapped in the preview otherwise.
 *   - Sage's Excel export puts title/criteria rows ABOVE the header row,
 *     so the header is FOUND (the first row that maps at least three
 *     fields) rather than assumed to be row one.
 *   - Sage can include full SSNs in payroll exports and Foundation's own
 *     sample certified report shows them, which is exactly why the
 *     whole-SSN sweep below runs on EVERY cell of every row.
 *
 * SENSITIVE DATA, the two non-negotiables carried over from the crew
 * importer: a whole Social Security number anywhere in a row refuses that
 * row, without the number ever being echoed back; and only the last four
 * digits are ever stored — into the existing CrewMember field, never into
 * a register column. Bank account and routing numbers (Gusto offers them
 * as report columns) are never read at all: an unmapped column is never
 * stored, and the ones recognisably bank-shaped are named in the preview
 * as left out on purpose.
 */

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

export const REGISTER_COLUMNS = {
  /** One-column names: "Lopez, Maria Elena" or "Maria Lopez". */
  employeeName: ["employee", "employee name", "name", "worker", "worker name"],
  firstName: ["first name", "first", "employee first name", "given name", "firstname"],
  lastName: ["last name", "last", "employee last name", "surname", "lastname", "family name"],
  employeeNumber: [
    "employee number", "employee #", "employee no", "employee id", "emp #", "emp no", "emp id",
    "badge", "badge number", "badge #", "payroll id", "worker id",
  ],
  ssnLast4: [
    "last 4", "last four", "ssn last 4", "last 4 ssn", "last 4 of ssn", "ssn last four",
    "ssn", "ssn4", "last4", "social", "social security", "social security number", "ss#", "ssn #",
    "identifying number",
  ],
  periodStart: [
    "period start", "pay period start", "period begin", "pay period begin", "period beginning",
    "week start", "from",
  ],
  periodEnd: [
    "period end", "pay period end", "period ending", "pay period ending", "week end",
    "week ending", "to", "through",
  ],
  payDate: ["pay date", "check date", "paid on", "payment date"],
  hours: ["hours", "total hours", "hours worked", "total time"],
  gross: ["gross", "gross pay", "gross earnings", "gross wages", "total gross", "gross amount"],
  deductionsTotal: [
    "total deductions", "deductions", "total employee deductions", "deduction total",
  ],
  net: ["net", "net pay", "net wages", "net amount", "check amount", "take home", "net check"],
  federalTax: [
    "federal tax", "fed tax", "federal income tax", "employee federal income tax",
    "federal withholding", "fed w/h tax", "fed wh", "fit",
  ],
  socialSecurity: [
    "social security tax", "employee social security tax", "oasdi", "ss tax", "fica",
  ],
  medicare: ["medicare", "medicare tax", "employee medicare tax"],
  medicareAdditional: [
    "employee medicare additional tax", "additional medicare tax", "medicare additional",
  ],
  stateTax: [
    "state tax", "state income tax", "employee state income tax", "state withholding", "sit",
  ],
  otherDeductions: [
    "other deductions", "other", "garnishments", "union deductions", "employee deductions",
    "employee benefit contributions", "employee additional taxes",
  ],
} as const;

export type RegisterField = keyof typeof REGISTER_COLUMNS;

export const REGISTER_FIELD_LIST = Object.keys(REGISTER_COLUMNS) as RegisterField[];

/** Recognisably bank-shaped headers — never read, and said so. Gusto's
 * report builder offers both as columns, and a register that carries them
 * must not quietly become the place they live. */
const BANK_COLUMNS = new Set([
  "bank account", "bank account number", "account number", "routing number",
  "bank routing number", "bank account account number", "bank account routing number",
]);

/** Headers the Gusto docs spell exactly this way (normalised), used only
 * to LABEL the source — nothing behaves differently on the label. */
const GUSTO_MARKERS = new Set([
  "gross earnings", "net pay", "check amount", "pay period start", "pay period end",
  "check date", "employee first name", "employee last name",
  "employee federal income tax", "employee social security tax", "employee medicare tax",
]);

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-.:*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export type MoneyCell = { ok: true; cents: number | null } | { ok: false; message: string };

/** A register amount to integer cents, by string arithmetic — never a
 * float. "$1,234.56", "1234.5", "(123.45)" (accounting negative) and
 * "1234" all read; three decimal places refuse, because a truncated
 * mill is a wrong number on a federal form. */
export function parseMoneyCents(raw: string | undefined): MoneyCell {
  const value = (raw ?? "").trim();
  if (value === "") return { ok: true, cents: null };

  let text = value;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$,\s]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    return {
      ok: false,
      message: `couldn't read the amount "${value}" — write it like 1234.56`,
    };
  }
  const whole = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const cents = whole * 100 + fraction;
  if (cents > 10_000_000_00) {
    return { ok: false, message: `"${value}" doesn't look like a pay-period amount` };
  }
  return { ok: true, cents: negative ? -cents : cents };
}

/* ------------------------------------------------------------------ */
/* Names -> crew members                                               */
/* ------------------------------------------------------------------ */

export type RegisterCrew = {
  id: string;
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
  employeeNumber: string | null;
  identifyingNumberLast4: string | null;
};

/** Every spelling of a crew member's name a register plausibly prints,
 * as comparison keys. "Lopez, Maria", "Maria Lopez", "Maria Elena Lopez",
 * "Maria E Lopez", "Lopez, Maria Elena" all reach the same person. The
 * register's own cell is normalised the same way in matchCrew below. */
export function crewNameKeys(person: {
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
}): string[] {
  const f = person.legalFirstName;
  const m = person.legalMiddleName;
  const l = person.legalLastName;
  const keys = [nameKey(`${f} ${l}`)];
  if (m) {
    keys.push(nameKey(`${f} ${m} ${l}`));
    keys.push(nameKey(`${f} ${m[0]} ${l}`));
  }
  return [...new Set(keys)];
}

/** The register cell as a comparison key: comma form swapped to
 * "first … last", periods dropped so "Maria E. Lopez" matches an initial. */
export function registerNameKey(cell: string): string {
  const stripped = cell.replace(/\./g, " ");
  const comma = stripped.indexOf(",");
  const ordered =
    comma === -1 ? stripped : `${stripped.slice(comma + 1)} ${stripped.slice(0, comma)}`;
  return nameKey(ordered);
}

type CrewIndex = {
  byNumber: Map<string, RegisterCrew>;
  byNameKey: Map<string, RegisterCrew[]>;
};

function indexCrew(crew: RegisterCrew[]): CrewIndex {
  const byNumber = new Map<string, RegisterCrew>();
  const byNameKey = new Map<string, RegisterCrew[]>();
  for (const person of crew) {
    if (person.employeeNumber) byNumber.set(person.employeeNumber.trim().toLowerCase(), person);
    for (const key of crewNameKeys(person)) {
      const holders = byNameKey.get(key) ?? [];
      // The same person can produce one key twice; two PEOPLE sharing a
      // key is what the ambiguity refusal below is about.
      if (!holders.some((h) => h.id === person.id)) holders.push(person);
      byNameKey.set(key, holders);
    }
  }
  return { byNumber, byNameKey };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type RegisterRow = {
  line: number;
  crewMemberId: string;
  crewLabel: string;
  /** YYYY-MM-DD, stored at UTC midnight by the action via dateFromDay. */
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  /** Decimal as a string, e.g. "38.5" — Prisma takes it verbatim. */
  hours: string | null;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  deductionsDetail: {
    ficaCents?: number;
    federalTaxCents?: number;
    stateTaxCents?: number;
    otherCents?: number;
  } | null;
  /** True when no total-deductions column existed and the total is
   * gross − net. The preview says so; the row stores the number either way. */
  deductionsDerived: boolean;
  /** Set when the register carries a last-4 and this crew member has none
   * recorded yet — the one write outside PayrollRegisterEntry. */
  last4ToRecord: string | null;
  source: string;
};

export type ExistingRegisterEntry = {
  crewMemberId: string;
  periodStart: string;
  periodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  hours: string | null;
  payDate: string | null;
};

export type RegisterPlan = {
  create: RegisterRow[];
  update: (RegisterRow & { changed: string })[];
  unchanged: { line: number; label: string }[];
  problems: RowProblem[];
  /** File-level sentences: ignored preamble rows, bank columns left out,
   * per-row arithmetic notes. */
  notes: string[];
  headers: string[];
  headerLine: number;
  mapping: Partial<Record<RegisterField, number>>;
  ignoredColumns: string[];
  /** "gusto" when the headers are Gusto's own documented spellings;
   * otherwise "generic". A label, not behaviour. */
  source: "gusto" | "generic";
};

export type RegisterOverrides = Partial<Record<RegisterField, number | null>>;

const WHOLE_SSN = /^\d{3}[-\s]\d{2}[-\s]\d{4}$/;

const NO_TEXT: RowProblem = { line: 1, message: "Nothing to import." };

function emptyPlan(problems: RowProblem[]): RegisterPlan {
  return {
    create: [],
    update: [],
    unchanged: [],
    problems,
    notes: [],
    headers: [],
    headerLine: 1,
    mapping: {},
    ignoredColumns: [],
    source: "generic",
  };
}

/** How many register fields a candidate header row maps. Sage/Foundation
 * Excel exports carry a report title and criteria rows above the header,
 * so the header is the first row that answers at least three fields —
 * never just "row one". */
function headerScore(cells: string[]): number {
  const { mapping } = mapColumns(cells, REGISTER_COLUMNS);
  return Object.keys(mapping).length;
}

/** UTC day difference, for the weekly-period note. */
function daySpan(startDay: string, endDay: string): number {
  return Math.round((dateFromDay(endDay).getTime() - dateFromDay(startDay).getTime()) / 86_400_000);
}

export function planPayrollRegisterImport(
  text: string,
  crew: RegisterCrew[],
  existing: ExistingRegisterEntry[],
  overrides: RegisterOverrides = {},
): RegisterPlan {
  const records = parseCsvRecords(text);
  if (records.length === 0) return emptyPlan([NO_TEXT]);

  // Find the header among the first rows rather than assuming row one.
  let headerIndex = 0;
  let best = headerScore(records[0].cells);
  for (let i = 1; i < Math.min(records.length, 10); i++) {
    const score = headerScore(records[i].cells);
    if (score >= 3 && score > best) {
      headerIndex = i;
      best = score;
      break;
    }
    if (best >= 3) break;
  }
  const header = records[headerIndex];
  const body = records.slice(headerIndex + 1);

  const { mapping: autoMapping, ignoredColumns } = mapColumns(header.cells, REGISTER_COLUMNS);

  // Manual mapping from the preview wins over the alias table; null means
  // "this field is not in the file", clearing an auto-match.
  const mapping: Partial<Record<RegisterField, number>> = { ...autoMapping };
  for (const field of REGISTER_FIELD_LIST) {
    if (!(field in overrides)) continue;
    const at = overrides[field];
    if (at === null || at === undefined) delete mapping[field];
    else if (Number.isInteger(at) && at >= 0 && at < header.cells.length) mapping[field] = at;
  }

  const normalisedHeaders = header.cells.map(normaliseHeader);
  const source: RegisterPlan["source"] =
    normalisedHeaders.filter((h) => GUSTO_MARKERS.has(h)).length >= 4 ? "gusto" : "generic";

  const notes: string[] = [];
  if (headerIndex > 0) {
    notes.push(
      `${headerIndex} ${headerIndex === 1 ? "row" : "rows"} above the column headers ${
        headerIndex === 1 ? "was" : "were"
      } skipped — report titles and criteria, the way Sage and Foundation exports print them.`,
    );
  }
  const bankHeaders = header.cells.filter((h) => BANK_COLUMNS.has(normaliseHeader(h)));
  if (bankHeaders.length > 0) {
    notes.push(
      `Bank columns (${bankHeaders.join(", ")}) are left out on purpose — C Stream never stores account or routing numbers.`,
    );
  }

  const hasName =
    mapping.employeeName !== undefined ||
    (mapping.firstName !== undefined && mapping.lastName !== undefined);
  const missing: string[] = [];
  if (!hasName) missing.push("a name column (one Employee column, or First name + Last name)");
  if (mapping.periodStart === undefined) missing.push("Period start");
  if (mapping.periodEnd === undefined) missing.push("Period end");
  if (mapping.gross === undefined) missing.push("Gross pay");
  if (mapping.net === undefined) missing.push("Net pay");
  if (missing.length > 0) {
    const plan = emptyPlan([
      {
        line: header.line,
        message: `The register needs ${missing.join(", ")}. Match the columns under “How your columns were read”, or add them to the export and paste again.`,
      },
    ]);
    return { ...plan, headers: header.cells, headerLine: header.line, mapping, ignoredColumns, source, notes };
  }

  const index = indexCrew(crew);
  const problems: RowProblem[] = [];
  let rows: RegisterRow[] = [];
  const rowNotes: string[] = [];

  for (const { line, cells } of body) {
    if (cells.every((cell) => clean(cell) === "")) continue;
    const at = (field: RegisterField) => {
      const i = mapping[field];
      return i === undefined ? undefined : cells[i];
    };

    // THE SWEEP COMES FIRST and reads EVERY cell, mapped or not — same
    // rule as the crew importer, because a register whose columns are one
    // off, or that simply includes an SSN column (Sage offers one), must
    // not carry the number one line further. The row is named by its name
    // cell only, and the number is never echoed.
    const nameCell = clean(
      mapping.employeeName !== undefined
        ? cells[mapping.employeeName]
        : `${clean(at("firstName"))} ${clean(at("lastName"))}`,
    );
    const named = nameCell || "This row";
    const last4 = parseLast4(at("ssnLast4"));
    const strayWholeSsn = cells.some((cell) => WHOLE_SSN.test(clean(cell)));
    if (!last4.ok || strayWholeSsn) {
      problems.push({
        line,
        message: `${named} — ${!last4.ok ? last4.message : FULL_SSN_REFUSAL}`,
      });
      continue;
    }

    if (nameCell === "") {
      problems.push({ line, message: "This row has no name. Skipped." });
      continue;
    }

    // Who is this? Employee number first (the one identifier that cannot
    // collide), then the name, refusing ambiguity rather than guessing.
    let person: RegisterCrew | undefined;
    const number = clean(at("employeeNumber")).toLowerCase();
    if (number !== "") person = index.byNumber.get(number);
    if (!person) {
      const holders = index.byNameKey.get(registerNameKey(nameCell)) ?? [];
      if (holders.length > 1) {
        problems.push({
          line,
          message: `${named} — two or more crew members share this name. Give them employee numbers on the crew list, put an Employee number column in the register, and import again.`,
        });
        continue;
      }
      person = holders[0];
    }
    if (!person) {
      problems.push({
        line,
        message: `${named} — no crew member with this name. Add them under Settings → Import (Crew) first; the register only fills pay for people already on your crew list.`,
      });
      continue;
    }

    // The last-4 as identity check: a register row whose last-4 disagrees
    // with the crew record may be a DIFFERENT PERSON with the same name,
    // and importing their pay under this record would be wrong twice.
    if (last4.value && person.identifyingNumberLast4 && last4.value !== person.identifyingNumberLast4) {
      problems.push({
        line,
        message: `${named} — the last 4 on this row doesn't match the last 4 already recorded for this crew member, so this may be a different person. Nothing from this row was saved.`,
      });
      continue;
    }

    const start = parseSheetDate(at("periodStart"));
    const end = parseSheetDate(at("periodEnd"));
    const pay = parseSheetDate(at("payDate"));
    if (!start.ok || start.value === null) {
      problems.push({ line, message: `${named} — period start: ${start.ok ? "is blank" : start.message}.` });
      continue;
    }
    if (!end.ok || end.value === null) {
      problems.push({ line, message: `${named} — period end: ${end.ok ? "is blank" : end.message}.` });
      continue;
    }
    if (!pay.ok) {
      problems.push({ line, message: `${named} — pay date: ${pay.message}.` });
      continue;
    }
    if (end.value < start.value) {
      problems.push({ line, message: `${named} — the period ends (${end.value}) before it starts (${start.value}).` });
      continue;
    }

    const gross = parseMoneyCents(at("gross"));
    const net = parseMoneyCents(at("net"));
    const total = parseMoneyCents(at("deductionsTotal"));
    const moneyFields: [string, MoneyCell][] = [
      ["gross", gross],
      ["net", net],
      ["total deductions", total],
    ];
    const moneyProblem = moneyFields.find(
      (pair): pair is [string, { ok: false; message: string }] => !pair[1].ok,
    );
    if (moneyProblem) {
      problems.push({ line, message: `${named} — ${moneyProblem[0]}: ${moneyProblem[1].message}.` });
      continue;
    }
    if (!gross.ok || gross.cents === null) {
      problems.push({ line, message: `${named} — the gross cell is blank.` });
      continue;
    }
    if (!net.ok || net.cents === null) {
      problems.push({ line, message: `${named} — the net cell is blank.` });
      continue;
    }

    let deductionsCents: number;
    let deductionsDerived = false;
    if (total.ok && total.cents !== null) {
      deductionsCents = total.cents;
      if (gross.cents - deductionsCents !== net.cents) {
        rowNotes.push(
          `Line ${line}: ${named} — gross minus total deductions doesn't equal net (reimbursements, or a column this mapping missed?). All three are stored as the register says them.`,
        );
      }
    } else {
      deductionsCents = gross.cents - net.cents;
      deductionsDerived = true;
      if (deductionsCents < 0) {
        problems.push({
          line,
          message: `${named} — net is larger than gross and there is no total-deductions column, so deductions can't be derived. Map a Total deductions column.`,
        });
        continue;
      }
    }

    // Itemised detail, only from columns the register actually has.
    // FICA on the form is Social Security + Medicare; "other" is either the
    // register's own column or the remainder that makes the parts reach the
    // total — arithmetic on the row's own figures, never an invented split.
    const parts: Record<string, MoneyCell> = {
      socialSecurity: parseMoneyCents(at("socialSecurity")),
      medicare: parseMoneyCents(at("medicare")),
      medicareAdditional: parseMoneyCents(at("medicareAdditional")),
      federalTax: parseMoneyCents(at("federalTax")),
      stateTax: parseMoneyCents(at("stateTax")),
      otherDeductions: parseMoneyCents(at("otherDeductions")),
    };
    const badPart = Object.entries(parts).find(([, cell]) => !cell.ok);
    if (badPart) {
      problems.push({
        line,
        message: `${named} — ${badPart[0]}: ${(badPart[1] as { ok: false; message: string }).message}.`,
      });
      continue;
    }
    const cents = (cell: MoneyCell) => (cell.ok ? cell.cents : null);
    const fica =
      cents(parts.socialSecurity) !== null || cents(parts.medicare) !== null || cents(parts.medicareAdditional) !== null
        ? (cents(parts.socialSecurity) ?? 0) + (cents(parts.medicare) ?? 0) + (cents(parts.medicareAdditional) ?? 0)
        : null;
    const federal = cents(parts.federalTax);
    const state = cents(parts.stateTax);
    const otherColumn = cents(parts.otherDeductions);
    let detail: RegisterRow["deductionsDetail"] = null;
    if (fica !== null || federal !== null || state !== null || otherColumn !== null) {
      const known = (fica ?? 0) + (federal ?? 0) + (state ?? 0) + (otherColumn ?? 0);
      if (known > deductionsCents) {
        rowNotes.push(
          `Line ${line}: ${named} — the itemised columns add up to more than total deductions, so the breakdown is left off and only the total is kept.`,
        );
      } else {
        detail = {};
        if (fica !== null) detail.ficaCents = fica;
        if (federal !== null) detail.federalTaxCents = federal;
        if (state !== null) detail.stateTaxCents = state;
        const remainder = deductionsCents - known;
        if (otherColumn !== null) detail.otherCents = otherColumn + remainder;
        else if (remainder > 0 && (fica !== null || federal !== null || state !== null))
          detail.otherCents = remainder;
      }
    }

    const hoursRaw = clean(at("hours"));
    let hours: string | null = null;
    if (hoursRaw !== "") {
      const h = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(hoursRaw.replace(/,/g, ""));
      if (!h) {
        problems.push({ line, message: `${named} — couldn't read the hours "${hoursRaw}".` });
        continue;
      }
      hours = h[2] ? `${h[1]}.${h[2]}` : h[1];
    }

    if (daySpan(start.value, end.value) !== 6) {
      rowNotes.push(
        `Line ${line}: ${named} — ${start.value} to ${end.value} is not a 7-day week. The row is stored, but only a period that matches a certified-payroll week fills that week's WH-347.`,
      );
    }

    rows.push({
      line,
      crewMemberId: person.id,
      crewLabel: crewName(person),
      periodStart: start.value,
      periodEnd: end.value,
      payDate: pay.value,
      hours,
      grossCents: gross.cents,
      deductionsCents,
      netCents: net.cents,
      deductionsDetail: detail,
      deductionsDerived,
      last4ToRecord: last4.value && !person.identifyingNumberLast4 ? last4.value : null,
      source,
    });
  }

  rows = applyCap(rows, problems);

  // One row per person per period, within the file.
  const seen = new Map<string, number>();
  const deduped: RegisterRow[] = [];
  for (const row of rows) {
    const key = `${row.crewMemberId}|${row.periodStart}|${row.periodEnd}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      problems.push({
        line: row.line,
        message: `${row.crewLabel} — same person and period as line ${earlier}, so only the first row is used. If these are two real checks in one period, total them into one row.`,
      });
      continue;
    }
    seen.set(key, row.line);
    deduped.push(row);
  }

  // Only the first row records a crew member's last-4.
  const last4Done = new Set<string>();
  for (const row of deduped) {
    if (row.last4ToRecord) {
      if (last4Done.has(row.crewMemberId)) row.last4ToRecord = null;
      else last4Done.add(row.crewMemberId);
    }
  }

  // Against what is already stored: same person+period updates, identical
  // rows are left alone — importing the same file twice changes nothing
  // the second time, and a corrected register is safe to re-import.
  const existingByKey = new Map<string, ExistingRegisterEntry>();
  for (const entry of existing) {
    existingByKey.set(`${entry.crewMemberId}|${entry.periodStart}|${entry.periodEnd}`, entry);
  }

  const plan: RegisterPlan = {
    create: [],
    update: [],
    unchanged: [],
    problems,
    notes: [...notes, ...rowNotes],
    headers: header.cells,
    headerLine: header.line,
    mapping,
    ignoredColumns,
    source,
  };

  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  for (const row of deduped) {
    const key = `${row.crewMemberId}|${row.periodStart}|${row.periodEnd}`;
    const held = existingByKey.get(key);
    if (!held) {
      plan.create.push(row);
      continue;
    }
    const changes: string[] = [];
    if (held.grossCents !== row.grossCents) changes.push(`gross ${dollars(held.grossCents)} → ${dollars(row.grossCents)}`);
    if (held.deductionsCents !== row.deductionsCents)
      changes.push(`deductions ${dollars(held.deductionsCents)} → ${dollars(row.deductionsCents)}`);
    if (held.netCents !== row.netCents) changes.push(`net ${dollars(held.netCents)} → ${dollars(row.netCents)}`);
    if ((held.hours ?? null) !== (row.hours ?? null)) changes.push("hours");
    if ((held.payDate ?? null) !== (row.payDate ?? null)) changes.push("pay date");
    if (changes.length === 0 && !row.last4ToRecord) {
      plan.unchanged.push({
        line: row.line,
        label: `${row.crewLabel} · ${row.periodStart} – ${row.periodEnd}`,
      });
    } else if (changes.length === 0) {
      // The stored figures already match; the row still records the last 4.
      plan.update.push({ ...row, changed: "records the last 4 of the ID number" });
    } else {
      plan.update.push({ ...row, changed: changes.join(", ") });
    }
  }

  plan.problems.sort((a, b) => a.line - b.line);
  return plan;
}
