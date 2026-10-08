/**
 * THE CSLB MASTER LICENCE FILE, READ FOR EXACTLY ONE THING: A PHONE NUMBER PER
 * LICENCE.
 *
 * California's CSLB publishes its licence master as one free CSV, no login and
 * no token — a plain GET of `MASTER_FILE_URL`, measured twice on 2026-10-05
 * (200, 77,643,341 bytes, `text/csv`; see
 * `changelog.d/601-the-file-was-a-plain-get-all-along.md`). It is 243,786 rows
 * by 52 columns, and this module reads THREE of those columns plus the name,
 * because a `SalesLead` already carries the licence number a §4104 listing
 * printed and the only thing it is missing is a telephone to ring.
 *
 * ── WHY IT STREAMS ──
 *
 * 77 MB is small on a laptop and large inside a serverless function. The file
 * is read as chunks, lines are cut as they complete, and nothing is kept except
 * the rows whose licence the caller asked for — so memory is the size of the
 * answer, not the size of the file. The async-iterable input is also what makes
 * the reader testable without a 77 MB fixture: a test feeds it an array of
 * strings cut wherever it likes, including mid-line and mid-quote.
 *
 * ── TWO TRAPS THE MEASUREMENT RECORDED, BOTH HANDLED HERE ──
 *
 * "In good standing" is spelled `CLEAR`, not `ACTIVE`: a filter on `ACTIVE`
 * matches zero of 243,786 rows and goes green. And the classification column is
 * literally named `Classifications(s)`, carrying codes in BOTH spellings at once
 * (`C9` and `C-7`), so anything matching one spelling drops ~7.4% silently.
 * This module does not filter on classification at all — the §4104 listing
 * already said what trade the sub is — but `classCodes()` normalises both forms
 * for anyone who does, and the test pins that.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not decide which phone to dial. The file has no line-type column —
 * nothing says desk line or mobile — and CSLB publishes no email address by
 * statute (B&P §27). A number found here is a number a person may click to
 * ring; it is not permission to put it in a dialler. The fill in
 * `lib/actions/sales.ts` writes it to `SalesLead.phone`, which is the same
 * column the hand-typed form writes, and never overwrites one already there.
 *
 * Per the fixture rule, no row of the real file appears in this repo. The test
 * uses synthetic names and the repo's own fixture licence numbers.
 */

import { licenceNumberFrom } from "@/lib/sales-licence";

/** Measured 2026-10-05: one plain GET, 200, `text/csv`. */
export const MASTER_FILE_URL =
  "https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C";

/** The header names the file actually uses, matched case-insensitively. */
const COLUMNS = {
  licence: "LicenseNo",
  name: "BusinessName",
  phone: "BusinessPhone",
  status: "PrimaryStatus",
  classes: "Classifications(s)",
  city: "City",
  county: "County",
} as const;

export type CslbRow = {
  /** The licence as a join key — bare digits, leading zeros gone. */
  licence: string;
  name: string | null;
  phone: string | null;
  /** `CLEAR` is in good standing. Anything else is not a prospect. */
  status: string;
  /** Classification codes, both spellings collapsed to the bare form: `C9`, `C35`. */
  classes: string[];
  city: string | null;
  county: string | null;
};

/**
 * One CSV line into fields. RFC 4180: commas split, double quotes wrap a field
 * that holds a comma or a quote, and a doubled quote inside is one quote.
 * Twenty lines rather than a dependency, because the only thing a CSV library
 * would add here is a second opinion on line endings.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(field);
      field = "";
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

/** `C-9`, `C9`, `c 9` → `C9`; `C-61/D-50` keeps both halves. */
export function classCodes(raw: string): string[] {
  return raw
    .split(/[|/,;]/)
    .map((code) => code.replace(/[\s-]+/g, "").toUpperCase())
    .filter((code) => /^[A-Z]{1,2}\d{0,2}$/.test(code));
}

/** Ten US digits read as `916-555-0100`; anything else is kept as printed. */
export function displayPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return trimmed;
}

/** `SAN DIEGO` as the file prints it → `San Diego` as a person reads it. */
export function titleCase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Thrown when the header row is not the file this module was written against. */
export class CslbHeaderError extends Error {}

function headerIndexes(headerLine: string): Record<keyof typeof COLUMNS, number> {
  const names = splitCsvLine(headerLine).map((name) => name.trim().toLowerCase());
  const found = {} as Record<keyof typeof COLUMNS, number>;
  const missing: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const index = names.indexOf(column.toLowerCase());
    if (index === -1) missing.push(column);
    found[key] = index;
  }
  if (missing.length > 0) {
    throw new CslbHeaderError(
      `The CSLB file no longer has the column${missing.length === 1 ? "" : "s"} ${missing.join(", ")} — its header is: ${names.join(", ")}`,
    );
  }
  return found;
}

/**
 * The lines of a chunked text, each complete. A chunk boundary can fall anywhere,
 * including inside a quoted field, so a line is only emitted once its quotes
 * balance — a business name with a line break in it stays one row.
 */
async function* lines(chunks: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string> {
  let carry = "";
  for await (const chunk of chunks) {
    carry += chunk;
    let start = 0;
    for (;;) {
      const nl = carry.indexOf("\n", start);
      if (nl === -1) break;
      const candidate = carry.slice(0, nl);
      if ((candidate.match(/"/g) ?? []).length % 2 === 1) {
        start = nl + 1;
        continue;
      }
      yield candidate.replace(/\r$/, "");
      carry = carry.slice(nl + 1);
      start = 0;
    }
  }
  if (carry.trim() !== "") yield carry.replace(/\r$/, "");
}

/**
 * Every row of the file, as this module reads it. Rows whose licence cannot be
 * a key are skipped rather than counted, because they could never match a
 * lead. The first line is the header and is read for column positions, not
 * assumed — the day CSLB renames `BusinessPhone` this throws instead of
 * returning 243,786 rows with no phone on any of them.
 */
export async function* cslbRows(
  chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<CslbRow> {
  let at: ReturnType<typeof headerIndexes> | null = null;
  for await (const line of lines(chunks)) {
    if (at === null) {
      at = headerIndexes(line);
      continue;
    }
    const fields = splitCsvLine(line);
    const licence = licenceNumberFrom(fields[at.licence]);
    if (licence === null) continue;
    yield {
      licence,
      name: (fields[at.name] ?? "").trim() || null,
      phone: displayPhone(fields[at.phone] ?? ""),
      status: (fields[at.status] ?? "").trim().toUpperCase(),
      classes: classCodes(fields[at.classes] ?? ""),
      city: titleCase(fields[at.city] ?? "") || null,
      county: titleCase(fields[at.county] ?? "") || null,
    };
  }
  if (at === null) throw new CslbHeaderError("The CSLB file was empty");
}

/**
 * The rows for the licences asked for, keyed by licence, and how many rows were
 * read to find them. First row per licence wins; the file is one row per
 * licence in every sample measured, so a second would be the file changing
 * shape and the count beside it is what would show that.
 */
export async function cslbRowsForLicences(
  chunks: AsyncIterable<string> | Iterable<string>,
  wanted: ReadonlySet<string>,
): Promise<{ rows: Map<string, CslbRow>; rowsRead: number }> {
  const rows = new Map<string, CslbRow>();
  let rowsRead = 0;
  for await (const row of cslbRows(chunks)) {
    rowsRead++;
    if (wanted.has(row.licence) && !rows.has(row.licence)) rows.set(row.licence, row);
  }
  return { rows, rowsRead };
}

/** A `fetch` body as text chunks, for `cslbRows`. */
export async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}
