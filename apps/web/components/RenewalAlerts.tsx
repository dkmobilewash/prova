import Link from "next/link";
import {
  renewalCoverage,
  renewalCoverageMessage,
  renewalTiming,
  summarizeRenewals,
  type Renewal,
} from "@/lib/compliance-expiry";

/**
 * What is about to lapse, rendered where someone will actually see it.
 *
 * A server component with no interactivity on purpose — this is a list of
 * things to go and do, and every one of them is done on the page it links
 * to. Nothing here is dismissible either: an alert you can clear without
 * fixing the record is worse than no alert, because it makes an empty list
 * mean two different things.
 */

const KIND_LABELS: Record<Renewal["kind"], string> = {
  COMPLIANCE_DOCUMENT: "Insurance certificate",
  LICENSE: "Licence",
  INSURANCE_POLICY: "Policy",
  BOND: "Bond",
  // Not fed into this list yet (see /contacts/[id] for where these render
  // today) — added so this Record stays exhaustive over RenewalKind.
  MSA: "MSA",
  PREQUALIFICATION: "Prequalification",
};

function toneFor(renewal: Renewal) {
  if (renewal.urgency === "EXPIRED") return "border-rose-300 bg-tag-rose text-tag-rose-ink";
  if (renewal.urgency === "DUE_SOON") return "border-amber-700 bg-tag-amber text-tag-amber-ink";
  return "border-line-card bg-surface text-ink-label";
}

export function RenewalAlerts({
  renewals,
  trackedCount,
  limit,
  heading = "Renewals",
}: {
  renewals: Renewal[];
  /**
   * How many records that CAN lapse exist at all — the length of what
   * `renewalSourcesForCompany` returned, before `renewalAlerts` dropped
   * the current ones.
   *
   * Without it this component cannot tell "everything on file is current"
   * from "nothing is on file", and it said the first for both. On
   * /compliance that put "Certificates, licences, policies and bonds are
   * all current." about forty pixels above "No compliance documents yet."
   * The whole system reads existing rows, so a company that never filed a
   * COI is structurally indistinguishable from a compliant one — the only
   * honest thing to do is say which of the two it is looking at.
   *
   * Required, not optional. A default would have to be a number, and every
   * number is a claim.
   */
  trackedCount: number;
  /** Show only the worst few, with a count of the rest. Used on the
   * dashboard, where this is a prompt to go and look, not the list itself. */
  limit?: number;
  heading?: string;
}) {
  const coverage = renewalCoverage(renewals, trackedCount);

  if (coverage !== "HAS_ALERTS") {
    return (
      <section className="rounded-lg border border-line-card bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-label">{heading}</h2>
        <p
          className={`mt-1 text-sm ${coverage === "NOTHING_TRACKED" ? "text-tag-amber-ink" : "text-ink-body"}`}
        >
          {renewalCoverageMessage(coverage, trackedCount)}
        </p>
      </section>
    );
  }

  const counts = summarizeRenewals(renewals);
  const shown = limit ? renewals.slice(0, limit) : renewals;

  return (
    <section className="rounded-lg border border-line-card bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-label">{heading}</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {counts.expired > 0 && (
            <span className="rounded-full border border-rose-300 bg-tag-rose px-2 py-0.5 text-tag-rose-ink">
              {counts.expired} expired
            </span>
          )}
          {counts.dueSoon > 0 && (
            <span className="rounded-full border border-amber-700 bg-tag-amber px-2 py-0.5 text-tag-amber-ink">
              {counts.dueSoon} due soon
            </span>
          )}
          {counts.undated > 0 && (
            <span className="rounded-full border border-neutral-400 bg-neutral-800 px-2 py-0.5 text-ink-label">
              {counts.undated} with no date
            </span>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((renewal) => (
          <li
            key={`${renewal.kind}-${renewal.id}`}
            className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2 ${toneFor(renewal)}`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {renewal.title}
                {renewal.detail && <span className="font-normal opacity-80"> — {renewal.detail}</span>}
              </p>
              <p className="text-xs opacity-80">
                {KIND_LABELS[renewal.kind]} · {renewalTiming(renewal)}
                {renewal.date && ` · ${renewal.date}`}
              </p>
              {/* Neither fact is corrected automatically. A person entered
                  both and which one is stale isn't knowable from here. */}
              {renewal.disagreement && (
                <p className="mt-0.5 text-xs text-tag-amber-ink">
                  {renewal.disagreement} Check which is right.
                </p>
              )}
            </div>
            <Link href={renewal.href} className="shrink-0 text-xs underline hover:no-underline">
              Open
            </Link>
          </li>
        ))}
      </ul>

      {limit && renewals.length > shown.length && (
        <p className="mt-2 text-xs text-ink-body">
          and {renewals.length - shown.length} more —{" "}
          <Link href="/compliance" className="underline hover:no-underline">
            see all renewals
          </Link>
        </p>
      )}
    </section>
  );
}
