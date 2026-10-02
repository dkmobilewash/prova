import { LEAD_FIELDS, type FoundLead, type LeadField } from "@prova/integrations";

/**
 * A FOUND LEAD -> THE PURSUIT FORM'S FIELDS.
 *
 * Pure and in a lib module rather than inside the component, for the reason
 * `sheetIndex.ts` gives about itself: the unit suite runs in
 * `environment: "node"`, so logic here is testable in a millisecond and logic in
 * a component is not.
 *
 * ── THE MAPPING, AND THE ONE COLUMN IT FILLS ──
 *
 * `LEAD_FIELDS` has seven members and `BidPursuit` has a column for exactly one
 * of them:
 *
 *   projectName  -> projectName
 *   owner        -> owner
 *
 * `location`, `bidDate`, `scopeSummary`, `sizeText` and `deliveryMethod` have no
 * column. They go into the note, labelled, with the lead's source URL — and
 * inventing five columns for them is the wrong move, which is ARCHITECTURE.md's
 * question: is this really a new shape, or is it a note? A delivery method
 * somebody read off a bid board once is a note.
 *
 * There is no `architect` in a lead, unlike a project look-up, so that column is
 * never filled from here.
 *
 * ── `bidDate` GOES TO THE NOTE, NOT TO `expectedBidDate` ──
 *
 * The same refusal the project look-up makes, for the same three reasons, and it
 * is worth repeating rather than cross-referencing because this is the path a
 * person is most likely to use in bulk:
 *
 *   - dates that matter are ENTERED, not stamped, and `BidPursuitFields` says so
 *     about this exact field;
 *   - the value is free text as a bid board printed it, so most of it would
 *     parse to null and be silently dropped;
 *   - a wrong bid date is the most expensive field on a pursuit —
 *     `bid-responsiveness.ts` exists because a late bid is rejected unread, and
 *     `isBidDateComingUp` drives what the pipeline tells somebody to do next.
 *
 * A lead's whole appeal is its bid date, so the date is shown prominently and
 * carried as text. The person types the one they will be held to.
 *
 * ── A NOTE ON DUPLICATION, SAID RATHER THAN HIDDEN ──
 *
 * `lib/project-lookup.ts` (#579, open at the time of writing) builds a note from
 * labelled facts with sources and clips it to the same column limit. That is two
 * implementations of one rule, which is how one of them stops being true —
 * CLAUDE.md's own lesson, twice over. They are separate only because neither
 * branch may be based on the other, and unifying them is a follow-up once both
 * are on `main`, not a reason to leave the second one unwritten.
 */

/** `BidPursuit.note` is `maxLength={500}` on the form and the action trims to the
 *  same, so the note is built to fit rather than truncated by surprise. */
export const NOTE_MAX_CHARS = 500;

/** How each column-less field is labelled in the note, in the order it reads
 *  best to somebody scanning a pursuit. Derived against `LEAD_FIELDS` by the
 *  test, so a new research field cannot be silently unlabelled. */
export const LEAD_NOTE_LABELS: Partial<Record<LeadField, string>> = {
  location: "Location",
  bidDate: "Bid date (web)",
  deliveryMethod: "Delivery",
  sizeText: "Size",
  scopeSummary: "Scope",
};

export type LeadPrefill = {
  projectName?: string;
  owner?: string;
  note?: string;
};

/**
 * Build the pursuit form's starting values from one found lead.
 *
 * `projectName` is always present on a `FoundLead` — `verifiedLeads` drops a
 * lead without one, because a project with no name is a summary of a page rather
 * than a project.
 */
export function leadPrefillFrom(lead: FoundLead): LeadPrefill {
  const prefill: LeadPrefill = { projectName: lead.fields.projectName };
  if (lead.fields.owner) prefill.owner = lead.fields.owner;

  const lines: string[] = [];
  // Iterated over LEAD_FIELDS rather than over the object's own keys, so the
  // order is the declared one and does not depend on how the model happened to
  // emit its tool input.
  for (const field of LEAD_FIELDS) {
    if (field === "projectName" || field === "owner") continue;
    const value = lead.fields[field];
    if (!value) continue;
    lines.push(`${LEAD_NOTE_LABELS[field] ?? field}: ${value}`);
  }
  // The source last, so a clip takes a fact before it takes the link — the link
  // is what makes every fact above it checkable.
  lines.push(`Found at ${lead.source.url}`);

  let note = lines.join(" · ");
  if (note.length > NOTE_MAX_CHARS) {
    // Drop whole facts from the END, keeping the source, rather than cutting
    // mid-string: half a URL looks like a link and is not.
    const source = lines[lines.length - 1]!;
    const facts = lines.slice(0, -1);
    const keep: string[] = [];
    let used = source.length;
    for (const line of facts) {
      if (used + line.length + 3 > NOTE_MAX_CHARS) break;
      keep.push(line);
      used += line.length + 3;
    }
    note = [...keep, source].join(" · ");
    // A source URL alone longer than the column is the only case left; clip it
    // rather than return nothing, since an empty note reads as "nothing found".
    if (note.length > NOTE_MAX_CHARS) note = note.slice(0, NOTE_MAX_CHARS);
  }
  prefill.note = note;

  return prefill;
}
