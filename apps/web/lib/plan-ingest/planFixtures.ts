/**
 * Synthetic plan sheets, written as real multi-page PDFs from placed text.
 *
 * WHY SYNTHETIC. Diego's rule for the AI work is explicit: customer plan sets,
 * specs and quotes are confidential, and *"never use real customer files in tests
 * or fixtures."* A plan set is the most confidential document in this product. So
 * every sheet here is invented and generated at run time — there is no binary in
 * the tree to leak, and a reader can see what each sheet says by reading it.
 *
 * WHY IT MUST SUPPORT `/Rotate`, which `quoteFixtures.ts` does not. The whole
 * correctness question in `planPdf.ts` is whether a title-block region filter
 * survives a rotated page: `getTextContent()` reports positions in UNROTATED user
 * space and AutoCAD exports plan sheets with `/Rotate 90` routinely, so a fixture
 * that cannot rotate cannot test the one thing most likely to be wrong. The first
 * draft of `planPdf.ts` had exactly that bug and no fixture could have caught it.
 *
 * WHY A WRITER RATHER THAN A DEPENDENCY. `pdf-lib` would be one npm install, but a
 * production dependency added for a test needs its licence checked against the
 * rules for this work, and a minimal PDF is a documented format. The offsets are
 * the only part that is easy to get wrong, which is why `planPdf.test.ts` reads
 * every fixture back with the `pdfjs-dist` the app already ships. That test is
 * free and runs in CI, so nothing here is measured against a file nobody checked.
 */

/** One string placed on a sheet, in PDF user-space points from the bottom-left. */
export type PlacedText = { x: number; y: number; text: string };

/** One sheet of a synthetic set. */
export type SyntheticSheet = {
  /** Page box in points. ARCH D landscape is 2592 x 1728 (36" x 24"). */
  widthPt: number;
  heightPt: number;
  /** The page's own `/Rotate`. 0, 90, 180 or 270. */
  rotation?: 0 | 90 | 180 | 270;
  items: PlacedText[];
};

/** Escapes the three characters a PDF string literal cannot carry raw. */
function pdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * The synthetic marking, appended by the WRITER so no fixture can omit it — and a
 * REFERENCE CODE rather than a sentence.
 *
 * `quoteFixtures.ts` learned this the expensive way, twice: a marking that asserts
 * something about the document ("not a real quote") is a claim a competent reader
 * must act on, and it corrupted that eval's measurement two runs in a row. A code
 * makes no claim, greps the same, and cannot be acted on.
 */
const SYNTHETIC_MARK = "Ref: ZZ SYNTHETIC 0001";

/** A content stream placing each item with `Td`, at 9pt — title-block lettering. */
function contentFor(sheet: SyntheticSheet): string {
  const ops = ["BT", "/F1 9 Tf"];
  for (const item of sheet.items) {
    ops.push(`1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm`, `(${pdfString(item.text)}) Tj`);
  }
  // The marking goes to the DISPLAYED TOP-LEFT, which is the one corner outside
  // every region `titleBlockRegion` looks in — it takes the right 40% of the width
  // OR the bottom 25% of the height, so a bottom-left marking lands inside the
  // band and shows up in every extracted title block. It did, in the first run.
  const mark = userFromDisplayed(18, 18, sheet.rotation ?? 0, sheet.widthPt, sheet.heightPt);
  ops.push(
    `1 0 0 1 ${mark.x.toFixed(2)} ${mark.y.toFixed(2)} Tm`,
    `(${pdfString(SYNTHETIC_MARK)}) Tj`,
    "ET",
  );
  return ops.join("\n") + "\n";
}

/**
 * A multi-page PDF of these sheets, as bytes.
 *
 * BUILT AS A LATIN-1 STRING THROUGHOUT, so a byte offset and a string index are
 * the same number. Writing part as UTF-8 would put the xref offsets out by one per
 * non-ASCII character and produce a file some readers accept and others reject —
 * the worst kind of broken fixture, because it looks like a model failure.
 */
export function planSetPdf(sheets: SyntheticSheet[]): Buffer {
  if (sheets.length === 0) throw new Error("a plan set needs at least one sheet");

  // Object numbering: 1 catalog, 2 pages, 3 font, then per sheet a page object
  // and its content stream.
  const pageObjNum = (i: number) => 4 + i * 2;
  const contentObjNum = (i: number) => 5 + i * 2;

  const bodies: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${sheets.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ")}] /Count ${sheets.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  sheets.forEach((sheet, i) => {
    const content = contentFor(sheet);
    const rotate = sheet.rotation ? ` /Rotate ${sheet.rotation}` : "";
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sheet.widthPt} ${sheet.heightPt}]${rotate} ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/** ARCH D landscape, the size most architectural sheets are plotted at. */
export const ARCH_D = { widthPt: 2592, heightPt: 1728 };

