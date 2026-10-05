"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesLead } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SALES_LEAD_SOURCE_OPTIONS } from "@/components/SalesLeadFields";
import { BAND_LABELS, BAND_RANK, type FitBand } from "@/lib/sales-qualification";
import { registrySummaryLine } from "@/lib/sales-registry";

const btn =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";

const FOLLOW_UP_STYLE = {
  OVERDUE: "text-red-400",
  DUE_TODAY: "text-tag-amber-ink",
  UPCOMING: "text-ink-muted",
} as const;

const FOLLOW_UP_LABEL = {
  OVERDUE: "Follow-up was due",
  DUE_TODAY: "Follow up today,",
  UPCOMING: "Follow up",
} as const;

/**
 * "No contact logged" is not "never contacted" and is deliberately worded
 * as a statement about the log rather than about the relationship — nobody
 * has written anything down, which is all this page can honestly claim.
 */
const BAND_STYLE: Record<FitBand, string> = {
  STRONG: "bg-tag-green text-tag-green-ink",
  WORTH_A_CALL: "bg-tag-blue text-tag-blue-ink",
  THIN: "bg-tag-slate text-tag-slate-ink",
  NOT_A_FIT: "bg-tag-rose text-tag-rose-ink",
};

function lastContactLabel(lead: {
  lastContactOn: string | null;
  daysSinceContact: number | null;
}) {
  if (lead.lastContactOn === null || lead.daysSinceContact === null)
    return "No contact logged";
  if (lead.daysSinceContact === 0) return "Last contact today";
  if (lead.daysSinceContact === 1) return "Last contact yesterday";
  return `Last contact ${lead.daysSinceContact} days ago`;
}

/**
 * One row's worth of lead, as the list page composes it. Named rather than
 * inline because the ORDER below is typed against the same object — a second
 * shape describing the same row is the "is there a second list" failure
 * CLAUDE.md records, one notch smaller.
 */
export type SalesLeadRowLead = {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  /** The public-register columns, off a §4104 listing or typed in. Shown
   *  because the licence is what distinguishes a lead somebody can find a
   *  number for from one nobody can reach — see lib/sales-registry.ts. */
  licenceNumber: string | null;
  city: string | null;
  listedByGc: string | null;
  opportunityCount: number;
  /** All derived from SalesActivity at read time — see lib/sales-activity.ts.
   * Every one of these is nullable and null never means zero: a lead with
   * no logged contact is not a lead contacted today. */
  lastContactOn: string | null;
  daysSinceContact: number | null;
  followUpOn: string | null;
  followUpStanding: "OVERDUE" | "DUE_TODAY" | "UPCOMING" | null;
  /** Derived from the lead's signals on every read — see
   *  lib/sales-qualification.ts. The band alone is not enough to act on, so
   *  the reason travels with it; the list shows the reason, because a pill
   *  saying "too thin" tells nobody what to go and find out. */
  band: FitBand;
  bandReason: string;
  /** Signals nobody has reviewed. Shown because reviewing them is the only
   *  thing on this page that is somebody's job, and because they count for
   *  nothing until somebody does. */
  awaitingReview: number;
  /**
   * When the lead was recorded, ISO-8601 UTC as `Date.toISOString()` writes
   * it. Read ONLY by the order below, never rendered. Fixed-width, so a string
   * comparison is a chronological one.
   */
  createdAt: string;
};

