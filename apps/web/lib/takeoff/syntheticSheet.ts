/**
 * SYNTHETIC DRAWING SHEETS, WRITTEN BYTE BY BYTE — the instrument the
 * symbol-counting question needs, and the reason it is hand-rolled.
 *
 * `docs/ai/DECISIONS.md` has carried "whether symbol-counting can reach a
 * precision an estimator would accept" as an open question with zero code behind
 * it. It cannot be answered by argument and it cannot be answered with customer
 * plans: **"Never use real customer files in tests or fixtures"** is a standing
 * rule here, and a GC's drawing set is exactly the confidential document it was
 * written for. So the sheets are generated, and generated sheets have a property
 * real ones do not — the truth is KNOWN, exactly, because this file placed every
 * symbol.
 *
 * ── WHY NO PDF LIBRARY ──
 *
 * This repo ships `pdfjs-dist`, which READS. Writing would mean a new
 * dependency, and the licensing rule here is to check one before adding it and
 * to say so. A PDF is a text-based container, and a page of vector shapes is
 * about sixty lines of it — so nothing is added, nothing needs a licence review,
 * and the bytes an eval is measured against are auditable in the same file.
 *
 * ── THE PHYSICAL CONSTRAINT THIS EXISTS TO PROBE, WHICH IS ALREADY MEASURED ──
 *
 * `plan-ingest/planPdf.ts` established it for the title-block work: an ARCH D
 * sheet is 36 INCHES wide, so fitted to the vision tier's long edge it lands at
 * roughly 65 DPI, and the 1/8" lettering in a title block becomes about EIGHT
 * PIXELS tall. That is why plan ingestion reads vector text and never looks at
 * the page.
 *
 * Symbol counting cannot do that — a symbol has no text layer to extract, which
 * is the whole reason it is a separate question rather than more of the same
 * feature. So the thing that has to be measured is whether a symbol is still
 * COUNTABLE at that scale, and the only honest way to ask is to hold the symbol
 * constant and vary the sheet:
 *
 *   `sheetSize: "ARCH_D"`  — 24x36in. What a real sheet costs you in resolution.
 *   `sheetSize: "DETAIL"`  — 8.5x11in. The same symbols, same absolute size, on
 *                            a page ~4.2x smaller, so each symbol lands on ~4.2x
 *                            the pixels. The control.
 *
 * A model that counts correctly on DETAIL and fails on ARCH_D has told us the
 * feature needs TILING, which is actionable and expensive. One that fails on
 * both has told us the capability is not there, which kills the feature and
 * saves the tiling work. **Those two findings are opposite and a single-arm eval
 * cannot tell them apart** — it would report "symbol counting does not work" and
 * be unable to say why. That is the `#418` mistake in a different suit: a result
 * that looks like a location.
 */

/** Sheet sizes in POINTS (72 per inch), which is the PDF unit. */
const SHEETS = {
  /** 24x36in landscape — the common large architectural sheet. */
  ARCH_D: { width: 36 * 72, height: 24 * 72, inchesLongEdge: 36 },
  /** 8.5x11in portrait — a detail sheet, and the resolution control. */
  DETAIL: { width: 8.5 * 72, height: 11 * 72, inchesLongEdge: 11 },
} as const;

export type SheetSize = keyof typeof SHEETS;

/** What the long edge resolves to once a vision tier fits it to `longEdgePx`. */
export function effectiveDpi(sheet: SheetSize, longEdgePx = 1568): number {
  return longEdgePx / SHEETS[sheet].inchesLongEdge;
}

export type SymbolSpec = {
  /** A mark an estimator would actually count on a framing/drywall sheet. */
  kind: "door" | "columnBubble" | "wallTag";
  /** How many to place. The TRUTH the eval grades against. */
  count: number;
};

export type SheetSpec = {
  id: string;
  sheetSize: SheetSize;
  /** The sheet number drawn in the title block, so the page looks like a sheet
   *  rather than a page of shapes — a model shown an obviously synthetic target
   *  may behave differently from one shown something plan-shaped. */
  sheetNumber: string;
  symbols: SymbolSpec[];
};

/** Escape nothing: every string here is generated, ASCII, and controlled. */
function num(value: number): string {
  return value.toFixed(2);
}

/**
 * A quarter-circle Bezier approximation. PDF has no circle operator, so a
 * circle is four curves with the standard 0.5523 control-point constant.
 */
