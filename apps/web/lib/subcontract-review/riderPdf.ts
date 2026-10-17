import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { riderBlocks } from "./rider";

/**
 * The rider as a PDF, server-side — because "attach it as a contract version"
 * needs a FILE in the blob store, and the browser's Save as PDF cannot hand one
 * to the server. `pdf-lib` is already a dependency of this app; this imports
 * the package, not any other module's use of it.
 *
 * Plain and legible on purpose: Helvetica, letter size, wrapped text, a page
 * number. It is a document a GC will read and sign, not a design surface.
 *
 * The standard fonts encode WinAnsi only, so a character outside it (an emoji,
 * a CJK name) is replaced with "?" rather than crashing the attach — and the
 * person sees the result before anything is sent, because sending is theirs.
 */

const PAGE = { width: 612, height: 792, margin: 60 };
const SIZE = { title: 14, heading: 11, body: 10 };
const LEADING = 1.4;

function encodable(font: PDFFont, text: string): string {
  let out = "";
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export async function renderRiderPdf(title: string, body: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - PAGE.margin * 2;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const draw = (text: string, font: PDFFont, size: number, indent = 0) => {
    for (const line of wrap(font, encodable(font, text), size, width - indent)) {
      if (y < PAGE.margin + size * LEADING) {
        page = doc.addPage([PAGE.width, PAGE.height]);
        y = PAGE.height - PAGE.margin;
      }
      page.drawText(line, { x: PAGE.margin + indent, y, size, font });
      y -= size * LEADING;
    }
  };

  draw(title, bold, SIZE.title);
  y -= SIZE.body;
  for (const block of riderBlocks(body)) {
    if (block.kind === "blank") y -= SIZE.body * 0.6;
    else if (block.kind === "heading") {
      y -= SIZE.body * 0.4;
      draw(block.text, bold, SIZE.heading);
    } else if (block.kind === "item") {
      draw(`•  ${block.text}`, regular, SIZE.body, 8);
    } else draw(block.text, regular, SIZE.body);
  }

  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawText(`Page ${index + 1} of ${pages.length}`, { x: PAGE.margin, y: PAGE.margin / 2, size: 8, font: regular });
  });
  return Buffer.from(await doc.save());
}
