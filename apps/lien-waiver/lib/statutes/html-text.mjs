// The ONE function that turns a captured statute page into text.
//
// Deterministic and dependency-free on purpose. Its output is committed
// (statutes/text/<id>.txt) and a test re-derives it from the raw capture on
// every run, so the text file cannot be edited by hand: change a character
// in it and the build says so.
//
// What it does, and the whole of what it does:
//
//   1. decodes the bytes in the charset the page DECLARES (Nevada's pages
//      are windows-1252; reading them as UTF-8 turns every section sign and
//      curly quote into a replacement character);
//   2. drops <head>, <script>, <style> and comments;
//   3. breaks the document into blocks at block-level tags (p, div, br, li,
//      headings, table cells/rows), so a paragraph of the statute is one
//      line of text;
//   4. strips the remaining tags and decodes character references -- and
//      THROWS on a named entity it does not know, rather than leaving it or
//      guessing, because a guessed character in a statute is a wrong one;
//   5. collapses whitespace inside each block (space, tab, newline, no-break
//      space, en/em/thin spaces) to one ordinary space and trims it, then
//      NFC-normalizes. That is item 1 and 2 of the approved normalization
//      list (lib/statutes/normalization.ts) and nothing else happens here.
//
// Everything else -- which paragraphs are a form, which characters are
// drafting rather than form -- is decided in the per-state form data, where
// it is enumerated and reviewable.

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sect: "§",
  para: "¶",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  frac12: "½",
  deg: "°",
  bull: "•",
  middot: "·",
};

/** Space characters collapsed to one ASCII space. Listed, not `\s`, so the
 * set is exactly what the normalization list in the attorney packet says. */
export const COLLAPSED_SPACES = [
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  " ", // no-break space
  " ", // en space (Nevada puts one after every section number)
  " ", // em space
  " ", // thin space
  " ", // hair space
  " ", // narrow no-break space
];
const SPACE_RUN = new RegExp(`[${COLLAPSED_SPACES.join("").replace(/[\t\n\r\f]/g, (c) => ({ "\t": "\\t", "\n": "\\n", "\r": "\\r", "\f": "\\f" })[c])}]+`, "g");

// Windows-1252's 0x80-0x9F, from the WHATWG Encoding Standard's index.
// DECODED BY HAND, NOT BY TextDecoder, because a Node built without full ICU
// decodes "windows-1252" as Latin-1: 0x92 comes back as U+0092, an invisible
// C1 control, instead of the apostrophe. That turned Nevada's "Undersigned's
// Customer" into "Undersigneds Customer" with nothing on screen to say a
// character had gone -- the exact one-character error this tool exists to
// rule out. `htmlToParagraphs` now also refuses any C1 control in its output.
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function decode(bytes, charset) {
  if (charset === "windows-1252" || charset === "cp1252" || charset === "iso-8859-1" || charset === "latin1") {
    // (WHATWG treats a declared iso-8859-1 as windows-1252 too.)
    let out = "";
    for (const byte of bytes) {
      out += String.fromCodePoint(byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80] : byte);
    }
    return out;
  }
  if (charset === "utf-8" || charset === "utf8") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  throw new Error(`unsupported charset ${charset}: decode it deliberately rather than guessing`);
}

export function declaredCharset(bytes) {
  const head = Buffer.from(bytes).subarray(0, 4096).toString("latin1");
  const match = head.match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i);
  return (match?.[1] ?? "utf-8").toLowerCase();
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED)) throw new Error(`unknown HTML entity ${whole}: add it to NAMED in html-text.mjs, deliberately`);
    return NAMED[body];
  });
}

export function collapseSpaces(text) {
  return text.replace(SPACE_RUN, " ").trim().normalize("NFC");
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|tbody|thead|blockquote|pre|section|article|header|footer|dd|dt|dl)\b[^>]*>/gi;

/** Statute page bytes -> one string per paragraph, in document order. */
export function htmlToParagraphs(bytes) {
  const charset = declaredCharset(bytes);
  let html = decode(Buffer.from(bytes), charset);
  html = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    // Arizona's pages carry SGML-style "<!Creation Date: ...>" lines.
    .replace(/<![^>]*>/g, " ");
  return html
    .replace(BLOCK, "\u0000")
    .split("\u0000")
    .map((block) => collapseSpaces(decodeEntities(block.replace(/<[^>]*>/g, ""))))
    .filter((block) => block.length > 0)
    .map((block) => {
      const control = block.match(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\ufffd]/);
      if (control) {
        throw new Error(
          `control or replacement character U+${control[0].codePointAt(0).toString(16).padStart(4, "0")} in "${block.slice(0, 60)}": the page was decoded in the wrong charset`,
        );
      }
      return block;
    });
}
