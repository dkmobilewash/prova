/**
 * Small pure helpers for the bid-creation stepper. Kept here and tested
 * here rather than written inline in a server component — two copies of
 * the same arithmetic is exactly the "written twice, drifts silently"
 * shape CLAUDE.md's traps describe elsewhere in this app.
 *
 * Both were shared by two pages until the stepper's "Review" step was
 * removed (see `components/BidWizardSteps.tsx`); `/jobs/new/[jobId]/items`
 * is now the only caller. They stay here rather than folding back inline:
 * a pure function with its own test is what makes `hasLeftWizard`'s rule
 * checkable at all, and one caller is not a reason to give that up.
 */

/**
 * A job that has left ESTIMATE has left the wizard too — through the last
 * step's "Done" link into full management, or straight off the job page
 * itself (a change order, a status change, anything). The stepper page
 * redirects to `/jobs/[id]` rather than rendering a step for adding
 * pre-contract line items to a job that is no longer pre-contract.
 *
 * This is also what makes a refresh, or an old bookmark, safe: nothing
 * about "did I lose progress" depends on client state, because there is
 * none — the job row IS the progress, written the moment step 1 submits.
 * A stepper step either renders the job as it stands right now, or hands
 * off to wherever the job actually moved on to. It can never show stale
 * fields, because it never held any client-side draft to go stale.
 *
 * Still a string rather than `JobStatusValue`: the caller has a Prisma
 * enum in hand and this file deliberately imports nothing.
 */
export function hasLeftWizard(jobStatus: string): boolean {
  return jobStatus !== "ESTIMATE";
}

/**
 * Same arithmetic as `moneyRail.ts`'s `contractValue` — quantity × unit
 * price, treating a null (cost-only) price as $0 — kept here rather than
 * imported from there because that version is scoped to a dashboard
 * aggregate across many jobs, and this is one job's own running total
 * while it is still being built. Both read the same two JobLineItem
 * fields the same way on purpose; if one changes, the other should be
 * looked at.
 *
 * Takes plain numbers, same convention `wip.ts`'s `WipLineItemInput` uses
 * and for the same reason: `JobLineItem.quantity`/`unitPrice` are Prisma
 * `Decimal`, and converting at the call site (`Number(item.quantity)`)
 * keeps this file free of a Prisma import for two multiplications.
 */
export function bidWizardTotal(lineItems: { quantity: number; unitPrice: number | null }[]): number {
  return lineItems.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0);
}
