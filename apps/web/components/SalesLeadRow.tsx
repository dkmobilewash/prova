"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesLead } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SALES_LEAD_SOURCE_OPTIONS } from "@/components/SalesLeadFields";
import { BAND_LABELS, type FitBand } from "@/lib/sales-qualification";
import {
  type CallOrderLead,
  groupForCalling,
} from "@/lib/sales-lead-order";
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
