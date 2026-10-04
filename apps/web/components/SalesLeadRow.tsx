"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesLead } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SALES_LEAD_SOURCE_OPTIONS } from "@/components/SalesLeadFields";
import { BAND_LABELS, type FitBand } from "@/lib/sales-qualification";

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

export function SalesLeadRow({
  lead,
}: {
  lead: {
    id: string;
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    source: string | null;
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
  };
}) {
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
