import * as XLSX from "xlsx";
import { parseCsvRecords } from "./catalog-import";

/**
 * An Excel workbook (.xlsx), turned into exactly the CSV text the importers
 * already read — in the browser, before anything is sent.
 *
 * WHY CONVERT INSTEAD OF TEACHING THE SERVER XLSX. Every import here is
 * "the client parses to preview, the confirm sends the raw TEXT, and the
 * server parses the same text again" (lib/spreadsheet-import.ts). Keeping
 * that shape means every guard on the text path — the 900 KB byte cap
 * under Next's Server Action body limit, the whole-SSN refusals, the
 * 500-row cap, the idempotent replan inside the transaction — applies to
 * an Excel upload with no second implementation to drift. The workbook
 * never leaves the browser; its ROWS do, as text the person can see and
 * edit in the paste box.
 *
 * This module imports the SheetJS `xlsx` library (pinned to the 0.20.3
 * tarball on SheetJS's own CDN — the npm registry copy stopped at 0.18.5,
 * which carries known advisories). It is only ever loaded via a dynamic
 * `import()` in lib/import-files.ts, the moment someone actually picks an
 * .xlsx file, so the library never rides in a page bundle.
 *
 * WHAT A CELL BECOMES, so the text cannot surprise the parsers:
 *
 *   - date-formatted numbers: `YYYY-MM-DD`, which `parseSheetDate`
 *     accepts. Excel stores a date as a serial day count (45123, not
 *     "7/16/2023"), and passing that number through would import as
 *     garbage or refuse every date column;
 *   - other numbers: plain decimal text, never Excel's display format —
 *     a cell SHOWING "1,234" must not become two fields;
 *   - text kept as text, so a last-4 column formatted as Text keeps its
 *     leading zero exactly as the crew help says it will;
 *   - line breaks INSIDE a cell become single spaces. `clean()` collapses
 *     them anyway, and emitting a real quoted line break would shift every
 *     "Line N" message after it off the Excel row it names;
 *   - blank leading rows are kept as blank lines, so "Line N" in a problem
 *     is the row number Excel shows on the left.
 */

/** Excel's day-serial epoch offset from Unix: serial 25569 = 1970-01-01. */
const UNIX_EPOCH_SERIAL = 25569;
const DAY_MS = 86_400_000;

/** An Excel date serial as `YYYY-MM-DD`. Workbooks written on old Mac
 * Excel count from 1904 instead of 1900 and say so in their properties;
 * their serials are 1462 days behind. */
export function serialDateToIso(serial: number, date1904 = false): string {
  const days = date1904 ? serial + 1462 : serial;
  const date = new Date(Math.round((days - UNIX_EPOCH_SERIAL) * DAY_MS));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A number as plain text, with binary-float noise trimmed (0.1 + 0.2
 * style artefacts), never Excel's thousands-separated display text. */
function numberText(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(15)));
}

function cellText(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell) return "";
  switch (cell.t) {
    case "n": {
      const value = cell.v as number;
      if (typeof cell.z === "string" && XLSX.SSF.is_date(cell.z)) {
        return serialDateToIso(value, date1904);
      }
      return numberText(value);
    }
    case "d": {
      // Only appears when a reader passes cellDates; ours doesn't, but a
      // Date here must still come out as a day, not `toString()`.
      const date = cell.v as Date;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }
    case "b":
      return cell.v ? "TRUE" : "FALSE";
    case "e":
      return "";
    default:
      return cell.v === undefined || cell.v === null ? "" : String(cell.v);
  }
}

/** Quote a field only when the CSV parser would otherwise misread it:
 * a separator (comma or tab — parseCsvRecords splits on both), a line
 * break, or a LEADING quote, which is the one place that parser treats
 * `"` as an opening quote. A mid-field inch mark (5/8") needs nothing. */
function csvField(text: string): string {
  if (/[,\t\r\n]/.test(text) || text.startsWith('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * The FIRST worksheet of a workbook as CSV text — header row and cells,
 * physical row N of the sheet on physical line N of the text.
 *
 * The first sheet and only it, stated in the UI: a workbook with a Jobs
 * tab and a Clients tab is two imports, and silently concatenating sheets
 * would put job rows under a client header.
 */
export function workbookToCsvText(data: ArrayBuffer | Uint8Array): string {
  // cellNF keeps each cell's number-format string, which is how a date
  // cell is told apart from the serial number it is stored as.
  const workbook = XLSX.read(data, { type: "array", cellNF: true });
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  const ref = sheet?.["!ref"];
  if (!sheet || !ref) return "";

  const range = XLSX.utils.decode_range(ref);
  const lines: string[] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      cells.push(cellText(cell, date1904).replace(/\r\n|[\r\n]/g, " "));
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\n");
}

/** Test hook: the round-trip promise this module makes, in one place —
 * the text it emits parses back to the same cells. */
export function roundTripsThrough(cells: string[][]): string[][] {
  const text = cells.map((row) => row.map(csvField).join(",")).join("\n");
  return parseCsvRecords(text).map((record) => record.cells);
}