export function SalesLeadRow({ lead }: { lead: SalesLeadRowLead }) {
  /* Null when the lead has none of them, so a hand-typed lead grows no empty
     line. Built by the same module the lead page reads, not assembled here. */
  const registry = registrySummaryLine({
    licenceNumber: lead.licenceNumber,
    city: lead.city,
    listedByGc: lead.listedByGc,
    registrationNumber: null,
    listedOnProject: null,
    phone: null,
  });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/sales/${lead.id}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-ink">{lead.companyName}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${BAND_STYLE[lead.band]}`}
              >
                {BAND_LABELS[lead.band]}
              </span>
              {lead.awaitingReview > 0 && (
                <span className="rounded-full bg-tag-amber px-2 py-0.5 text-xs text-tag-amber-ink">
                  {lead.awaitingReview} to check
                </span>
              )}
              {lead.source && (
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-ink-body">
                  {SALES_LEAD_SOURCE_OPTIONS.find(
                    (o) => o.value === lead.source,
                  )?.label ?? lead.source}
                </span>
              )}
            </div>
            <p className="text-sm text-ink-body">
              {[lead.contactName, lead.email, lead.phone]
                .filter(Boolean)
                .join(" · ") || "No contact info"}
            </p>
            {registry && (
              <p className="text-xs text-ink-muted">{registry}</p>
            )}
            {/* The reason, not the band. On a STRONG lead this IS the opening
                line; on a thin one it names the half that is missing. */}
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {lead.bandReason}
            </p>
          </div>
        </Link>
        <div className="shrink-0 text-right text-sm text-ink-body">
          <p>
            {lead.opportunityCount}{" "}
            {lead.opportunityCount === 1 ? "opportunity" : "opportunities"}
          </p>
          <p className="text-xs text-ink-muted">{lastContactLabel(lead)}</p>
          {lead.followUpStanding && (
            <p className={`text-xs ${FOLLOW_UP_STYLE[lead.followUpStanding]}`}>
              {FOLLOW_UP_LABEL[lead.followUpStanding]} {lead.followUpOn}
            </p>
          )}
        </div>
      </div>

      {/* Issue #152 in the shared component rather than by hand. This
          cluster has no ordinary action beside the delete, so #183 found
          nothing to hide here — but the arming state was still its own,
          which is the mechanism the census scans for. It is LEFT-ALIGNED
          (a plain flex row, nothing pinning it right), so the FIRST slot is
          the stable one and the default `pinned` order puts Cancel first,
          on the pixel Delete vacated. */}
      <RowActions
        className="flex items-center gap-2"
        destructive={
          <ConfirmDelete
            describe="Deletes the lead. Its deals and activity have to be removed first, so this refuses while any are left."
            prompt={`Delete ${lead.companyName}?`}
            pendingLabel="Deleting…"
            pending={isPending}
            onConfirm={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const result = await deleteSalesLead(lead.id);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                } catch {
                  setError("Could not delete the lead");
                }
              });
            }}
            deleteClassName={btn}
            cancelClassName={btn}
          />
        }
      />

      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}

/**
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

/**
 * The list, under a heading per band.
 *
 * An order nobody can see reads as no order at all, so each band says its own
 * name and how many leads are under it. The heading carries the band's WORD as
 * well as its colour — CLAUDE.md's rule that a status is a word and a colour,
 * never a colour — and it is the same `BAND_STYLE`/`BAND_LABELS` pair the rows
 * use, so a band cannot be one colour in a heading and another in a pill.
 *
 * ONLY NON-EMPTY BANDS GET A HEADING. A "Call this one — 0 leads" row is noise
 * on the one screen where that sentence is the whole point, and `/sales` is
 * asserted in a real browser (`e2e/specs/sales-crm.spec.ts` step 3) to contain
 * NO occurrence of the strongest band's label while no lead has earned it.
 *
 * The heading never isolates the label in its own element, so a locator for the
 * bare label still resolves to row pills only.
 */
export function SalesLeadList({
  leads,
}: {
  leads: readonly (SalesLeadRowLead & CallOrderLead)[];
}) {
  return (
    <div className="mb-4 flex flex-col gap-5">
      {groupForCalling(leads).map((group) => (
        <section key={group.band}>
          <h2
            className={`mb-2 inline-flex items-baseline gap-2 rounded-full px-3 py-1 text-xs font-medium ${BAND_STYLE[group.band]}`}
          >
            {BAND_LABELS[group.band]}
            {/* An explicit space: `gap-2` separates the two in PIXELS, but a
                flex gap is not text, so without this every reader that works
                off text — a screen reader, `innerText`, a Playwright locator —
                sees "Call this one1 lead" run together. Whitespace-only text
                between flex items is not laid out, so it costs nothing on
                screen. */}
            {" "}
            <span>
              {group.leads.length}{" "}
              {group.leads.length === 1 ? "lead" : "leads"}
            </span>
          </h2>
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {group.leads.map((lead) => (
              <SalesLeadRow key={lead.id} lead={lead} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
