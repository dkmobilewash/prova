"use client";

import { useState } from "react";

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { linkBidToJob } from "@/lib/actions";
import type { BidOutcome } from "@/lib/bid-outcome";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";

/**
 * The link between a bid and the job that is the same piece of work, and what
 * the comparison says once that job is finished.
 *
 * ── THE LINK IS NOT ONLY FOR A WON BID, AND SAYING SO IS THE FIX ──
 *
 * It reads "became" nowhere now. A bid is linked to a job so that a carried
 * quote can reach that job's estimate and an addendum can be checked against
 * its takeoff — both of which happen while the bid is still out. `linkBidToJob`
 * stopped requiring WON in #619 and the page kept rendering this behind
 * `bid.status === "WON"`, so the capability existed and could not be reached.
 *
 * THE COMPARISON STAYS WON-ONLY, and that is a different question from the
 * link. `outcome` is null until `loadBidOutcomes` has one, which it only does
 * for a WON bid — a lost bid costed against its own unbuilt job is exactly the
 * "real-looking number that will be remembered and repeated" that
 * `bid-outcome.ts` refuses. So a linked-but-not-won bid shows the link and says
 * plainly that the comparison comes later, rather than showing a blank.
 *
 * THE VERDICT AND THE REFUSAL COME FROM THE SAME PLACE. `bidOutcome` decides
 * whether there is anything to say; this renders either its sentence or its
 * reason, never a number of its own. A screen that computed its own variance
 * would eventually disagree with the one the estimator is told, and the point
 * of the feature is that the figure can be trusted.
 */
export function BidJobLink({
  bidInvitationId,
  linked,
  jobs,
  sentence,
}: {
  bidInvitationId: string;
  /** `outcome` is null until the bid is WON — see the header. */
  linked: { jobId: string; jobName: string; outcome: BidOutcome | null } | null;
  jobs: (JobOption & { claimedByBidId: string | null })[];
  /** Pre-rendered on the server by `settledSentence`, so the money format is
   * the app's own. Null for anything not settled. */
  sentence: string | null;
}) {
  const [picking, setPicking] = useState(false);

  if (linked) {
    const { outcome } = linked;
    return (
      <div className="mt-2 rounded-md border border-line-row bg-surface-card p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink-body">
            {/* "Became" was true only of a won bid and this control is no
                longer won-only. This wording is true the whole way through. */}
            This bid is for <span className="font-medium text-ink">{linked.jobName}</span>
          </p>
          <ActionForm action={linkBidToJob.bind(null, bidInvitationId)} className="shrink-0">
            {/* Unlinking is the same control with nothing picked — see the
                action's own comment. */}
            <input type="hidden" name="jobId" value="" />
            <SubmitButton
              type="submit"
              className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
            >
              Unlink
            </SubmitButton>
          </ActionForm>
        </div>

        {/* NO OUTCOME MEANS NOT WON YET, not "nothing to say". Saying which is
            the difference between a feature that looks broken and one that is
            waiting — and it never implies a figure, because there is not one
            to imply. */}
        {outcome === null ? (
          <p className="mt-1 text-xs text-ink-muted">
            Linked. What the job actually cost against what you bid appears here once this bid is marked won.
          </p>
        ) : (
          <>
            {sentence ? (
              <p
                className={`mt-1 text-sm font-medium ${
                  (outcome.costVsBid ?? 0) > 0 ? "text-tag-rose-ink" : "text-tag-emerald-ink"
                }`}
              >
                {sentence}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">{outcome.because}</p>
            )}

            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
          <div>
            <dt className="inline">Bid </dt>
            <dd className="inline text-ink-body">{outcome.bidAmount === null ? "—" : money(outcome.bidAmount)}</dd>
          </div>
          <div>
            <dt className="inline">Contract </dt>
            <dd className="inline text-ink-body">{money(outcome.contractValue)}</dd>
          </div>
          <div>
            {/* Labelled "to date" while the job runs, because that is what it
                is. The word changes with the state rather than the reader
                being expected to remember. */}
            <dt className="inline">{outcome.state === "SETTLED" ? "Final cost " : "Cost to date "}</dt>
            <dd className="inline text-ink-body">{money(outcome.actualCostToDate)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    );
  }

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="mt-2 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Link the job this bid is for
      </button>
    );
  }

  return (
    <ActionForm
      action={linkBidToJob.bind(null, bidInvitationId)}
      className="mt-2 flex flex-wrap items-end gap-2"
      onSuccess={() => setPicking(false)}
    >
      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Which job is this bid for?
        <select
          name="jobId"
          defaultValue=""
          className="w-64 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        >
          <option value="">Pick a job…</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id} disabled={job.claimedByBidId !== null}>
              {jobPickerLabel(job)}
              {job.claimedByBidId !== null ? " · already linked to another bid" : ""}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton
        type="submit"
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        Link
      </SubmitButton>
      <button
        type="button"
        onClick={() => setPicking(false)}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
      <p className="w-full text-xs text-ink-muted">
        Nothing picks this for you: project names rarely match the GC&rsquo;s wording, and a wrong link would put
        another job&rsquo;s costs against this bid.
      </p>
    </ActionForm>
  );
}

/** The app's money format, matching the server-rendered figures beside it. */
function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
