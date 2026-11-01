// The continuation sheet as rows, for a spreadsheet or a GC's portal. Pure, and it
// only reads the document the page and the PDF already use, so the figures cannot
// differ from what is on screen.
//
// A GENERIC LAYOUT. It is columns A to I as the sheet prints them. A portal's own
// layout goes beside this when a real template arrives, and nothing here guesses
// at one.

import * as XLSX from "xlsx";
import { csvCell } from "@/lib/export";
import { g702FileName } from "./g702-pdf";
import type { G702Document, G703Totals } from "./g702";

type Cell = string | number | null;

export const G703_COLUMNS = [
  "A Item no.",
  "B Description of work",
  "C Scheduled value",
  "D From previous application",
  "E This period",
  "F Materials presently stored",
  "G Total completed and stored",
  "% G / C",
  "H Balance to finish",
  "I Retainage (if variable rate)",
] as const;

const percent = (ratio: number | null) => (ratio === null ? null : Math.round(ratio * 1000) / 10);

const figures = (row: G703Totals): Cell[] => [
  row.scheduledValue,
  row.fromPrevious,
  row.thisPeriod,
  row.materialsStored,
  row.totalCompletedAndStored,
  percent(row.percent),
  row.balanceToFinish,
  // Blank on purpose, as on the sheet: retainage is withheld per invoice.
  null,
];

/** Header block, a blank line, the column names, the lines, the grand totals. */
export function g703Rows(doc: G702Document): Cell[][] {
  const { header, continuation } = doc;
  return [
    ["Project", header.project],
    ["Project no.", header.projectNumber],
    ["Application no.", header.applicationNumber],
    ["Application date", header.applicationDate],
    ["Period to", header.periodTo],
    [],
    [...G703_COLUMNS],
    ...continuation.rows.map((row) => [row.itemNo, row.description, ...figures(row)]),
    [null, "Grand totals", ...figures(continuation.totals)],
  ];
}

/** Figures stay plain numbers, because a downward correction is negative and the
 * shared cell rule would turn `-500` into text. Only words go through it, and that
 * is what keeps a description reading `=1+1` from running in a spreadsheet. */
function csvValue(cell: Cell): string {
  return typeof cell === "number" ? String(cell) : csvCell(cell);
}

export function g703Csv(doc: G702Document): string {
  return `${g703Rows(doc).map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}

/** Text cells stay text here, so a formula in a description is not run. */
export function g703Workbook(doc: G702Document): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(g703Rows(doc)), "G703");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function g703FileName(doc: G702Document, format: "csv" | "xlsx"): string {
  return `${g702FileName(doc).replace(/^G702-G703/, "G703").replace(/\.pdf$/, "")}.${format}`;
}
