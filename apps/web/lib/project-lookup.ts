import type { WebSuggestion } from "@/lib/ask/webSuggestions";

/**
 * WEB-FOUND FACTS -> THE PURSUIT FORM'S FIELDS.
 *
 * Pure and dependency-free, in a lib module rather than inside
 * `ProjectLookup.tsx`, for the reason `sheetIndex.ts` states about itself: the
 * unit suite runs in `environment: "node"`, so logic that lives here is testable
 * in a millisecond and logic that lives in a component is not.
 *
 * ── THE MAPPING, AND THE THREE FIELDS THAT HAVE NOWHERE TO GO ──
 *
 * `research.ts` can return seven fields. `BidPursuit` has columns for three of
 * them:
 *
 *   owner              -> owner
 *   architect          -> architect
 *   generalContractors -> expectedGcs
 *
 * `size`, `projectScope` and `planRoom` have no column, and inventing three is
 * the wrong move — ARCHITECTURE.md's rule is to ask whether a thing is really a
 * new shape, and a plan-room URL somebody found once is a note, not a schema.
 * They go into the note, labelled, with their source URL kept so the link
 * survives the save.
 *
 * ── AND `bidDate`, WHICH IS THE ONE DECISION WORTH ARGUING WITH ──
 *
 * It also goes to the NOTE and never to `expectedBidDate`, although a date
 * column exists and the found value is a date. Three reasons, and the first is
 * this repo's own rule:
 *
 *   - dates that matter are ENTERED, not stamped. `BidPursuitFields` says the
 *     same about this exact field — "an expected bid date is somebody's estimate"
 *     — and a value read off a plan-room page is not the user's estimate;
 *   - the value is free text as printed ("Nov 14", "late spring", "2/14 2pm"),
 *     and `optionalDateFromString` would turn most of those into null. A field
 *     that silently drops what it was given is worse than one left blank;
 *   - a wrong bid date is the most expensive field on a pursuit.
 *     `bid-responsiveness.ts` exists because a bid submitted late is rejected
 *     unread, and `isBidDateComingUp`/`isBidDatePassed` drive what the pipeline
 *     tells somebody to do next.
 *
 * So the found date is shown, kept as text, and the person types the date they
 * are willing to be held to.
 */

/** Found fields that have no column of their own and are carried in the note. */
export const NOTE_ONLY_FIELDS = ["size", "projectScope", "planRoom"] as const;

/** `BidPursuit.note` is `maxLength={500}` on the form and the action trims to
 *  the same, so the note is built to fit rather than truncated by surprise. */
export const NOTE_MAX_CHARS = 500;

const DIRECT_FIELD: Record<string, "owner" | "architect" | "expectedGcs"> = {
  owner: "owner",
  architect: "architect",
  generalContractors: "expectedGcs",
};

export type PursuitPrefill = {
  projectName?: string;
  owner?: string;
  architect?: string;
  expectedGcs?: string;
  note?: string;
};

/**
 * One note line for a fact with no column: the label, the value, and the first
 * source URL so the link is not lost when the form is saved.
 */
function noteLine(one: WebSuggestion): string {
  const source = one.sources[0]?.url;
  return `${one.label}: ${one.value}${source ? ` (${source})` : ""}`;
}

/**
 * Build the pursuit form's starting values from the facts the person kept.
 *
 * TAKES ONLY THE KEPT ONES — the caller filters by what is still ticked, so an
 * unticked fact cannot reach a field. Last writer wins on a duplicate key, which
 * cannot happen: `suggestionsFrom` already drops a second copy of a field.
 */
export function pursuitPrefillFrom(projectName: string, kept: readonly WebSuggestion[]): PursuitPrefill {
  const prefill: PursuitPrefill = {};
  const trimmedName = projectName.trim();
  if (trimmedName) prefill.projectName = trimmedName;

  const noteLines: string[] = [];

  for (const one of kept) {
    const direct = DIRECT_FIELD[one.key];
    if (direct) {
      prefill[direct] = one.value;
      continue;
    }
    // Everything else — the three with no column, plus `bidDate`, which has one
    // and deliberately does not use it. An unknown key arriving from a future
    // research field lands here too, which is the safe direction: it is shown in
    // the note rather than silently dropped.
    noteLines.push(noteLine(one));
  }

  if (noteLines.length > 0) {
    // JOINED, THEN CUT ONCE, at a line boundary where possible — half a URL is
    // worse than an absent one, because it looks like a link and is not.
    let note = noteLines.join(" · ");
    if (note.length > NOTE_MAX_CHARS) {
      const keepable: string[] = [];
      let used = 0;
      for (const line of noteLines) {
        const cost = keepable.length === 0 ? line.length : line.length + 3;
        if (used + cost > NOTE_MAX_CHARS) break;
        keepable.push(line);
        used += cost;
      }
      // If even the first line does not fit, cut it rather than return nothing:
      // a clipped fact the person can read beats an empty note.
      note = keepable.length > 0 ? keepable.join(" · ") : noteLines[0]!.slice(0, NOTE_MAX_CHARS);
    }
    prefill.note = note;
  }

  return prefill;
}
