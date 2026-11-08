/**
 * ── WHERE THIS SUB'S SECTIONS ARE IN A WHOLE SPEC BOOK ──
 *
 * A project manual is hundreds of pages; a framing/drywall, plaster/EIFS,
 * ceilings or fireproofing sub's work is in five or six sections of Division 09
 * and 07. This finds them from the words alone — no model call — the way an
 * estimator flips to them: the "SECTION 09 21 16" heading that opens a section,
 * the "09 21 16 - 3" label printed on every page of it, "END OF SECTION", and
 * the table of contents for titles a heading leaves out.
 *
 * Both numbering systems are read: MasterFormat 2004 ("09 21 16", "092116") and
 * the 1995 five-digit numbers older books still use ("09250"). A number is kept
 * as printed in spirit but normalised to "09 21 16" / "09250", so the same
 * section in a heading, a page label and the index is one section.
 *
 * Pages with no text (a scanned book) yield nothing, and the caller says so.
 */

export type SpecPage = { page: number; lines: readonly string[] };

export type FoundSection = {
  /** "09 21 16" or, for a 1995 number, "09250". */
  number: string;
  title: string | null;
  pageFrom: number;
  pageTo: number;
  /** One of this product's trades (`isTradeSection`). */
  trade: boolean;
};

export type SpecBookScan = {
  sections: FoundSection[];
  /** Pages carrying any text; zero means a scanned book. */
  pagesWithText: number;
};

/**
 * The sections this product's trades price. Diego's five, plus their near
 * neighbours a book files the same work under: 07 24 00 is EIFS's own number
 * (09 24 00 is cement plaster, which is also this product's), 09 22 26 the
 * ceiling suspension a framer often carries, 09 29 00 gypsum board in books that
 * never split it, and the 1995 numbers for all of them.
 */
const TRADE_PREFIXES_2004 = ["09 21", "09 22", "09 23", "09 24", "09 26", "09 29", "09 51", "09 53", "07 24", "07 81"];
const TRADE_PREFIXES_1995 = ["0920", "0921", "0925", "0926", "0951", "0954", "0724", "0781"];

export function isTradeSection(number: string): boolean {
  return number.includes(" ")
    ? TRADE_PREFIXES_2004.some((prefix) => number.startsWith(prefix))
    : TRADE_PREFIXES_1995.some((prefix) => number.startsWith(prefix));
}

/** "092116", "09 21 16", "09-21-16", "09 21 16.13" → "09 21 16"; "09250" → "09250". */
export function normaliseSectionNumber(raw: string): string | null {
  const six = raw.match(/^(\d{2})[\s.-]?(\d{2})[\s.-]?(\d{2})(?:\.\d{2})?$/);
  if (six) return `${six[1]} ${six[2]} ${six[3]}`;
  if (/^\d{5}$/.test(raw)) return raw;
  return null;
}

// A number in any of the spellings above, not glued to other digits.
const NUM = String.raw`(\d{2}[\s.-]?\d{2}[\s.-]?\d{2}(?:\.\d{2})?|\d{5})`;
const HEADING = new RegExp(String.raw`^SECTION\s+${NUM}(?!\d)\s*(?:[-–—:|]\s*)?(.*)$`, "i");
const PAGE_LABEL = new RegExp(String.raw`(?:^|\s|\|)${NUM}\s*[-–—]\s*(\d{1,3})\s*$`);
const END = /\bEND\s+OF\s+SECTION\b/i;
const TOC_LINE = new RegExp(String.raw`^(?:SECTION\s+)?${NUM}(?!\d)\s*(?:[-–—:|.]\s*)?([A-Za-z].*?)(?:[\s.|]+\d{1,4})?$`, "i");

/** Lines a heading's title is never: the parts of a section, and running heads. */
const NOT_A_TITLE = /^(PART\s+\d|\d+\.\d+|[A-Z]\.\s|END OF|SECTION\s)/i;

function clean(line: string): string {
  return line.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(words: string): string | null {
  const t = words.replace(/[\s.\-–—:]+$/, "").trim();
  if (t === "" || NOT_A_TITLE.test(t) || /^\d+$/.test(t)) return null;
  return t;
}

export function findSpecSections(pages: readonly SpecPage[]): SpecBookScan {
  const tocTitles = new Map<string, string>();
  type PageRead = { page: number; heading: { number: string; title: string | null } | null; label: string | null; ends: boolean };
  const reads: PageRead[] = [];
  let pagesWithText = 0;

  for (const { page, lines: raw } of pages) {
    const lines = raw.map(clean).filter((l) => l !== "");
    if (lines.length > 0) pagesWithText += 1;

    // A table of contents lists many sections on one page; none of them starts there.
    const tocHits = lines.map((l) => l.match(TOC_LINE)).filter((m): m is RegExpMatchArray => m !== null);
    if (tocHits.length >= 4) {
      for (const hit of tocHits) {
        const number = normaliseSectionNumber(hit[1].replace(/\s+/g, " "));
        const title = titleCase(hit[2] ?? "");
        if (number && title && !tocTitles.has(number)) tocTitles.set(number, title);
      }
      reads.push({ page, heading: null, label: null, ends: false });
      continue;
    }

    let heading: PageRead["heading"] = null;
    const top = lines.slice(0, 8);
    for (let i = 0; i < top.length; i++) {
      const hit = top[i].match(HEADING);
      if (!hit) continue;
      const number = normaliseSectionNumber(hit[1]);
      if (!number) continue;
      const next = top[i + 1];
      heading = { number, title: titleCase(hit[2] ?? "") ?? (next ? titleCase(next) : null) };
      break;
    }

    let label: string | null = null;
    for (const line of [...lines.slice(-4), ...lines.slice(0, 4)]) {
      const hit = line.match(PAGE_LABEL);
      const number = hit ? normaliseSectionNumber(hit[1]) : null;
      if (number) {
        label = number;
        break;
      }
    }
    reads.push({ page, heading, label, ends: lines.some((l) => END.test(l)) });
  }

  const sections: FoundSection[] = [];
  let open = null as FoundSection | null;
  const close = () => {
    if (open) sections.push(open);
    open = null;
  };
  for (const read of reads) {
    const current: FoundSection | null = open;
    const startsHere: string | null =
      read.heading?.number ?? (read.label !== null && read.label !== current?.number ? read.label : null);
    if (startsHere !== null) {
      close();
      open = {
        number: startsHere,
        title: read.heading?.title ?? null,
        pageFrom: read.page,
        pageTo: read.page,
        trade: isTradeSection(startsHere),
      };
    } else if (open && (read.label === open.number || read.label === null)) {
      open.pageTo = read.page;
    }
    if (read.ends) close();
    // A page that belongs to nothing (a TOC, a divider, an unlabelled page after END) closes nothing more.
  }
  close();

  for (const section of sections) section.title ??= tocTitles.get(section.number) ?? null;
  return { sections, pagesWithText };
}
