import { TRADE_SCOPES } from "./actions/shared";

/**
 * Turning a price list into catalog entries.
 *
 * The single most-cited usability complaint across every competitor
 * researched is one-at-a-time data entry — "Importing material prices is
 * VERY cumbersome... Every item has to be manually entered." Prova had the
 * same gap, and it undercut the actuals feedback loop specifically: the
 * catalog can only learn from how jobs performed once there is a catalog,
 * and nobody hand-types two hundred line items to get started.
 *
 * Deliberately a pure function over text. The client parses to show a
 * preview and the server parses the same text again to decide what to
 * write — never trusting rows the browser sends, and never running two
 * different parsers that could disagree about what the file said.
 */

export const MAX_IMPORT_ROWS = 500;

export type ImportRow = {
  /** 1-based line number in the pasted text, for pointing at a bad row. */
  line: number;
  description: string;
  unit: string | null;
  unitPrice: number | null;
  budgetedUnitCost: number | null;
  laborHours: number | null;
  tradeScope: (typeof TRADE_SCOPES)[number] | null;
};

export type RowProblem = { line: number; message: string };

export type ParsedImport = {
  rows: ImportRow[];
  /** Rows that couldn't be read. Reported, never silently dropped. */
  problems: RowProblem[];
  /** Header names found but not understood — usually harmless extra columns,
   * worth showing so a mis-mapped price column doesn't pass unnoticed. */
  ignoredColumns: string[];
};

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Splits CSV text into records, honouring quoted fields.
 *
 * Hand-written rather than pulled from a library: the input is one small
 * pasted price list, and a dependency in the client bundle for this is a
 * worse trade than forty lines. Handles the cases a real export actually
 * produces — quoted commas ("2x4, 8ft"), doubled quotes as an escape,
 * CRLF line endings, and the UTF-8 BOM Excel writes.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      // A quote only opens a quoted field at the START of a field. Mid-field
      // it is a literal inch mark — and this trade writes 5/8" and 1/2" on
      // nearly every line, so treating those as an opening quote swallowed
      // the rest of the row and shifted every column after it.
      inQuotes = true;
    } else if (char === "," || char === "\t") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Consume CRLF as one break.
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  record.push(field);
  records.push(record);

  // A trailing newline produces one empty record; blank lines mid-file are
  // dropped too rather than reported as broken rows.
  return records.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

/**
 * A contractor's existing price list will not use our field names, and
 * telling them to rename their columns first would reintroduce exactly the
 * manual work this feature removes. So headers are matched loosely.
 */
const COLUMN_ALIASES: Record<keyof Omit<ImportRow, "line">, string[]> = {
  description: ["description", "item", "name", "line item", "lineitem", "work", "scope of work"],
  unit: ["unit", "uom", "units", "unit of measure"],
  unitPrice: ["unit price", "unitprice", "price", "sell", "sell price", "rate", "billing rate"],
  budgetedUnitCost: ["cost", "unit cost", "unitcost", "budgeted cost", "budget cost", "budgeted unit cost", "material cost"],
  laborHours: ["labor hours", "labour hours", "hours", "hrs", "man hours", "manhours"],
  tradeScope: ["trade", "trade scope", "tradescope", "scope"],
};

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Which column index holds each field, and which headers we didn't use. */
function mapColumns(header: string[]) {
  const normalised = header.map(normaliseHeader);
  const mapping: Partial<Record<keyof Omit<ImportRow, "line">, number>> = {};
  const used = new Set<number>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof Omit<ImportRow, "line">,
    string[],
  ][]) {
    const index = normalised.findIndex((h, i) => !used.has(i) && aliases.includes(h));
    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }

  const ignoredColumns = normalised.filter((h, i) => h !== "" && !used.has(i));
  return { mapping, ignoredColumns };
}

/* ------------------------------------------------------------------ */
/* Value parsing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Money and hours as they actually appear in exports: "$1,234.50", "1 234",
 * "(4.00)" for a negative. Returns undefined when the cell is present but
 * unreadable, so the row can be reported rather than silently zeroed —
 * a price list that imports with a wrong number is worse than one that
 * refuses to import.
 */
function parseNumber(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$\s,]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return undefined;

  const value = Number(cleaned) * (negative ? -1 : 1);
  return Number.isFinite(value) ? value : undefined;
}

