// Rows of words and numbers as a CSV or an Excel file. Shared by the G703 and the
// change order log, so both follow the same two rules.

import * as XLSX from "xlsx";
import { csvCell } from "@/lib/export";

export type SheetCell = string | number | null;

/** Figures stay plain numbers, because a credit is negative and the shared cell
 * rule would turn `-500` into text. Only words go through it, which keeps a title
 * reading `=1+1` from running in a spreadsheet. */
function csvValue(cell: SheetCell): string {
  return typeof cell === "number" ? String(cell) : csvCell(cell);
}

export function sheetCsv(rows: readonly SheetCell[][]): string {
  return `${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}

/** Text cells stay text, so a formula in a title is not run. */
export function sheetWorkbook(rows: readonly SheetCell[][], sheetName: string): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows as SheetCell[][]), sheetName);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A download that is not cached and is not rendered in place. */
export function sheetResponse(body: string | Buffer, format: "csv" | "xlsx", fileName: string) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": format === "xlsx" ? XLSX_TYPE : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
