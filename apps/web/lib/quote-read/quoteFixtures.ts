/**
 * Synthetic quote documents, written as real PDFs from plain text.
 *
 * WHY SYNTHETIC, AND WHY THIS IS NOT A COMPROMISE. Diego's rule for the AI work
 * is explicit: customer plan sets, specs and quotes are confidential, and *"never
 * use real customer files in tests or fixtures."* A quote is a competitor's
 * pricing; it is exactly the document that must not end up in a repository. So
 * every case below is invented, and the fixtures are generated at run time rather
 * than committed — there is no binary in this tree to leak, and a reader can see
 * what each case says by reading it.
 *
 * It also makes the eval better rather than worse. A real quote gives you one
 * sample of one layout; a generator gives you the AWKWARD cases on purpose — a
 * price that is a range, a subtotal with tax and no total, a document that is not
 * a quote at all. Those are where "never invent a number" is actually tested, and
 * they are hard to find in a folder of real ones.
 *
 * WHY A PDF WRITER RATHER THAN A DEPENDENCY. `pdf-lib` would be one npm install
 * and this is forty lines, but the install would be a production dependency added
 * for a by-hand eval — and every dependency here needs its licence checked
 * against the rules for this work. A minimal PDF is a documented format: a
 * catalog, a page, a font and a content stream of `Tj` operators, with a
 * cross-reference table of byte offsets. The offsets are the only part that is
 * easy to get wrong, which is why `quoteFixtures.test.ts` reads every fixture
 * back with `pdfjs-dist` — the library this app already ships — and fails if the
 * text does not come out. **That test is free and runs in CI, so the eval is
 * never measuring a model against a file nobody checked.**
 */

/** One line of a quote, as it would be printed. */
export type QuoteFixture = {
  /** Case id, used in the eval's report. */
  id: string;
  /** What the document says, line by line. */
  lines: string[];
};

/** Escapes the three characters a PDF string literal cannot carry raw. */
function pdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * A one-page PDF containing these lines, as bytes.
 *
 * Helvetica at 11pt with a 14pt leading, starting near the top-left, which is
 * enough for a page of a quote and needs no embedded font — the base fourteen are
 * guaranteed present in any conforming reader.
 */
export function quotePdf(lines: string[]): Buffer {
  const content =
    ["BT", "/F1 11 Tf", "54 738 Td", "14 TL"]
      .concat(lines.map((line) => `(${pdfString(line)}) Tj T*`))
      .concat(["ET"])
      .join("\n") + "\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
  ];

  // BUILT AS A STRING IN LATIN-1 THROUGHOUT, so a byte offset and a string index
  // are the same number. Writing part of this as UTF-8 would put the xref
  // offsets out by one for every non-ASCII character and produce a file that
  // some readers accept and others reject — the worst kind of broken fixture,
  // because it would look like a model failure.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/**
 * The cases, and what each one is FOR.
 *
 * Every entry exists to test one judgement rather than to look like paperwork.
 * The four that matter most are the ones with no single total: they are where the
 * prompt's first rule — never invent a number — either holds or does not, and a
 * confident wrong figure there is the most expensive thing this feature could do,
 * because an estimator is about to level two subs against it.
 */
export const QUOTE_FIXTURES: QuoteFixture[] = [
  {
    id: "plain-total",
    lines: [
      "ZZ SYNTHETIC — Cascade Interior Systems",
      "1420 Mill Street, Reno NV",
      "",
      "QUOTATION",
      "Date: March 4, 2026",
      "Project: Northgate Medical Office Building",
      "Scope: Metal stud framing and drywall, levels 1-3",
      "",
      "Total price: $184,500.00",
      "",
      "Exclusions:",
      "Firestopping",
      "Soffits above 12 feet",
      "Painting of any kind",
    ],
  },
  {
    id: "subtotal-tax-total",
    lines: [
      "ZZ SYNTHETIC — Pioneer Wall & Ceiling",
      "",
      "Proposal  -  4/18/2026",
      "Acoustical ceilings, second floor",
      "",
      "Subtotal            72,400.00",
      "Sales tax 8.265%     5,985.86",
      "TOTAL              $78,385.86",
      "",
      "Not included: seismic bracing, cutting and patching",
    ],
  },
  {
    id: "range-no-single-total",
    lines: [
      "ZZ SYNTHETIC — Alta Plaster Co.",
      "",
      "Budget indication only - not a firm quote",
      "Three-coat stucco, building B",
      "",
      "Expect $46,000 to $58,000 depending on final",
      "elevation quantities and the specified finish coat.",
      "",
      "Firm pricing on receipt of the approved elevations.",
    ],
  },
  {
    id: "base-plus-alternates",
    lines: [
      "ZZ SYNTHETIC — Redline Drywall LLC",
      "",
      "Bid Proposal - May 2, 2026",
      "EIFS, west and south elevations",
      "",
      "Base bid:            212,000",
      "Alternate 1 - add mesh reinforcement:   18,400",
      "Alternate 2 - deduct for owner-supplied trim:  (6,250)",
      "",
      "Award of alternates at owner's discretion.",
      "Excludes: scaffolding, window sealant",
    ],
  },
  {
    id: "unit-price-no-quantity",
    lines: [
      "ZZ SYNTHETIC — Summit Fireproofing",
      "",
      "Quote 2026-0455",
      "Spray-applied fireproofing, structural steel",
      "",
      "$3.85 per square foot, applied",
      "Quantity to be determined from final steel tonnage.",
      "",
      "Excludes patching after other trades.",
    ],
  },
  {
    id: "not-a-quote",
    lines: [
      "ZZ SYNTHETIC — SECTION 09 21 16",
      "GYPSUM BOARD ASSEMBLIES",
      "",
      "PART 1 - GENERAL",
      "1.1 SUMMARY",
      "A. Section includes gypsum board assemblies, including",
      "   framing, board, and finishing.",
      "1.2 SUBMITTALS",
      "A. Product data for each type of product.",
      "",
      "PART 2 - PRODUCTS",
      "2.1 MANUFACTURERS",
    ],
  },
  {
    id: "no-date",
    lines: [
      "ZZ SYNTHETIC — Keystone Lath & Plaster",
      "",
      "PRICE QUOTE",
      "Interior lath and plaster, lobby and corridors",
      "",
      "Our price for the above: $61,750",
      "",
      "Exclusions: none",
      "",
      "Valid thirty days from issue.",
    ],
  },
];