/**
 * A DISPLAYED position, converted to the user-space point that lands there once
 * the page's own `/Rotate` has been applied.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT AN IMPLEMENTATION DETAIL. A real plan sheet's
 * title block appears in the bottom-right of the sheet AS SOMEBODY LOOKS AT IT,
 * whatever `/Rotate` the exporter wrote — that is the whole purpose of `/Rotate`.
 * But the user-space corner that ends up displaying bottom-right is a DIFFERENT
 * corner for each rotation, so a fixture that simply writes its title block at the
 * user-space bottom-right and then rotates the page is modelling a sheet nobody
 * produces: the block moves, and a test built on it fails for a reason that has
 * nothing to do with the code.
 *
 * The first draft of `planPdf.test.ts` did exactly that and its rotated cases went
 * red while the code was correct. Measured out of pdfjs rather than derived:
 *
 *   /Rotate 0    user bottom-right  displays bottom-right
 *   /Rotate 90   user TOP-right     displays bottom-right
 *   /Rotate 180  user TOP-LEFT      displays bottom-right
 *   /Rotate 270  user BOTTOM-LEFT   displays bottom-right
 *
 * Displayed space has its origin at the TOP-left with y running DOWN, matching
 * `PlanPageText`. `W`/`H` are the MediaBox, so displayed dimensions swap at 90/270.
 */
export function userFromDisplayed(
  displayedX: number,
  displayedY: number,
  rotation: 0 | 90 | 180 | 270,
  mediaWidthPt: number,
  mediaHeightPt: number,
): { x: number; y: number } {
  const W = mediaWidthPt;
  const H = mediaHeightPt;
  switch (rotation) {
    case 0:
      return { x: displayedX, y: H - displayedY };
    case 90:
      return { x: displayedY, y: displayedX };
    case 180:
      return { x: W - displayedX, y: displayedY };
    case 270:
      return { x: W - displayedY, y: H - displayedX };
  }
}

/** The page's size AS DISPLAYED, which swaps at 90 and 270. */
export function displayedSize(rotation: 0 | 90 | 180 | 270, mediaWidthPt: number, mediaHeightPt: number) {
  const swapped = rotation === 90 || rotation === 270;
  return { widthPt: swapped ? mediaHeightPt : mediaWidthPt, heightPt: swapped ? mediaWidthPt : mediaHeightPt };
}

/**
 * A sheet with a title block in the bottom-right corner, where the overwhelming
 * majority of architectural sheets put one — and some drawing content up and to
 * the left, so a region filter that simply took everything would be indetectable
 * from one that worked.
 */
export function sheetWithTitleBlock(opts: {
  sheetNumber: string;
  title: string;
  discipline?: string;
  rotation?: 0 | 90 | 180 | 270;
}): SyntheticSheet {
  const rotation = opts.rotation ?? 0;
  const { widthPt: W, heightPt: H } = ARCH_D;
  const shown = displayedSize(rotation, W, H);
  // Everything below is positioned as a PERSON SEES THE SHEET, then converted —
  // which is how a real exporter places a title block and the only way a rotated
  // fixture tests anything about the code rather than about itself.
  const at = (displayedX: number, displayedY: number, text: string): PlacedText => {
    const { x, y } = userFromDisplayed(displayedX, displayedY, rotation, W, H);
    return { x, y, text };
  };
  const blockX = shown.widthPt - 520;
  const blockBottom = shown.heightPt;
  return {
    widthPt: W,
    heightPt: H,
    rotation: opts.rotation,
    items: [
      // Drawing content, displayed upper-left. Must NOT reach the title block's
      // region, or the filter could return everything and still pass.
      at(200, 200, "PARTITION TYPE A"),
      at(200, 260, "SEE SCHEDULE FOR RATED ASSEMBLIES"),
      at(420, 700, "CORRIDOR 1-08"),
      // The title block, displayed bottom-right, where every architect puts one.
      at(blockX, blockBottom - 300, "ZZ SYNTHETIC ARCHITECTS"),
      at(blockX, blockBottom - 250, "PROJECT: NORTHGATE MEDICAL OFFICE"),
      at(blockX, blockBottom - 200, opts.title),
      at(blockX, blockBottom - 150, opts.discipline ?? "ARCHITECTURAL"),
      at(blockX, blockBottom - 110, "SCALE: 1/4\" = 1'-0\""),
      at(blockX, blockBottom - 80, "ISSUED: 2026-03-04   REV 2"),
      at(shown.widthPt - 260, blockBottom - 40, opts.sheetNumber),
    ],
  };
}

/** A sheet a scanner produced: no text layer at all, just the marking the writer
 *  adds. The case `hasTextLayer` exists to report as a fact rather than a failure. */
export function scannedSheet(): SyntheticSheet {
  return { ...ARCH_D, items: [] };
}
