/**
 * Small pure helpers shared by the two bid-creation-stepper pages that need
 * them (`/jobs/new/[jobId]/items` and `/jobs/new/[jobId]/review`). Kept
 * here and tested here rather than duplicated inline in both server
 * components — two copies of the same arithmetic is exactly the "written
 * twice, drifts silently" shape CLAUDE.md's traps describe elsewhere in
 * this app, and this file is small enough that there is no excuse for it.
 */

/**
 * A job that has left ESTIMATE has left the wizard too — through the
 * review step's "Finish" link into full management, or straight off the
 * job page itself (a change order, a status change, anything). Both
 * stepper pages redirect to `/jobs/[id]` rather than rendering a step for
 * adding pre-contract line items to a job that is no longer pre-contract.
 *
 * This is also what makes a refresh, or an old bookmark, safe: nothing
 * about "did I lose progress" depends on client state, because there is
 * none — the job row IS the progress, written the moment step 1 submits.
 * A stepper step either renders the job as it stands right now, or hands
 * off to wherever the job actually moved on to. It can never show stale
 * fields, because it never held any client-side draft to go stale.
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
