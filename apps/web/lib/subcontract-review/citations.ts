import {
  SUBCONTRACT_TERM_NUMBER_KEYS,
  type SubcontractFindingExtraction,
  type SubcontractScopeCheckExtraction,
  type SubcontractTerms,
} from "@prova/integrations/src/subcontractReview";
import { normaliseForQuoteMatch, whyNot } from "@/lib/specs/quoteMatch";

/**
 * THE GATE BETWEEN WHAT THE MODEL SAID AND WHAT A PERSON IS SHOWN.
 *
 * The hard rule for this feature: a finding without a valid citation is
 * dropped, never shown. This is where that rule lives, and it is the first
 * runtime caller of `quoteMatch.ts` — until now that matcher only ran inside a
 * paid eval. It is imported unchanged: smart quotes and dashes map to ASCII,
 * whitespace collapses, and nothing fuzzier is allowed through.
 *
 * Three things are decided HERE, by code, and never taken from the model:
 *
 *   - WHICH PAGE. The quote is searched for on each page of the chunk the
 *     model was given, then across each adjacent pair (a clause that crosses a
 *     page break). The model's own page claim is ignored.
 *   - THE SECTION REFERENCE, kept only if that string is printed on the
 *     located page(s).
 *   - EACH FIGURE, kept only if the number appears in the finding's own quote.
 *     A model that rounded, converted or computed has the number nulled — the
 *     finding stays, without a figure nobody can check.
 *
 * One allowance on the DOCUMENT side, not the quote side: a word hyphenated
 * across a line break ("indem-" / "nify") is also matched joined, because a
 * reader quoting the sentence correctly writes the word whole. That repairs an
 * artefact of typesetting; it cannot turn one word into another.
 */

export type ChunkPage = { page: number; lines: readonly string[] };

export type PageLocation = { pageStart: number; pageEnd: number };

export type ValidatedFinding = {
  extraction: SubcontractFindingExtraction;
  location: PageLocation;
  sectionRef: string | null;
  terms: SubcontractTerms;
};

export type DroppedFinding = {
  extraction: SubcontractFindingExtraction;
  reason: "too-short" | "not-in-document";
};

/** Join a word hyphenated at a line end: ["indem-", "nify the"] → ["indemnify the"]. */
export function joinLineEndHyphens(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (previous !== undefined && /[A-Za-z]-$/.test(previous) && /^[a-z]/.test(line)) {
      out[out.length - 1] = previous.slice(0, -1) + line;
    } else {
      out.push(line);
    }
  }
  return out;
}

function matches(quote: string, lines: readonly string[]): boolean {
  return whyNot(quote, lines) === null || whyNot(quote, joinLineEndHyphens(lines)) === null;
}

/** Where in `pages` the quote sits, or why it does not. */
export function locateQuote(
  quote: string,
  pages: readonly ChunkPage[],
): { ok: true; location: PageLocation } | { ok: false; reason: "too-short" | "not-in-document" } {
  if (whyNot(quote, [quote]) === "too-short") return { ok: false, reason: "too-short" };
  for (const page of pages) {
    if (matches(quote, page.lines)) return { ok: true, location: { pageStart: page.page, pageEnd: page.page } };
  }
  const furniture = pageFurniture(pages);
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i]!;
    const b = pages[i + 1]!;
    const joined = [...trimEnd(a.lines, furniture), ...trimStart(b.lines, furniture)];
    if (matches(quote, joined)) {
      return { ok: true, location: { pageStart: a.page, pageEnd: b.page } };
    }
  }
  return { ok: false, reason: "not-in-document" };
}

/**
 * RUNNING HEADERS AND FOOTERS, which sit between the two halves of any clause
 * that crosses a page break — "…regardless of whether such claim" / "Page 3 of
 * 12" / "is caused in whole or in part…". A correct quote of that clause can
 * only be found once they are set aside.
 *
 * Deliberately narrow, because removing lines can create adjacency that was not
 * on the page: only the first or last TWO lines of a page are candidates, only
 * at the page boundary being joined, and a candidate counts as furniture only
 * if it is a short page-number line or it recurs (digits ignored) at the edge of
 * another page. Body text does not repeat at page edges; a footer does.
 */
const EDGE_LINES = 2;
const PAGE_NUMBER_LINE = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$|\bpage\s+\d+\b/i;

function edgeForm(line: string): string {
  return normaliseForQuoteMatch(line).replace(/\d+/g, "#");
}

export function pageFurniture(pages: readonly ChunkPage[]): Set<string> {
  const seenOn = new Map<string, Set<number>>();
  for (const page of pages) {
    const edges = [...page.lines.slice(0, EDGE_LINES), ...page.lines.slice(-EDGE_LINES)];
    for (const line of edges) {
      const form = edgeForm(line);
      if (!seenOn.has(form)) seenOn.set(form, new Set());
      seenOn.get(form)!.add(page.page);
    }
  }
  const furniture = new Set<string>();
  for (const [form, onPages] of seenOn) if (onPages.size >= 2) furniture.add(form);
  return furniture;
}

