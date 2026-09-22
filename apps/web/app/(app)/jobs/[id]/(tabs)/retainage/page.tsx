import Link from "next/link";
import { prisma } from "@prova/db";
import { PageColumn } from "@prova/ui";
import { RowActions, ConfirmDelete } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { dateInputValue } from "@/lib/jobs/date-input";
import { calculateRetainageSummary } from "@/lib/retainage";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { money } from "@/lib/money";
import { updateJobRetainageTerms, createRetainageRelease, deleteRetainageRelease } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { PercentField } from "@/components/PercentField";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Retainage — its own tab, its own fixed slot in the old monolith's
 * ordering (CLAUDE.md: "Retainage → Field Reports → Pay Apps"). Withheld
 * on MANAGE_BILLING, same as Billing — a SOFT gate, same reasoning as
 * that tab's own doc comment: this tab's write actions are not
 * independently guarded on MANAGE_BILLING either, so a hard route wall
 * would claim a boundary the action layer does not enforce. Tracked in
 * issue #383 (Diego's lane) rather than fixed in a layout PR; the
 * issue's own detail is held privately since it names exactly what is
 * unguarded on a public repo.
 */
export default async function JobRetainagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal, job: jobRef } = await requireJob(id);
  const { showsBilling } = jobCapabilities(principal);
  if (!showsBilling) {
    return <p className="text-sm text-ink-muted">This tab isn&rsquo;t part of your access.</p>;
  }

  if (jobRef.status === "ESTIMATE") {
    return (
      <p className="text-sm text-ink-muted">
        This job is still an estimate — retainage tracking opens up once it&rsquo;s contracted.
      </p>
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    select: {
      id: true,
      retainagePercent: true,
      substantialCompletionDate: true,
      contact: { select: { defaultRetainagePercent: true } },
      // Read-only, for the percent field's money preview only. Same
      // arithmetic as calculateLineItemWip.contractValue and the dashboard's
      // jobValue — quantity x unitPrice over non-deleted lines — and it is
      // not stored, not written and not part of the retainage computation
      // another branch owns.
      lineItems: {
        where: { isDeleted: false },
        select: { quantity: true, unitPrice: true },
      },
      invoices: { select: { retainageWithheld: true } },
      retainageReleases: { orderBy: { releasedAt: "desc" } },
    },
  });
  if (!job) throw new Error("job disappeared between checks");

  const contractValue = job.lineItems.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice ?? 0),
    0,
  );

  const retainageSummary = calculateRetainageSummary({
    invoiceRetainageWithheld: job.invoices.map((invoice) => (invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null)),
    releaseAmounts: job.retainageReleases.map((release) => Number(release.amount)),
    substantialCompletionDate: job.substantialCompletionDate,
  });

  // Nothing withheld on any invoice and no release logged: the three
  // figures would all read $0.00 and "Log release" would offer to release
  // money nobody is holding. Said once, in words, with the way to change it.
  // Decided from the same summary the figures come from, so it cannot
  // disagree with them.
  const nothingYet = retainageSummary.totalWithheld === 0 && job.retainageReleases.length === 0;

  const timeZone = await viewerTimeZone();
  const updateJobRetainageTermsWithId = updateJobRetainageTerms.bind(null, job.id);
  const createRetainageReleaseWithId = createRetainageRelease.bind(null, job.id);
  const deleteRetainageReleaseWithId = (releaseId: string) => deleteRetainageRelease.bind(null, job.id, releaseId);

  return (
    <PageColumn width="reading">
    <section>
      <h2 className="mb-1 text-lg font-semibold text-ink">Retainage</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Each invoice keeps the retainage worked out when it was created, at the rate below. Changing the rate
        only affects invoices you create after the change.
      </p>

      <ActionForm action={updateJobRetainageTermsWithId} resetOnSuccess={false} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line-card bg-surface p-3">
        {/* A `%` that stays put and a live money preview — `0.10` typed
            meaning ten percent used to save as a tenth of one percent in
            total silence. See components/PercentField.tsx. */}
        <PercentField
          name="retainagePercent"
          label="Retainage"
          defaultValue={job.retainagePercent?.toString() ?? job.contact.defaultRetainagePercent?.toString() ?? ""}
          contractValue={contractValue}
        />
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Expected substantial completion
          <input
            type="date"
            name="substantialCompletionDate"
            defaultValue={dateInputValue(job.substantialCompletionDate)}
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          />
        </label>
        <SubmitButton type="submit" className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700">
          Save
        </SubmitButton>
      </ActionForm>

      {nothingYet ? (
        <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body" data-retainage-empty="">
          Nothing withheld yet. Retainage comes off each invoice you create on the{" "}
          <Link href={`/jobs/${job.id}/billing`} className="text-link hover:underline">
            Billing tab
          </Link>
          , at the rate above.
        </p>
      ) : (
      <>
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-line-card bg-surface p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-muted">Total withheld</p>
          <p className="text-ink">{money(retainageSummary.totalWithheld)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Total released</p>
          <p className="text-ink">{money(retainageSummary.totalReleased)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Outstanding balance</p>
          <p className={retainageSummary.balance > 0 ? "text-amber-400" : "text-green-400"}>{money(retainageSummary.balance)}</p>
        </div>
      </div>

      {retainageSummary.balance > 0 && retainageSummary.substantialCompletionDate && (
        <p className="mb-4 text-sm text-ink-body">
          Expected release: {money(retainageSummary.balance)} around{" "}
          {formatCalendarDate(retainageSummary.substantialCompletionDate)} (this job&rsquo;s expected substantial
          completion date) — a forecast based on the date set above, not a guarantee of when the GC will actually
          release it.
        </p>
      )}

      {job.retainageReleases.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {job.retainageReleases.map((release) => (
            <li key={release.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-card bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-ink">
                  {release.releasedAt.getTime() % 86_400_000 === 0
                    ? formatCalendarDate(release.releasedAt)
                    : formatInstant(release.releasedAt, timeZone)}
                </span>
                <span className="text-ink-label">{money(Number(release.amount))}</span>
                {release.note && <span className="text-xs text-ink-muted">— {release.note}</span>}
              </div>
              <RowActions
                className="flex shrink-0 flex-col items-end gap-1"
                destructive={
                  <ConfirmDelete
                    pinned="end"
                    action={deleteRetainageReleaseWithId(release.id)}
                    describe="Removes your record of the release. Nothing is requested of or withdrawn from the GC; retainage held goes back up by this amount."
                    label="Remove"
                    confirmLabel="Confirm remove"
                    armedClassName="flex flex-wrap items-center justify-end gap-2"
                    deleteClassName={rowDeleteClass}
                    cancelClassName={rowCancelClass}
                    confirmClassName={rowConfirmClass}
                    hint={
                      <span className="max-w-[16rem] text-right text-amber-300">
                        {money(Number(release.amount))} goes back into the outstanding retainage balance.
                      </span>
                    }
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={createRetainageReleaseWithId} className="flex flex-wrap items-end gap-2 rounded-lg border border-line-card bg-surface p-3">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Amount released
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="Amount"
            required
            className="w-28 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Date
          <input
            type="date"
            name="releasedAt"
            className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
          />
        </label>
        <input
          name="note"
          placeholder="Note (optional)"
          className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <SubmitButton type="submit" className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700">
          Log release
        </SubmitButton>
      </ActionForm>
      </>
      )}
    </section>
    </PageColumn>
  );
}
