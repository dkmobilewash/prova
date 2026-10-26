import { TRADE_SCOPES } from "./trade-scopes";

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
 *
 * A thin view over `parseCsvRecords` below, and its output is unchanged by
 * that: the same records, without the line numbers.
 */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((record) => record.cells);
}

/** One CSV record and the physical line of the text it STARTED on. */
export type CsvRecord = { line: number; cells: string[] };

/**
 * The same parser as `parseCsv`, keeping where each record came from.
 *
 * Added for the spreadsheet importer (lib/spreadsheet-import.ts), whose
 * problems are reported by line number. Counting records instead of lines
 * gets that number wrong as soon as the file has a blank line in it —
 * blank records are dropped below, so every row after one would be
 * reported one line early — or a quoted field with a line break inside it.
 * The line counter advances on every physical line break, quoted or not.
 * One parser, so the two importers can never disagree about what a file
 * said.
 */
export function parseCsvRecords(text: string): CsvRecord[] {
  const input = text.replace(/^\uFEFF/, "");
  const records: CsvRecord[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

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
        // A CRLF inside a quoted field is one physical line break, counted
        // on its \n; a lone \r is one on its own.
        if (char === "\n" || (char === "\r" && input[i + 1] !== "\n")) line++;
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
      records.push({ line: recordLine, cells: record });
      record = [];
      field = "";
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  record.push(field);
  records.push({ line: recordLine, cells: record });

  // A trailing newline produces one empty record; blank lines mid-file are
  // dropped too rather than reported as broken rows.
  return records.filter((r) => r.cells.some((cell) => cell.trim() !== ""));
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
 * The key two catalog descriptions are compared under to decide "same item".
 *
 * Trimmed and lower-cased — what a person means by "the same item" — and
 * exported so every path that can create a catalog entry agrees about what
 * counts as a duplicate. Before #105 finding 7, `importCatalogEntries`
 * refused a duplicate with exactly this rule while `createLineItemCatalogEntry`
 * and `saveLineItemAsCatalogEntry` used no rule at all, so the same item
 * typed twice — or the same line saved from two jobs — created two rows that
 * each accumulate their own actuals. With `CATALOG_MIN_SAMPLE = 2`, splitting
 * one item's history across two rows can keep both under the minimum sample
 * forever, suppressing a variance flag the merged sample would have raised.
 */
export function catalogKey(description: string): string {
  return description.trim().toLowerCase();
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
  const existing = new Set(existingDescriptions.map(catalogKey));
  const seenInFile = new Set<string>();

  const fresh: ImportRow[] = [];
  const duplicatesOfExisting: ImportRow[] = [];
  const duplicatesWithinFile: ImportRow[] = [];

  for (const row of rows) {
    const key = catalogKey(row.description);
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

/* ------------------------------------------------------------------ */
/* Re-importing an updated list: which existing entries change price   */
/* ------------------------------------------------------------------ */

/** What the catalog holds for an entry, in the numbers the import compares. */
export type ExistingEntry = {
  id: string;
  description: string;
  unit: string | null;
  unitPrice: number | null;
  budgetedUnitCost: number | null;
};

/** One figure moving: what the catalog has, what the file says. */
export type FigureChange = { old: number | null; next: number; percent: number | null };

export type PriceChange = {
  entryId: string;
  row: ImportRow;
  /** Null when the file does not carry that column for this row, or it equals the catalog. */
  price: FigureChange | null;
  cost: FigureChange | null;
};

export type ImportPlan = {
  fresh: ImportRow[];
  /** Existing entries whose price and/or cost the file moves. */
  changes: PriceChange[];
  /** Existing entries the file agrees with (or says nothing new about). */
  unchanged: ImportRow[];
  /** Same description, DIFFERENT unit — a price per LF is not a price per SF. Never updated. */
  unitMismatch: ImportRow[];
  duplicatesWithinFile: ImportRow[];
};

const cents = (n: number) => Math.round(n * 100);

function figureChange(old: number | null, next: number | null): FigureChange | null {
  // A blank cell in the file never erases a price the catalog already has: the
  // file saying nothing is not the supplier saying zero.
  if (next == null) return null;
  if (old != null && cents(old) === cents(next)) return null;
  return {
    old,
    next,
    percent: old != null && old !== 0 ? Math.round(((next - old) / old) * 1000) / 10 : null,
  };
}

const unitKey = (unit: string | null) => (unit ?? "").trim().toLowerCase();

/**
 * Splits parsed rows against the catalog AND works out which existing entries
 * the file reprices. The identity rule is the one the import has always used —
 * `catalogKey(description)`, there is no SKU column — and the rows are the
 * server's own re-parse, so a preview is never what decides what is written.
 *
 * ONLY PRICE AND COST MOVE. Unit, trade, labor and the description stay as the
 * estimator set them: a supplier's sheet is authority on what things cost, not
 * on how this shop produces them. A row whose unit differs from the entry's is
 * reported and skipped — "per LF" against "per SF" is a different item.
 */
export function planImport(rows: ImportRow[], existing: ExistingEntry[]): ImportPlan {
  const byKey = new Map(existing.map((entry) => [catalogKey(entry.description), entry]));
  const seenInFile = new Set<string>();
  const plan: ImportPlan = { fresh: [], changes: [], unchanged: [], unitMismatch: [], duplicatesWithinFile: [] };

  for (const row of rows) {
    const key = catalogKey(row.description);
    if (seenInFile.has(key)) {
      plan.duplicatesWithinFile.push(row);
      continue;
    }
    seenInFile.add(key);
    const entry = byKey.get(key);
    if (!entry) {
      plan.fresh.push(row);
      continue;
    }
    if (row.unit != null && entry.unit != null && unitKey(row.unit) !== unitKey(entry.unit)) {
      plan.unitMismatch.push(row);
      continue;
    }
    const price = figureChange(entry.unitPrice, row.unitPrice);
    const cost = figureChange(entry.budgetedUnitCost, row.budgetedUnitCost);
    if (!price && !cost) plan.unchanged.push(row);
    else plan.changes.push({ entryId: entry.id, row, price, cost });
  }
  return plan;
}
