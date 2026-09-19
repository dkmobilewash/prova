import { MAX_IMPORT_BYTES, TOO_LARGE_MESSAGE } from "./spreadsheet-import";

/**
 * Reading the file somebody hands an import box, before any parsing.
 *
 * One reader for every box on /settings/import, so "which files work"
 * cannot drift between the clients, jobs, crew and myCOI cards. A CSV is
 * read as text unchanged; an .xlsx is converted IN THE BROWSER to the same
 * CSV text (lib/xlsx-import.ts, loaded only at that moment), so everything
 * downstream — preview, byte cap, SSN refusals, row cap, the server's own
 * re-parse — sees one kind of input.
 *
 * Deliberately NOT imported by lib/xlsx-import.ts or the reverse at module
 * load: this file must cost nothing in the page bundle, and the SheetJS
 * library only loads behind the dynamic import below.
 */

/** The one Excel format refused: the pre-2007 binary .xls. */
export const XLS_MESSAGE =
  "That is an older Excel file (.xls). In Excel choose File → Save As and pick Excel Workbook (.xlsx), then choose that file here — it works as-is.";

export const UNREADABLE_MESSAGE =
  "Couldn't read that file. Try opening it and pasting the contents instead.";

/**
 * The refusal for a file that will not be parsed, or null when it will be.
 *
 * Size is checked FIRST, before any parse: an .xlsx is compressed, so this
 * is the cheap gate — the converted text is then checked again against the
 * same cap by `importTooLarge`, exactly as pasted text is.
 */
export function importFileProblem(name: string, size: number): string | null {
  if (size > MAX_IMPORT_BYTES) return TOO_LARGE_MESSAGE;
  if (/\.xls$/i.test(name)) return XLS_MESSAGE;
  return null;
}

type ImportFile = {
  name: string;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type ReadFileResult = { ok: true; text: string } | { ok: false; message: string };

/** The file as importer text: refused (.xls, oversized), converted
 * (.xlsx), or read as-is (anything textual — CSV, TSV, VCF). */
export async function readImportFile(file: ImportFile): Promise<ReadFileResult> {
  const problem = importFileProblem(file.name, file.size);
  if (problem) return { ok: false, message: problem };
  try {
    if (/\.xlsx$/i.test(file.name)) {
      const { workbookToCsvText } = await import("./xlsx-import");
      return { ok: true, text: workbookToCsvText(await file.arrayBuffer()) };
    }
    return { ok: true, text: await file.text() };
  } catch {
    return { ok: false, message: UNREADABLE_MESSAGE };
  }
}
