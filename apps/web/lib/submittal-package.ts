// A submittal package: a cover sheet generated from the register row,
// stapled to the product data the person picks, downloaded, and sent the way
// this GC wants it. Per submittal. Diego's option A, 2026-10-30
// (coordination/decisions/2026-10-30-submittal-packages.md).
//
// RUNS IN THE BROWSER AND STORES NOTHING, for the reasons at the top of
// lib/estimating/bid-package.ts, whose merge this reuses rather than repeats.
// The only thing kept is the LIST of what went in, on the revision.
//
// The cover carries register facts and a blank box for the reviewer's stamp.
// It writes no certification wording, and it is not the GC's own form: that
// is a later per-contact template.

import {
  buildPackage,
  planPackage,
  type PackageEntry,
  type SkippedPart,
} from "@/lib/estimating/bid-package";
import { safe } from "@/lib/billing/g702-pdf";

export type PackageContents = {
  files: { name: string; pages: number }[];
  totalPages: number;
};

export interface SubmittalCover {
  companyName: string;
  gcName: string;
  jobName: string;
  submittalNumber: number;
  revisionNumber: number;
  title: string;
  description: string | null;
  specSection: string | null;
  drawingReference: string | null;
  /** `YYYY-MM-DD` from the send form, or null when it is blank. */
  sentOn: string | null;
}

export const MAX_PACKAGE_FILES = 200;
const MAX_NAME_LENGTH = 255;
const MAX_PAGES = 100_000;

function contentsFrom(raw: unknown): PackageContents | null {
  if (!raw || typeof raw !== "object") return null;
  const { files, totalPages } = raw as { files?: unknown; totalPages?: unknown };
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PACKAGE_FILES) return null;
  const clean: PackageContents["files"] = [];
  for (const file of files) {
    const { name, pages } = (file ?? {}) as { name?: unknown; pages?: unknown };
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) return null;
    if (!Number.isInteger(pages) || (pages as number) < 1 || (pages as number) > MAX_PAGES) return null;
    clean.push({ name: name.trim(), pages: pages as number });
  }
  if (!Number.isInteger(totalPages) || (totalPages as number) < 1) return null;
  return { files: clean, totalPages: totalPages as number };
}

/**
 * The list as it arrives from the form: a trust boundary, so anything that is
 * not exactly the expected shape is refused rather than stored. `null` is "no
 * package was built", which is legitimate; `undefined` is a list that could
 * not be read.
 */
