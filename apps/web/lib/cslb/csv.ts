/**
 * A CSV READER THAT CAN BE FED A 77-MEGABYTE FILE IN PIECES.
 *
 * The CSLB master file is 77,643,341 bytes and 243,786 rows, so nothing here may
 * hold the whole document: the reader takes chunks as they arrive off a stream and
 * hands back whatever complete records those chunks completed.
 *
 * ── WHY THIS IS HAND-WRITTEN, WHICH NEEDS A REASON ──
 *
 * `csv-parse` resolves in this repo and is NOT a declared dependency of any
 * workspace — it is transitive, and importing it would be the mistake CLAUDE.md
 * records about `esbuild`: code that works on one machine because the store
 * happens to hold something nobody declared. `xlsx` IS declared and does read CSV,
 * and is the wrong tool twice over — it wants the whole document in memory, and it
 * is the dependency whose tarball host was blocked for a day.
 *
 * So: RFC 4180, about forty lines, no lockfile change, and tested against the four
 * cases that break hand-rolled readers rather than trusted because it looks short.
 *
 * ── THE FOUR THINGS THAT GO WRONG, EACH OF WHICH IS A TEST ──
 *
 *   - **a comma inside quotes.** `"ACME DRYWALL, INC",916…` is two fields, and
 *     splitting on commas makes it three. Business names in this file carry commas.
 *   - **an escaped quote.** RFC 4180 doubles it: `"5"" TYPE X"` is `5" TYPE X`.
 *   - **a NEWLINE inside quotes.** This is the one that makes a streaming reader
 *     different from a line reader, and the reason this file is not
 *     `text.split("\n").map(line => line.split(","))`. A record can span lines.
 *   - **a chunk boundary anywhere at all.** A stream can split a chunk mid-field,
 *     mid-quote or between the `\r` and the `\n`, so the reader carries state
 *     between chunks and nothing may assume a chunk ends on a record.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * No type coercion, no header mapping, no trimming: it returns arrays of strings
 * exactly as delimited. `rowsByHeader` builds the objects, and
 * `lib/cslb/masterFile.ts` does every reading decision. A reader that also
 * interprets is a reader whose bugs are indistinguishable from the interpreter's.
 */

/**
 * A reader you push chunks into.
 *
 * `push` returns the records those bytes completed — possibly none, if the chunk
 * ended mid-record. `end` returns the final record when the file does not end with
 * a newline, which is the usual case.
 *
 * The one rule for a caller: **`end()` must be called**, or the last row of the
 * file is silently dropped. A truncated final record is exactly what a `head -c`
 * of this file produces, so this is not a theoretical concern.
 */
export type CsvReader = {
  push(chunk: string): string[][];
  end(): string[][];
};

export function createCsvReader(): CsvReader {
  let field = "";
  let row: string[] = [];
  /** Inside a quoted field: a comma or a newline here is data, not a delimiter. */
  let quoted = false;
  /** The previous character was a quote while quoted — so `""` is a literal. */
  let quoteOpen = false;
  /** A record was begun. Distinguishes a trailing newline from an empty last row. */
  let started = false;

  function endField(): void {
    row.push(field);
    field = "";
  }

  function endRow(out: string[][]): void {
    endField();
    out.push(row);
    row = [];
    started = false;
  }

  function consume(chunk: string, out: string[][]): void {
    for (const char of chunk) {
      started = true;
      if (quoteOpen) {
        /* A quote closed the field. Whatever follows decides what it meant. */
        quoteOpen = false;
        if (char === '"') {
          /* `""` inside quotes is one literal quote. */
          field += '"';
          quoted = true;
          continue;
        }
        quoted = false;
        /* fall through: this character is a delimiter or ordinary text */
      }

      if (quoted) {
        if (char === '"') {
          quoteOpen = true;
          continue;
        }
        field += char;
        continue;
      }

      if (char === '"' && field === "") {
        quoted = true;
        continue;
      }
      if (char === ",") {
        endField();
        continue;
      }
      if (char === "\n") {
        endRow(out);
        continue;
      }
      if (char === "\r") {
        /* Dropped, so CRLF ends a record via its LF. A bare-CR document (classic
           Mac) therefore reads as ONE record, which is a deliberate limit rather
           than an oversight: the alternative is treating CR as a terminator, and
           then a stream split between the CR and the LF of a CRLF emits a phantom
           empty record. The file this exists for is CRLF or LF. */
        continue;
      }
      field += char;
    }
  }

  return {
    push(chunk) {
      const out: string[][] = [];
      consume(chunk, out);
      return out;
    },
    end() {
      /* Only a record that actually began. A file ending in a newline has
         `started === false` here, and inventing an empty final row from it would
         give every caller a phantom record of one empty field. */
      if (!started) return [];
      const out: string[][] = [];
      endRow(out);
      return out;
    },
  };
}

/** Every record in a string, for a document small enough to hold. */
export function csvRows(text: string): string[][] {
  const reader = createCsvReader();
  return [...reader.push(text), ...reader.end()];
}

/**
 * Records as objects keyed by the header row.
 *
 * A row with FEWER cells than the header gets `undefined` for the rest rather than
 * `""`, so a short row and an empty cell stay distinguishable — the master file
 * has 52 columns and a row that lost one is a parse failure worth seeing, not a
 * blank to shrug at. Extra cells beyond the header are dropped, since there is no
 * name to file them under.
 */
export function rowsByHeader(rows: string[][]): Record<string, string | undefined>[] {
  const [header, ...rest] = rows;
  if (!header) return [];
  return rest.map((cells) => {
    const out: Record<string, string | undefined> = {};
    header.forEach((name, index) => {
      out[name] = cells[index];
    });
    return out;
  });
}
