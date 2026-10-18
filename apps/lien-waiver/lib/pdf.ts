import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { STATE_CONTENT } from "./content";
import { fillable } from "./statutes/forms";
import { printRuns, segmentForm, type Fills } from "./statutes/render";
import type { BuiltForm, ParagraphRole } from "./statutes/types";

/**
 * The waiver as a PDF, drawn line by line with pdf-lib.
 *
 * Why not print-styled HTML, which is how C-Stream makes its documents:
 * printing from a phone is where this is used, and a browser's print path
 * on a phone is unreliable and cannot be made to prove a type size. The
 * statutes have type rules -- Texas wants its notice bold, at least as large
 * as the largest type on the page and never under 10 point; Arizona and
 * Nevada want theirs at least as large as the largest type -- and here the
 * sizes are constants that a test reads back out of the file.
 *
 * THE TYPE SCALE IS THE RULE, not decoration. NOTICE_PT is the largest size
 * anything on the page is set in -- title, watermark, header, all of it --
 * so every notice clears "at least as large as the largest type" by
 * construction, and it is 12, which clears Texas's 10-point floor.
 *
 * The statutory text and the brand frame never share a line. The frame is
 * a header and footer outside the form; a state can switch it off
 * (`brandFrame` in lib/content.ts). On a form whose notice must be at the
 * TOP of the document (Texas, California), nothing is printed above the
 * notice: the header line moves into the footer.
 */

export const PAGE = { width: 612, height: 792 } as const; // US Letter
export const MARGIN = { x: 54, top: 54, bottom: 64 } as const;
/** Where the form's own text may go. Header and footer sit outside it,
 * which is also how the PDF test separates them when reading back. */
export const FORM_TOP = PAGE.height - MARGIN.top - 22;
export const FORM_BOTTOM = MARGIN.bottom + 18;

export const NOTICE_PT = 12;
export const TITLE_PT = 12;
export const BODY_PT = 10;
export const HEADING_PT = 10;
export const CAPTION_PT = 7.5;
export const FRAME_PT = 7.5;
export const WATERMARK_PT = NOTICE_PT;

const INK = rgb(0.07, 0.07, 0.07);
const QUIET = rgb(0.38, 0.38, 0.38);
const WATERMARK = rgb(0.85, 0.2, 0.2);

const STYLE: Record<ParagraphRole, { size: number; bold: boolean; before: number; indent: number }> = {
  title: { size: TITLE_PT, bold: true, before: 10, indent: 0 },
  notice: { size: NOTICE_PT, bold: true, before: 8, indent: 0 },
  heading: { size: HEADING_PT, bold: true, before: 10, indent: 0 },
  caption: { size: CAPTION_PT, bold: false, before: 1, indent: 36 },
  body: { size: BODY_PT, bold: false, before: 6, indent: 0 },
};

export interface PdfOptions {
  form: BuiltForm;
  fills: Fills;
  /** False until an attorney has reviewed the state (lib/statutes/review.ts).
   * An unreviewed form is watermarked on every page and says so. */
  reviewed: boolean;
}

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  underline: boolean;
}

/**
 * The width a string ADVANCES the pen when drawn, character by character.
 *
 * Not `font.widthOfTextAtSize`: pdf-lib applies the font's kerning pairs
 * when it MEASURES, but `drawText` does not kern when it DRAWS. After a
 * heavily kerned word -- bold "PAYMENT." measured about 4pt narrower than
 * it prints -- the next word was placed on top of its last letters. Found by
 * the PDF test, which read "PAYMENT.A" back out of the file.
 */
function advance(font: PDFFont, text: string, size: number): number {
  let width = 0;
  for (const char of text) width += font.widthOfTextAtSize(char, size);
  return width;
}

/** Break runs into words that keep their trailing space, so a line can only
 * end between words and every character is drawn exactly once. */
