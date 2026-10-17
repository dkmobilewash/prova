import type { SubcontractOurSide } from "@prova/integrations/src/subcontractReview";

/**
 * OUR SIDE OF THE DEAL, as handed to the model beside each chunk — the job's
 * proposal clauses and a list of the scope we priced. Phase 2.
 *
 * The model only COMPARES against this; it never quotes it, and nothing it
 * returns about our side is believed unless it names a clause ref we gave it
 * (`validateScopeChecks`). Built here, pure, so the caps and the refs are
 * reachable by a test.
 *
 * Reads only. The line descriptions are JobLineItem text, read the way every
 * other report reads them; no estimating module is called or changed.
 */

export type ClauseInput = { id: string; kind: string; text: string };
export type PricedBidLine = { kind: string; label: string; description: string | null; accepted: boolean | null };

/** Enough to cover a real estimate's distinct scope lines; few enough that a
 *  chunk's prompt stays well inside the 60-second budget. */
export const MAX_PRICED_LINES = 80;
export const MAX_PRICED_LINE_LENGTH = 140;
export const MAX_CLAUSES = 60;

export type OurSide = {
  ourSide: SubcontractOurSide;
  /** "C3" → the clause it stands for. */
  clauseByRef: Map<string, ClauseInput>;
};

export function buildOurSide(
  clauses: readonly ClauseInput[],
  lineDescriptions: readonly string[],
  bidLines: readonly PricedBidLine[],
): OurSide {
  const used = clauses.slice(0, MAX_CLAUSES);
  const clauseByRef = new Map(used.map((clause, index) => [`C${index + 1}`, clause]));

  const seen = new Set<string>();
  const priced: string[] = [];
  const add = (raw: string) => {
    const line = raw.replace(/\s+/g, " ").trim().slice(0, MAX_PRICED_LINE_LENGTH);
    const key = line.toLowerCase();
    if (line === "" || seen.has(key) || priced.length >= MAX_PRICED_LINES) return;
    seen.add(key);
    priced.push(line);
  };
  for (const description of lineDescriptions) add(description);
  for (const line of bidLines) {
    // A rejected alternate is not scope we are carrying.
    if (line.kind === "ALTERNATE" && line.accepted === false) continue;
    const kind = line.kind === "ALTERNATE" ? "Alternate" : line.kind === "ALLOWANCE" ? "Allowance" : "Unit price";
    add(`${kind}: ${line.label}${line.description ? ` — ${line.description}` : ""}`);
  }

  return {
    ourSide: {
      clauses: [...clauseByRef].map(([ref, clause]) => ({ ref, kind: clause.kind, text: clause.text })),
      priced,
    },
    clauseByRef,
  };
}
