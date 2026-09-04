/**
 * Which tables a test-job cleanup is allowed to touch, and how it notices
 * when it has fallen behind the schema.
 *
 * Pure: no Prisma, no network, no argv. Everything here takes its inputs as
 * arguments so the decisions that matter — what gets deleted, and when to
 * refuse — can be tested without a database, which is the only way anyone
 * is going to exercise a delete path on purpose.
 *
 * THE PROBLEM THIS SOLVES. 33 models carry a `jobId` today and the number
 * only goes up. A cleanup script with a hand-written delete list silently
 * stops being complete the moment somebody adds the 34th: the delete either
 * fails on a foreign key, or — worse, and this is what happened to the seed
 * undo — half-succeeds and leaves rows pointing at nothing.
 *
 * So this file does NOT try to keep a complete list. It keeps a SMALL one,
 * and the runner refuses outright when it finds rows anywhere outside it.
 * Falling behind then produces a refusal naming the table, which is a
 * five-minute fix, instead of a partial delete nobody notices.
 *
 * WHY NOT WALK THE RELATION GRAPH. Because reachable-from-Job is not the
 * same as owned-by-Job, and the difference is expensive. Walking relations
 * out of Job reaches Equipment (via EquipmentAssignment),
 * CompanyUnionAgreement, ComplianceDocument and NotificationDispatch —
 * company-level records that a test job merely referenced. A cascade would
 * delete the company's equipment because a scratch job once had it on site.
 * Job and ChangeOrder also reference each other, so there is no clean
 * topological order to walk even if ownership were not a problem.
 */

/**
 * Job-owned rows the cleanup deletes, deepest first.
 *
 * Order is by foreign key, not alphabet: a child appears before its parent
 * or the delete fails. CostEntry before JobLineItem, InvoiceLineItem and
 * Payment before Invoice.
 *
 * Counters are in here because they are per-job bookkeeping — a counter row
 * for a job that no longer exists is nothing but a leak. They are also the
 * one kind of row that MUST go with the job: sequence numbers come from a
 * counter that only increments, so a stale one would keep issuing numbers
 * for a job nobody can see.
 */
export const HANDLED_MODELS = [
  "CostEntry",
  "InvoiceLineItem",
  "Payment",
  "Invoice",
  "RetainageRelease",
  "TimeEntry",
  "JobAssignment",
  "EquipmentAssignment",
  "EstimateVersion",
  "JobLineItem",
  "RfiCounter",
  "SubmittalCounter",
  "MaterialOrderCounter",
  "ChangeOrderCounter",
  "BackchargeCounter",
  "CloseoutSubmissionCounter",
];

/**
 * Rows this refuses to delete even though they carry a jobId, so that
 * finding one stops the run rather than quietly destroying it.
 *
 * Every one of these is an EVIDENCE record or a company-level record that a
 * job merely points at, and this repo's rule is that evidence closes but
 * never deletes. A safety incident is an OSHA record. A contract document
 * and a signature request are what somebody signed. An outbound message is
 * correspondence that was actually sent.
 *
 * A job created by browser testing should have none of these. If one turns
 * up, the honest outcome is a human looking at it — not a script deciding
 * that a scratch-looking name makes an OSHA record disposable.
 */
export const NEVER_DELETE = [
  "SafetyIncident",
  "ContractDocument",
  "SignatureRequest",
  "ComplianceDocument",
  "OutboundMessage",
];

/** Prisma's delegate for a model name: the name with a lowercase first
 * letter. `QuickBooksEntityLink` -> `quickBooksEntityLink`. */
export function delegateName(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Tables holding rows for these jobs that the cleanup will not touch.
 *
 * `counts` is every model carrying a jobId, mapped to how many rows it has
 * for the jobs in question — including the zeros, which is the point: a
 * model this file has never heard of contributes nothing to the answer
 * while it is empty, and stops the run the moment it is not.
 *
 * Returns the blockers sorted, each with why it is one, so the refusal can
 * name tables instead of saying the run is unsafe.
 */
export function blockingTables(counts, handled = HANDLED_MODELS, never = NEVER_DELETE) {
  const known = new Set(handled);
  const protectedSet = new Set(never);
  return Object.entries(counts)
    .filter(([model, n]) => n > 0 && !known.has(model))
    .map(([model, n]) => ({
      model,
      rows: n,
      reason: protectedSet.has(model)
        ? "evidence or company-level — never deleted by a cleanup"
        : "not in this script's delete order; it may have been added since",
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

/**
 * Job names to act on, read from argv.
 *
 * EXACT names only, never a prefix or a substring. `contains: "test"` is
 * how a cleanup script eats a real job called "Westfield Retest", and the
 * blast radius of this script is decided entirely by this function.
 */
export function jobNamesFrom(argv, fallback = []) {
  const names = argv.filter((a) => !a.startsWith("--"));
  return names.length > 0 ? names : [...fallback];
}