function isFurniture(line: string, furniture: Set<string>): boolean {
  return (line.length <= 60 && PAGE_NUMBER_LINE.test(line.trim())) || furniture.has(edgeForm(line));
}

function trimEnd(lines: readonly string[], furniture: Set<string>): string[] {
  const out = [...lines];
  for (let n = 0; n < EDGE_LINES && out.length > 0 && isFurniture(out[out.length - 1]!, furniture); n++) out.pop();
  return out;
}

function trimStart(lines: readonly string[], furniture: Set<string>): string[] {
  const out = [...lines];
  for (let n = 0; n < EDGE_LINES && out.length > 0 && isFurniture(out[0]!, furniture); n++) out.shift();
  return out;
}

/** The printed section reference, if it really is printed on those pages. */
export function verifiedSectionRef(
  sectionRef: string | null,
  location: PageLocation,
  pages: readonly ChunkPage[],
): string | null {
  if (!sectionRef) return null;
  const needle = normaliseForQuoteMatch(sectionRef);
  if (needle.length === 0) return null;
  const text = normaliseForQuoteMatch(
    pages
      .filter((page) => page.page >= location.pageStart && page.page <= location.pageEnd)
      .flatMap((page) => page.lines)
      .join(" "),
  );
  return text.includes(needle) ? sectionRef : null;
}

/** Every number written in `text`, as values: "$1,500.00" → 1500, "(48)" → 48, "10%" → 10. */
export function numbersInText(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = match[0].replace(/,/g, "");
    const value = Number(raw);
    if (Number.isFinite(value)) found.add(value);
  }
  return found;
}

/** The figures, with any figure the quote does not state set to null. */
export function figuresStatedIn(terms: SubcontractTerms, quote: string): SubcontractTerms {
  const stated = numbersInText(quote);
  const kept: SubcontractTerms = { ...terms };
  for (const key of SUBCONTRACT_TERM_NUMBER_KEYS) {
    const value = kept[key];
    if (value !== null && !stated.has(value)) kept[key] = null;
  }
  return kept;
}

/** Split a chunk's findings into the ones a person may see and the ones dropped. */
export function validateFindings(
  findings: readonly SubcontractFindingExtraction[],
  pages: readonly ChunkPage[],
): { kept: ValidatedFinding[]; dropped: DroppedFinding[] } {
  const kept: ValidatedFinding[] = [];
  const dropped: DroppedFinding[] = [];
  for (const extraction of findings) {
    if (extraction.title.trim() === "" || extraction.explanation.trim() === "") {
      dropped.push({ extraction, reason: "not-in-document" });
      continue;
    }
    const located = locateQuote(extraction.quote, pages);
    if (!located.ok) {
      dropped.push({ extraction, reason: located.reason });
      continue;
    }
    kept.push({
      extraction,
      location: located.location,
      sectionRef: verifiedSectionRef(extraction.sectionRef, located.location, pages),
      terms: figuresStatedIn(extraction.terms, extraction.quote),
    });
  }
  return { kept, dropped };
}

// ── Scope checks (Phase 2) ───────────────────────────────────────────────────

export type ValidatedScopeCheck = {
  extraction: SubcontractScopeCheckExtraction;
  location: PageLocation;
  clause: { id: string; kind: string; text: string } | null;
};

/**
 * The same gate for comparisons against our side: the CONTRACT's words must be
 * on the page, and a check that names one of our clauses must name a ref we
 * actually handed over — a model that invents "C9" when we gave it six clauses
 * has its check dropped, not attached to a clause it never saw. A relation that
 * is about a clause (contradicts / carries) without a valid ref is dropped too;
 * NOT_IN_OUR_PRICED_SCOPE needs none.
 */
export function validateScopeChecks(
  checks: readonly SubcontractScopeCheckExtraction[],
  pages: readonly ChunkPage[],
  clauseByRef: ReadonlyMap<string, { id: string; kind: string; text: string }>,
): { kept: ValidatedScopeCheck[]; dropped: number } {
  const kept: ValidatedScopeCheck[] = [];
  let dropped = 0;
  for (const extraction of checks) {
    const needsClause = extraction.relation !== "NOT_IN_OUR_PRICED_SCOPE";
    const clause = extraction.clauseRef ? (clauseByRef.get(extraction.clauseRef.trim().toUpperCase()) ?? null) : null;
    if ((needsClause && !clause) || extraction.explanation.trim() === "") {
      dropped++;
      continue;
    }
    const located = locateQuote(extraction.quote, pages);
    if (!located.ok) {
      dropped++;
      continue;
    }
    kept.push({ extraction, location: located.location, clause: needsClause ? clause : null });
  }
  return { kept, dropped };
}
