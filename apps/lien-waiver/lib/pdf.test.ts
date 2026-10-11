import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { STATE_CONTENT } from "./content";
import { FORM_BOTTOM, FORM_TOP, MARGIN, NOTICE_PT, PAGE, renderWaiverPdf, WATERMARK_TEXT } from "./pdf";
import { FORMS, fillable } from "./statutes/forms";
import { printedText, segmentForm, unfill, type Fills } from "./statutes/render";

/**
 * The rendered-text test, run against the FILE rather than the renderer's
 * intentions: pdf.js reads the text back out of the PDF, the header and
 * footer are cut away by position, the fills are taken back out, and what
 * is left must be the statute's form text exactly. A dropped word, a
 * re-wrapped line that swallowed a space, a character the font could not
 * encode -- each one fails here even if the layout code "looks right".
 *
 * Spaces are compared after collapsing runs to one (normalization rule 1):
 * a PDF has no space characters at a line break, only a gap, so a line
 * break and a space have to read back as the same thing.
 */

const FILLS: Fills = {
  project: "Mesa Medical Office Building",
  jobNumber: "24-117",
  checkMaker: "Acme Builders Inc.",
  amount: "48,250.00",
  payee: "Desert Drywall LLC",
  owner: "Mesa Medical Partners LP",
  jobLocation: "1234 E Main St, Mesa, AZ 85203",
  jobDescription: "Interior framing and drywall at 1234 E Main St, Mesa, Arizona",
  customer: "Acme Builders Inc.",
  throughDate: "09/30/2026",
  disputedAmount: "3,100.00",
  signedDate: "",
  companyName: "Desert Drywall LLC",
  signerTitle: "President",
  invoiceNumber: "PA-07",
  paymentPeriod: "September 2026",
  priorWaiverDates: "",
  priorUnpaidAmounts: "",
};

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  rotated: boolean;
  page: number;
}

// pdf.js measures the standard fonts from its own metrics files; without
// them every width is a guess and the gap test below reads nonsense.
const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

async function readItems(bytes: Uint8Array): Promise<Item[]> {
  const doc = await getDocument({
    data: bytes,
    useSystemFonts: false,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  const items: Item[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const raw of content.items) {
      if (!("str" in raw) || raw.str.length === 0) continue;
      const [a, b, , , x, y] = raw.transform as number[];
      items.push({ str: raw.str, x, y, width: raw.width, size: Math.hypot(a, b), rotated: Math.abs(b) > 0.001, page: n });
    }
  }
  return items;
}

/** The form's own text, in reading order: page by page, top to bottom, left
 * to right, a space wherever there is a visible gap or a line break. */
function formText(items: Item[]): string {
  const body = items.filter((item) => !item.rotated && item.y <= FORM_TOP && item.y >= FORM_BOTTOM - 1);
  body.sort((p, q) => p.page - q.page || q.y - p.y || p.x - q.x);
  let out = "";
  let previous: Item | null = null;
  for (const item of body) {
    if (previous) {
      const sameLine = previous.page === item.page && Math.abs(previous.y - item.y) < 0.5;
      const gap = item.x - (previous.x + previous.width);
      out += sameLine && gap < 0.5 ? "" : " ";
    }
    out += item.str;
    previous = item;
  }
  return out.replace(/\s+/g, " ").trim();
}

describe.each(FORMS.map((form) => [`${form.state} ${form.form}`, form] as const))("%s PDF", (_name, form) => {
  it("reads back as the statute's text plus the fills, and nothing else", async () => {
    const bytes = await renderWaiverPdf({ form, fills: FILLS, reviewed: true });
    const items = await readItems(bytes);
    const read = formText(items);

    const paragraphs = segmentForm(form);
    const expected = paragraphs
      .map((paragraph) => printedText(paragraph, FILLS, fillable))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(read).toBe(expected);

    // And the same check stated the other way: with the fills taken back
    // out, it is the statute.
    const statute = paragraphs.map((paragraph) => unfill(paragraph, printedText(paragraph, FILLS, fillable), FILLS, fillable));
    expect(statute.join(" ").replace(/\s+/g, " ")).toBe(form.paragraphs.map((p) => p.text).join(" ").replace(/\s+/g, " "));
  });

  it("sets every notice in type at least as large as anything else on the page", async () => {
    const items = await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: false }));
    const largest = Math.max(...items.map((item) => item.size));
    const notices = form.paragraphs.filter((p) => p.role === "notice");
    if (notices.length === 0) return;
    expect(largest).toBeCloseTo(NOTICE_PT, 3);
    if (form.noticeRule?.minimumPoints) expect(NOTICE_PT).toBeGreaterThanOrEqual(form.noticeRule.minimumPoints);
    // The notice's own words are on the page at that size.
    const noticeWord = notices[notices.length - 1].text.split(" ").slice(-1)[0];
    const atSize = items.filter((item) => Math.abs(item.size - NOTICE_PT) < 0.01 && !item.rotated).map((item) => item.str).join(" ");
    expect(atSize).toContain(noticeWord);
  });

  it("keeps every line inside the margins, footer included", async () => {
    const items = await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: true }));
    expect(items.length).toBeGreaterThan(20);
    const over = items.filter((item) => item.x < MARGIN.x - 0.5 || item.x + item.width > PAGE.width - MARGIN.x + 0.5);
    expect(over.map((item) => item.str)).toEqual([]);
  });

  it("puts nothing above a notice that must be at the top", async () => {
    if (form.noticeRule?.placement !== "top") return;
    const items = (await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: true }))).filter((item) => item.page === 1);
    const firstNoticeWord = form.paragraphs.find((p) => p.role === "notice")!.text.split(" ")[0];
    const notice = items.find((item) => item.str.startsWith(firstNoticeWord))!;
    expect(notice, "notice not found").toBeTruthy();
    const above = items.filter((item) => item.y > notice.y + 0.5);
    expect(above.map((item) => item.str)).toEqual([]);
  });
});

describe("unreviewed and reviewed PDFs", () => {
  const form = FORMS.find((candidate) => candidate.state === "TX" && candidate.form === "CONDITIONAL_PROGRESS")!;

  it("watermarks an unreviewed form on every page, and not a reviewed one", async () => {
    const unreviewed = await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: false }));
    expect(unreviewed.filter((item) => item.rotated).map((item) => item.str)).toContain(WATERMARK_TEXT);
    const reviewed = await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: true }));
    expect(reviewed.some((item) => item.rotated)).toBe(false);
  });

  it("names its source and says it is not legal advice when the brand frame is on", async () => {
    expect(STATE_CONTENT.TX.brandFrame).toBe(true);
    const all = (await readItems(await renderWaiverPdf({ form, fills: FILLS, reviewed: true }))).map((item) => item.str).join(" ");
    expect(all).toContain("not a law firm");
    expect(all).toContain(new URL(form.sourceUrl).host);
  });
});