function circle(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return [
    `${num(cx + r)} ${num(cy)} m`,
    `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
    `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
    `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
    `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`,
  ].join("\n");
}

/** One symbol's drawing operators, at a fixed ABSOLUTE size in points. */
function drawSymbol(kind: SymbolSpec["kind"], x: number, y: number, label: string): string {
  if (kind === "door") {
    // A door: a 36in leaf on a wall, drawn as a line plus a quarter-arc swing.
    // 36in at 1:96 (1/8" = 1'-0") is 4.5 points — too small to be a fair target,
    // so these are drawn at a legible 18pt, which is what a real sheet does by
    // drawing details at a larger scale.
    const s = 18;
    return [
      "1 w",
      `${num(x)} ${num(y)} m ${num(x)} ${num(y + s)} l S`,
      `${num(x)} ${num(y + s)} m ${num(x + s * 0.55)} ${num(y + s)} ${num(x + s)} ${num(y + s * 0.55)} ${num(x + s)} ${num(y)} c S`,
    ].join("\n");
  }
  if (kind === "columnBubble") {
    // A grid bubble: a circle with a letter in it. 24pt diameter.
    return [
      "1 w",
      circle(x, y, 12),
      "S",
      "BT /F1 9 Tf",
      `${num(x - 2.5)} ${num(y - 3)} Td (${label}) Tj`,
      "ET",
    ].join("\n");
  }
  // A wall-type tag: a small filled square with a number beside it.
  return [
    `${num(x)} ${num(y)} 10 10 re f`,
    "BT /F1 8 Tf",
    `${num(x + 13)} ${num(y + 2)} Td (${label}) Tj`,
    "ET",
  ].join("\n");
}

/**
 * The page's content stream: a border, a title block, and the symbols laid out
 * on a loose grid with deliberate jitter so they are not trivially countable by
 * a repeating pattern.
 */
function contentStream(spec: SheetSpec): string {
  const { width, height } = SHEETS[spec.sheetSize];
  const ops: string[] = ["0 G", "0 g", "1 w"];

  // Sheet border and a title-block box in the bottom right, so the page reads
  // as a drawing. Not decoration: it gives the model the same framing a real
  // sheet has, and `planPdf.ts`'s title-block work shows the model uses it.
  ops.push(`20 20 ${num(width - 40)} ${num(height - 40)} re S`);
  ops.push(`${num(width - 220)} 30 180 90 re S`);
  ops.push("BT /F1 14 Tf", `${num(width - 210)} 50 Td (${spec.sheetNumber}) Tj`, "ET");
  ops.push("BT /F1 7 Tf", `${num(width - 210)} 95 Td (SYNTHETIC TEST SHEET - NOT A REAL PROJECT) Tj`, "ET");

  // Deterministic pseudo-jitter, so a run is reproducible but the layout is not
  // a clean lattice. A lattice would let a model infer a count from the pattern
  // rather than by looking, which would be the vacuous-pass shape again.
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const marginX = 60;
  const marginY = 150;
  const usableW = width - marginX * 2 - 240;
  const usableH = height - marginY * 2;

  for (const symbol of spec.symbols) {
    const perRow = Math.ceil(Math.sqrt(symbol.count));
    for (let i = 0; i < symbol.count; i += 1) {
      const col = i % perRow;
      const rowIndex = Math.floor(i / perRow);
      const x = marginX + (usableW / Math.max(perRow, 1)) * (col + 0.5) + (next() - 0.5) * 20;
      const y = marginY + (usableH / Math.max(perRow, 1)) * (rowIndex + 0.5) + (next() - 0.5) * 20;
      const label = symbol.kind === "columnBubble" ? String.fromCharCode(65 + (i % 26)) : String((i % 9) + 1);
      ops.push(drawSymbol(symbol.kind, x, y, label));
    }
  }

  return ops.join("\n");
}

/**
 * A complete, valid single-page PDF for one spec.
 *
 * The xref offsets are computed from the bytes actually emitted rather than
 * guessed, because a PDF whose xref is wrong is one a reader may silently
 * RECONSTRUCT — and a fixture that works by being repaired is a fixture nobody
 * can reason about. `syntheticSheet.test.ts` opens every sheet with the same
 * pdfjs the app ships and asserts the page count, the media box and the operator
 * count, so a malformed fixture fails there instead of quietly making an eval
 * measure nothing.
 */
export function synthesiseSheet(spec: SheetSpec): Buffer {
  const { width, height } = SHEETS[spec.sheetSize];
  const stream = contentStream(spec);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/** The total number of symbols on a sheet — the truth an eval grades against. */
export function trueCount(spec: SheetSpec, kind?: SymbolSpec["kind"]): number {
  return spec.symbols
    .filter((symbol) => kind === undefined || symbol.kind === kind)
    .reduce((total, symbol) => total + symbol.count, 0);
}

export { SHEETS };