export function parsePackageContents(raw: string): PackageContents | null | undefined {
  if (!raw.trim()) return null;
  try {
    return contentsFrom(JSON.parse(raw)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The stored column, read on render. A row that does not parse shows nothing
 * rather than breaking the register. */
export function readPackageContents(raw: unknown): PackageContents | null {
  return contentsFrom(raw);
}

export function packageSummary(contents: PackageContents): string {
  const n = contents.files.length;
  const names = contents.files.map((file) => `${file.name} (${file.pages} p)`).join(", ");
  return `${n} file${n === 1 ? "" : "s"}, ${contents.totalPages} page${contents.totalPages === 1 ? "" : "s"}: ${names}`;
}

const PAGE: [number, number] = [612, 792];
const MARGIN = 54;
const FIRST_PAGE_ROWS = 22;
const LATER_PAGE_ROWS = 44;
const ROW_HEIGHT = 14;

/** Cover pages needed for this many files. Known before drawing, because the
 * table of contents prints each file's page in the finished package. */
export function coverPageCount(fileCount: number): number {
  if (fileCount <= FIRST_PAGE_ROWS) return 1;
  return 1 + Math.ceil((fileCount - FIRST_PAGE_ROWS) / LATER_PAGE_ROWS);
}

async function drawCover(cover: SubmittalCover, entries: readonly PackageEntry[], offset: number) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0, 0, 0);
  const right = PAGE[0] - MARGIN;
  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const text = (str: string, x: number, at: number, size = 10, useBold = false, maxWidth = right - x) => {
    const f = useBold ? bold : font;
    let s = safe(str);
    while (s.length > 4 && f.widthOfTextAtSize(s, size) > maxWidth) s = `${s.slice(0, -4)}...`;
    page.drawText(s, { x, y: at, size, font: f, color: ink });
  };

  text(`SUBMITTAL ${cover.submittalNumber}, REVISION ${cover.revisionNumber}`, MARGIN, y, 15, true);
  y -= 22;
  text(cover.title, MARGIN, y, 12);
  y -= 26;

  const facts: [string, string | null][] = [
    ["FROM:", cover.companyName],
    ["TO:", cover.gcName],
    ["PROJECT:", cover.jobName],
    ["SPEC SECTION:", cover.specSection],
    ["DRAWING REFERENCE:", cover.drawingReference],
    ["DATE SENT:", cover.sentOn],
  ];
  for (const [label, value] of facts) {
    text(label, MARGIN, y, 8, true);
    if (value) text(value, MARGIN + 110, y, 10);
    else page.drawLine({ start: { x: MARGIN + 110, y: y - 1.5 }, end: { x: right, y: y - 1.5 }, thickness: 0.4 });
    y -= 16;
  }
  if (cover.description) {
    y -= 4;
    text(cover.description, MARGIN, y, 9);
    y -= 12;
  }

  y -= 10;
  text("CONTENTS", MARGIN, y, 9, true);
  text("PAGES", right - 90, y, 8, true);
  text("STARTS ON", right - 48, y, 8, true);
  y -= 5;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.8 });
  y -= ROW_HEIGHT;

  entries.forEach((entry, index) => {
    if (index === FIRST_PAGE_ROWS || (index > FIRST_PAGE_ROWS && (index - FIRST_PAGE_ROWS) % LATER_PAGE_ROWS === 0)) {
      page = doc.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    text(entry.name, MARGIN, y, 9, false, right - 100 - MARGIN);
    text(String(entry.pages), right - 90, y, 9);
    text(String(entry.startsOnPage + offset), right - 48, y, 9);
    y -= ROW_HEIGHT;
  });

  // The reviewer's stamp goes here. On the first page, under the contents
  // when they fit, and it is blank on purpose.
  if (entries.length <= FIRST_PAGE_ROWS) {
    const first = doc.getPage(0);
    first.drawRectangle({ x: MARGIN, y: MARGIN, width: right - MARGIN, height: 110, borderWidth: 0.6, borderColor: ink, opacity: 0 });
    first.drawText("REVIEWER'S STAMP", { x: MARGIN + 6, y: MARGIN + 98, size: 7, font: bold, color: ink });
  }
  return doc;
}

export type BuiltSubmittalPackage = {
  bytes: Uint8Array | null;
  contents: PackageContents | null;
  skipped: SkippedPart[];
};

export async function buildSubmittalPackage(
  cover: SubmittalCover,
  parts: readonly { name: string; bytes: Uint8Array }[],
): Promise<BuiltSubmittalPackage> {
  // One slot, so the bid package's merge keeps the person's own file order,
  // and its size ceiling, skip reasons and no-blank-file rule all come along.
  const merged = await buildPackage(planPackage(parts.map((part) => ({ slot: "CUT_SHEETS" as const, ...part }))));
  if (merged.bytes === null) return { bytes: null, contents: null, skipped: merged.skipped };

  const { PDFDocument } = await import("pdf-lib");
  const offset = coverPageCount(merged.entries.length);
  const out = await drawCover(cover, merged.entries, offset);
  const body = await PDFDocument.load(merged.bytes);
  for (const page of await out.copyPages(body, body.getPageIndices())) out.addPage(page);
  out.setTitle(`Submittal ${cover.submittalNumber} revision ${cover.revisionNumber} - ${safe(cover.title)}`);

  return {
    bytes: await out.save(),
    contents: {
      files: merged.entries.map((entry) => ({ name: entry.name, pages: entry.pages })),
      totalPages: out.getPageCount(),
    },
    skipped: merged.skipped,
  };
}

export function submittalPackageFileName(cover: Pick<SubmittalCover, "jobName" | "submittalNumber" | "revisionNumber">): string {
  const job = cover.jobName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${job || "job"}-submittal-${cover.submittalNumber}-rev-${cover.revisionNumber}.pdf`;
}