/** Accepts our enum values and the words a person would actually type. */
function parseTradeScope(raw: string | undefined): (typeof TRADE_SCOPES)[number] | null | undefined {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === "") return null;

  const key = value.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "");
  if ((TRADE_SCOPES as readonly string[]).includes(key)) {
    return key as (typeof TRADE_SCOPES)[number];
  }

  const loose = value.toLowerCase();
  if (/drywall|metal frami/.test(loose)) return "METAL_FRAMING_DRYWALL";
  if (/plaster|lath/.test(loose)) return "LATH_PLASTER";
  if (/eifs/.test(loose)) return "EIFS";
  if (/ceiling|acoustic/.test(loose)) return "ACOUSTICAL_CEILINGS";
  if (/fireproof/.test(loose)) return "FIREPROOFING";
  return undefined;
}

/* ------------------------------------------------------------------ */

/**
 * Reads a pasted price list into catalog rows.
 *
 * A header row is required — guessing which unlabelled column is price and
 * which is cost would eventually guess wrong, and an import that silently
 * swaps price for cost corrupts every bid made from it afterwards.
 */
export function parseCatalogImport(text: string): ParsedImport {
  const records = parseCsv(text);
  if (records.length === 0) {
    return { rows: [], problems: [{ line: 1, message: "Nothing to import." }], ignoredColumns: [] };
  }

  const { mapping, ignoredColumns } = mapColumns(records[0]);
  if (mapping.description === undefined) {
    return {
      rows: [],
      problems: [
        {
          line: 1,
          message:
            "No description column found. The first row must name the columns — one of them called Description (or Item, or Name).",
        },
      ],
      ignoredColumns: [],
    };
  }

  const rows: ImportRow[] = [];
  const problems: RowProblem[] = [];

  records.slice(1).forEach((record, index) => {
    const line = index + 2; // header is line 1
    const cell = (field: keyof Omit<ImportRow, "line">) => {
      const at = mapping[field];
      return at === undefined ? undefined : record[at];
    };

    const description = (cell("description") ?? "").trim();
    if (description === "") {
      problems.push({ line, message: "No description — skipped." });
      return;
    }

    const unitPrice = parseNumber(cell("unitPrice"));
    const budgetedUnitCost = parseNumber(cell("budgetedUnitCost"));
    const laborHours = parseNumber(cell("laborHours"));
    const tradeScope = parseTradeScope(cell("tradeScope"));

    // Written as one narrowing condition rather than a count of problems, so
    // the compiler can see that everything below is defined.
    if (
      unitPrice === undefined ||
      budgetedUnitCost === undefined ||
      laborHours === undefined ||
      tradeScope === undefined
    ) {
      const bad: string[] = [];
      if (unitPrice === undefined) bad.push(`price "${cell("unitPrice")?.trim()}"`);
      if (budgetedUnitCost === undefined) bad.push(`cost "${cell("budgetedUnitCost")?.trim()}"`);
      if (laborHours === undefined) bad.push(`hours "${cell("laborHours")?.trim()}"`);
      if (tradeScope === undefined) bad.push(`trade "${cell("tradeScope")?.trim()}"`);
      problems.push({ line, message: `${description} — couldn't read ${bad.join(", ")}.` });
      return;
    }

    const unit = (cell("unit") ?? "").trim();
    rows.push({
      line,
      description,
      unit: unit === "" ? null : unit,
      unitPrice,
      budgetedUnitCost,
      laborHours,
      tradeScope,
    });
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    problems.push({
      line: rows[MAX_IMPORT_ROWS].line,
      message: `Only the first ${MAX_IMPORT_ROWS} rows will be imported — ${
        rows.length - MAX_IMPORT_ROWS
      } more were left out. Split the file and import again.`,
    });
  }

  return { rows: rows.slice(0, MAX_IMPORT_ROWS), problems, ignoredColumns };
}

/**
 * Splits parsed rows against what the catalog already holds.
 *
 * Matching on description, case-insensitively, because that is what a
 * person means by "the same item" — and because re-importing an updated
 * price list is the normal case, not the exception. Silently creating a
 * second "5/8in Type X board" is how a catalog becomes untrustworthy.
 */
export function splitAgainstExisting(rows: ImportRow[], existingDescriptions: string[]) {
  const existing = new Set(existingDescriptions.map((d) => d.trim().toLowerCase()));
  const seenInFile = new Set<string>();

  const fresh: ImportRow[] = [];
  const duplicatesOfExisting: ImportRow[] = [];
  const duplicatesWithinFile: ImportRow[] = [];

  for (const row of rows) {
    const key = row.description.trim().toLowerCase();
    if (seenInFile.has(key)) {
      duplicatesWithinFile.push(row);
      continue;
    }
    seenInFile.add(key);
    if (existing.has(key)) duplicatesOfExisting.push(row);
    else fresh.push(row);
  }

  return { fresh, duplicatesOfExisting, duplicatesWithinFile };
}