function words(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export async function renderWaiverPdf({ form, fills, reviewed }: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const state = STATE_CONTENT[form.state];

  doc.setTitle(`${form.paragraphs.filter((p) => p.role === "title").map((p) => p.text).join(" ")} (${state.name})`);
  doc.setSubject(`Statutory form under ${form.citation}`);
  doc.setCreator("C-Stream free lien waiver tool");
  doc.setProducer("C-Stream");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = FORM_TOP;
  };
  newPage();

  const maxWidth = PAGE.width - MARGIN.x * 2;

  for (const paragraph of segmentForm(form)) {
    const style = STYLE[paragraph.role];
    const font = style.bold ? bold : regular;
    const lineHeight = style.size * 1.3;
    const pieces: Piece[] = [];
    for (const run of printRuns(paragraph, fills, fillable)) {
      for (const word of words(run.text)) {
        pieces.push({ text: word, font, size: style.size, underline: run.filled });
      }
    }
    y -= style.before;
    const width = maxWidth - style.indent;
    let line: Piece[] = [];
    let lineWidth = 0;
    let endX = MARGIN.x + style.indent;
    const flush = () => {
      if (y - lineHeight < FORM_BOTTOM) newPage();
      y -= lineHeight;
      let x = MARGIN.x + style.indent;
      line.forEach((piece, position) => {
        // The word is drawn WITHOUT its trailing space and the pen moves on
        // by the space's width, so every word boundary is a real gap in the
        // file. A drawn trailing space is something PDF readers report
        // inconsistently (pdf.js dropped one after a bold "PAYMENT."), and
        // the PDF test reads spaces from gaps.
        const ink = piece.text.trimEnd();
        if (ink) page.drawText(ink, { x, y, size: piece.size, font: piece.font, color: INK });
        const w = advance(piece.font, ink, piece.size);
        if (piece.underline) {
          // Carry the rule across the space to the next word of the same
          // fill, so "Acme Builders Inc." is underlined as one value.
          const joined = line[position + 1]?.underline === true;
          const end = joined ? x + advance(piece.font, piece.text, piece.size) : x + w;
          page.drawLine({ start: { x, y: y - 1.5 }, end: { x: end, y: y - 1.5 }, thickness: 0.6, color: INK });
        }
        x += advance(piece.font, piece.text, piece.size);
      });
      endX = x;
      line = [];
      lineWidth = 0;
    };
    // A line may only break where the text has a space. Pieces with no
    // space between them -- "$" and the amount typed after it -- are one
    // unbreakable group: a break there would print "$" at the end of one
    // line and the amount at the start of the next, which reads back as a
    // space the statute does not have.
    const groups: Piece[][] = [];
    for (const piece of pieces) {
      const previous = groups[groups.length - 1];
      if (previous && !/\s$/.test(previous[previous.length - 1].text)) previous.push(piece);
      else groups.push([piece]);
    }
    for (const group of groups) {
      const w = group.reduce((sum, piece) => sum + advance(piece.font, piece.text, piece.size), 0);
      const last = group[group.length - 1];
      const visible = w - advance(last.font, last.text, last.size) + advance(last.font, last.text.trimEnd(), last.size);
      if (line.length > 0 && lineWidth + visible > width) flush();
      line.push(...group);
      lineWidth += w;
    }
    if (line.length > 0) flush();

    // A California label left empty ("Claimant's Signature:") gets a rule to
    // write on. It is a drawn line, not characters, so the form's text is
    // untouched -- the statute's blank there is nothing at all.
    const last = paragraph.segments[paragraph.segments.length - 1];
    if (last?.kind === "blank" && last.trailing) {
      const value = fillable(last.slot) ? fills[last.slot]?.trim() : "";
      if (!value) {
        page.drawLine({
          start: { x: endX + 4, y: y - 1.5 },
          end: { x: PAGE.width - MARGIN.x, y: y - 1.5 },
          thickness: 0.6,
          color: INK,
        });
      }
    }
  }

  const noticeAtTop = form.noticeRule?.placement === "top";
  pages.forEach((current, index) => {
    const footer: string[] = [];
    if (state.brandFrame) {
      const brand = "Prepared with C-Stream's free lien waiver tool. C-Stream is not a law firm and does not give legal advice.";
      if (!noticeAtTop) {
        current.drawText(brand, { x: MARGIN.x, y: PAGE.height - MARGIN.top + 4, size: FRAME_PT, font: regular, color: QUIET });
      } else {
        footer.push(brand);
      }
      // The host, not the full URL: California's runs to 120 characters and
      // wrapped the footer into the margin. The full address is in the
      // research note and the attorney packet.
      footer.push(
        `Statutory form: ${form.citation}. Text from ${new URL(form.sourceUrl).host}, retrieved ${form.retrievedAt.slice(0, 10)}. Page ${index + 1} of ${pages.length}.`,
      );
    } else {
      footer.push(`Page ${index + 1} of ${pages.length}`);
    }
    footer.forEach((text, line) => {
      current.drawText(text, {
        x: MARGIN.x,
        y: MARGIN.bottom - 10 - line * (FRAME_PT + 3),
        size: FRAME_PT,
        font: regular,
        color: QUIET,
      });
    });
    if (!reviewed) watermark(current, bold);
  });

  return doc.save();
}

/** Unreviewed: a diagonal warning repeated down the page, in the notice's
 * size so it cannot become the largest type on the page and break the very
 * rule the notice is set by. */
export const WATERMARK_TEXT = "NOT ATTORNEY-REVIEWED — PREVIEW ONLY — DO NOT SIGN";

function watermark(page: PDFPage, font: PDFFont) {
  for (let row = 0; row < 6; row += 1) {
    page.drawText(WATERMARK_TEXT, {
      x: 60,
      y: 120 + row * 120,
      size: WATERMARK_PT,
      font,
      color: WATERMARK,
      opacity: 0.35,
      rotate: degrees(25),
    });
  }
}
