import type { SubcontractFindingExtraction, SubcontractTerms } from "@prova/integrations/src/subcontractReview";
import { planChunks, newPagesInChunk } from "./chunks";
import type { ChunkPage, ValidatedFinding } from "./citations";
import { uniqueByKey } from "./findings";
import { findingKey } from "./keys";
import { EXHIBIT_ROLES, SOURCE_ROLE_LABEL, type SourceRole } from "./roles";

export { SOURCE_ROLES, EXHIBIT_ROLES, SOURCE_ROLE_LABEL, type SourceRole } from "./roles";
import type { PageTexts } from "./pageText";

/**
 * The bookkeeping of one review run, kept pure so the action stays a sequence
 * of database calls and every decision in between is reachable by a test.
 */

export type ExhibitInput = { fileUrl: string; fileName: string; role: SourceRole };

/** At most this many exhibits on one review — a sanity cap, not a product rule. */
export const MAX_EXHIBITS = 8;

/** Parse the `exhibits` form field. Returns a sentence when it is unusable. */
export function parseExhibits(raw: unknown): { ok: true; exhibits: ExhibitInput[] } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, exhibits: [] };
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch {
    return { ok: false, error: "The exhibit list couldn't be read. Remove the exhibits and add them again." };
  }
  if (!Array.isArray(value)) return { ok: false, error: "The exhibit list couldn't be read." };
  if (value.length > MAX_EXHIBITS) return { ok: false, error: `A review can read at most ${MAX_EXHIBITS} exhibits.` };
  const exhibits: ExhibitInput[] = [];
  for (const entry of value) {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.fileUrl !== "string" || typeof e.fileName !== "string") {
      return { ok: false, error: "One of the exhibits is missing its file. Remove it and add it again." };
    }
    const role = (EXHIBIT_ROLES as readonly string[]).includes(e.role as string) ? (e.role as SourceRole) : "OTHER_EXHIBIT";
    exhibits.push({ fileUrl: e.fileUrl, fileName: e.fileName, role });
  }
  return { ok: true, exhibits };
}

export type SourceProgress = {
  id: string;
  ordinal: number;
  role: SourceRole;
  fileName: string;
  pageTexts: PageTexts;
  chunksDone: number;
  chunksTotal: number;
};

export type NextChunk = {
  source: SourceProgress;
  index: number;
  pages: ChunkPage[];
  /** Pages this chunk charges — the ones no earlier chunk of this source had. */
  chargedPages: number;
};

/** The next chunk to read, in source order, or null when every source is done. */
export function nextChunk(sources: readonly SourceProgress[]): NextChunk | null {
  for (const source of [...sources].sort((a, b) => a.ordinal - b.ordinal)) {
    if (source.chunksDone >= source.chunksTotal) continue;
    const plan = planChunks(source.pageTexts);
    const pageNumbers = plan[source.chunksDone];
    // A plan shorter than the stored total means the planner changed under a
    // running review. Treat the source as done rather than reading past the end.
    if (!pageNumbers) continue;
    return {
      source,
      index: source.chunksDone,
      pages: pageNumbers.map((page) => ({ page, lines: source.pageTexts[page - 1] ?? [] })),
      chargedPages: newPagesInChunk(plan, source.chunksDone),
    };
  }
  return null;
}

/** A row ready for `subcontractFinding.createMany`, minus the ids the action adds. */
export type FindingRow = {
  key: string;
  category: SubcontractFindingExtraction["category"];
  subtype: string | null;
  severity: SubcontractFindingExtraction["severity"];
  title: string;
  quote: string;
  pageStart: number;
  pageEnd: number;
  sectionRef: string | null;
  explanation: string;
  suggestedPosition: string;
  questionForGc: string | null;
  terms: SubcontractTerms | null;
};

/** Validated findings → rows, duplicates within the chunk collapsed on the key.
 *  A terms object with nothing in it is stored as null rather than as noise. */
export function findingRows(validated: readonly ValidatedFinding[]): FindingRow[] {
  return uniqueByKey(
    validated.map(({ extraction, location, sectionRef, terms }) => ({
      key: findingKey(extraction.category, extraction.quote),
      category: extraction.category,
      subtype: extraction.subtype,
      severity: extraction.severity,
      title: extraction.title.trim(),
      quote: extraction.quote.trim(),
      pageStart: location.pageStart,
      pageEnd: location.pageEnd,
      sectionRef,
      explanation: extraction.explanation.trim(),
      suggestedPosition: extraction.suggestedPosition.trim(),
      questionForGc: extraction.questionForGc,
      terms: Object.values(terms).some((value) => value !== null) ? terms : null,
    })),
  );
}

/** "Subcontract agreement v2" — what the model is told it is reading. */
export function documentLabel(role: SourceRole, fileName: string, versionNumber: number): string {
  return role === "AGREEMENT" ? `Subcontract agreement v${versionNumber}` : `${SOURCE_ROLE_LABEL[role]} (${fileName})`;
}
