import { BAND_RANK, type FitBand } from "@/lib/sales-qualification";

/**
 * THE ORDER `/sales` IS WORKED DOWN, IN A PLAIN MODULE ON PURPOSE.
 *
 * This lived in `components/SalesLeadRow.tsx` for exactly one CI run, and
 * `lib/client-boundary.test.ts` was right to refuse it: that file is
 * `"use client"`, so a non-component value imported from it across the RSC
 * boundary arrives as a CLIENT-REFERENCE PROXY rather than the function, and a
 * server component calling it gets something that is not a comparator. The
 * census named the fix in its own failure message — "move it into a plain
 * module and import it from both sides" — which is this file.
 *
 * Worth recording why the first attempt looked safe: the sort was only ever
 * CALLED from inside a client component, so nothing was broken at runtime. The
 * violation was that the values were REACHABLE across the boundary, and a guard
 * that waited for somebody to actually call one would fire on the day a server
 * component imported it rather than the day it became possible.
 *
 * Nothing here renders, so it has no `"use client"` of its own and both sides
 * may import it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO TO RING FIRST, WHICH IS THE ONLY QUESTION THIS LIST IS FOR.
 *
 * `/sales` listed leads in CREATION ORDER, newest first, and
 * `lib/sales-qualification.ts` has exported `BAND_RANK` — "sort order for a
 * list of leads: the ones worth calling first" — since it was written, with
 * exactly ONE importer in the whole repo: its own unit test, asserting that
 * every band has a distinct rank. So the ranking existed, was tested, and
 * ordered nothing anybody could see. CLAUDE.md's "written, documented, and
 * never called" shape, wearing a comment that says what it is for.
 *
 * That is not cosmetic on this screen. One imported §4104 listing adds up to
 * 60 leads at once (`MAX_LISTING_ROWS`), every one of them created in the same
 * transaction and therefore newer than everything already on the page — so the
 * few leads with a GC, a job and a confirmed trade got buried under dozens of
 * rows that say "Not confirmed yet".
 *
 * ── WHY THE ORDER IS COMPUTED HERE AND NOT IN THE DATABASE ──
 *
 * The band is DERIVED from the lead's confirmed signals on every read and is
 * deliberately stored nowhere (CLAUDE.md: derived state is never stored — a
 * stored band disagrees with its own signals the moment one is dismissed).
 * There is no column to `ORDER BY`, so the sort happens after `qualify` has
 * run, over rows the page has already materialised in full. No rank is cached
 * and no column is added.
 *
 * ── WHY THE TIEBREAK IS A TOTAL ORDER, WHICH IS NOT DEFENSIVE PADDING ──
 *
 * `createdAt` is `DEFAULT CURRENT_TIMESTAMP`, and in Postgres that is the
 * START OF THE TRANSACTION, not the moment of the INSERT. `importSubListing`
 * creates every lead inside one `prisma.$transaction`, so all 60 rows of an
 * import carry an IDENTICAL `createdAt` to the millisecond — measured against
 * a real Postgres 16, three inserts 120ms apart in one transaction, one
 * distinct timestamp. `ORDER BY createdAt DESC` is therefore not a total order
 * for precisely the case this list exists to handle, and Postgres may return
 * tied rows in any order it likes: two loads of the same page could put the
 * same 60 leads in different orders, which is the "reads as random" complaint
 * arriving for a second reason. The id settles every tie, so the order is
 * reproducible.
 *
 * ── WHY NEWEST-FIRST RATHER THAN LEAST-RECENTLY-CONTACTED ──
 *
 * Both were available; creation order wins on three counts. It is TOTAL and
 * never null, where `lastContactOn` is null on every freshly imported lead —
 * so a contact-based tiebreak would leave those 60 rows in no order at all,
 * which is the defect rather than the fix. The page already has a section for
 * contact recency (the follow-up queue), and a second ranking of the same
 * leads by the same quantity would compete with it. And it is what the list
 * already did, so the band is the one thing this change moves.
 */

/** Everything the order reads. A lead is orderable without being renderable. */
export type CallOrderLead = {
  id: string;
  band: FitBand;
  /** ISO-8601 UTC, fixed width — see `SalesLeadRowLead.createdAt`. */
  createdAt: string;
};

/**
 * Strongest band first; within a band, most recently recorded first; ties
 * settled by id so the result is the same on every read.
 */
export function compareForCalling(a: CallOrderLead, b: CallOrderLead): number {
  const byBand = BAND_RANK[a.band] - BAND_RANK[b.band];
  if (byBand !== 0) return byBand;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The leads, in the order somebody should work down them. Copies rather than
 *  sorting in place: the caller's array is a render input, not scratch space. */
export function orderForCalling<T extends CallOrderLead>(
  leads: readonly T[],
): T[] {
  return [...leads].sort(compareForCalling);
}

/**
 * The same order, cut into bands by ADJACENCY in the sorted list rather than
 * by walking `FIT_BANDS` and filtering.
 *
 * That is the whole reason this cannot drift from `orderForCalling`: the band
 * sequence comes only from the comparator, so there is no second statement
 * anywhere about which band outranks which. A comparator that stopped ordering
 * would not quietly keep tidy headings — it would fragment the groups, and the
 * tests below read that.
 */
export function groupForCalling<T extends CallOrderLead>(
  leads: readonly T[],
): { band: FitBand; leads: T[] }[] {
  const groups: { band: FitBand; leads: T[] }[] = [];
  for (const lead of orderForCalling(leads)) {
    const last = groups[groups.length - 1];
    if (last && last.band === lead.band) last.leads.push(lead);
    else groups.push({ band: lead.band, leads: [lead] });
  }
  return groups;
}
