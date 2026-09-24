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
 *
 * `InvoiceCounter` joined them on 2026-09-09, with #224 — invoice numbers
 * were the last sequence still coming from `max(number) + 1`. Neither
 * cleanup script knew about it, so a scratch job that had been invoiced
 * could not be deleted at all.
 *
 * THE LIST IS NOT WHAT KEPT THAT SAFE; THE LIST IS WHAT FELL BEHIND. Two
 * other things were supposed to catch it, and exactly one did.
 * `clean-test-jobs.mjs` counts every model carrying a jobId from the DMMF at
 * runtime and refuses on anything outside this list, so it would have
 * stopped with the table named — that one worked. The test that was meant
 * to catch it BEFORE anyone ran a script did not: it derives the blocking
 * foreign keys by pattern-matching the migrations, and #224's migration
 * wrapped its `ALTER TABLE` across two lines where every generated one is
 * a single line, so the pattern skipped it and all thirteen tests passed.
 * See `apps/web/lib/scratch-cleanup-order.test.ts`.
 *
 * So: a hand-maintained list is only safe while something else is checking
 * it, and a checker is only safe while something is checking THE CHECKER.
 */
export const HANDLED_MODELS = [
  "CostEntry",
  "InvoiceLineItem",
  "Payment",
  "Invoice",
  // Keyed on jobId, not reached by deleting the invoices, and RESTRICT on
  // Job — so it blocks the job delete however clean the invoices are.
  "InvoiceCounter",
  "RetainageRelease",
  // Before TimeEntry, and not only for foreign-key reasons: while a live
  // sign-off exists, the TimeEntry day-lock trigger refuses to delete that
  // day's hours. Sign-offs go first so the time entries can follow.
  "TimesheetSignoff",
  // After TimesheetSignoff for the same reason as TimeEntry: a live sign-off
  // makes the DelayEvent day-lock trigger refuse the delete.
  "DelayEvent",
  "TimeEntry",
  "TmTicket",
  // Planned days on the job. RESTRICT on Job, so a scratch job cannot be
  // deleted while its schedule exists — the #227 shape, and the reason this
  // name is here as well as in both scripts' del() order.
  "CrewScheduleDay",
  // Lien-rights deadlines. Required jobId, RESTRICT on Job — the #227 shape
  // again, so it is here AND in both scripts' del() order.
  "LienDeadline",
  // A job's link to a GC's Procore project, and (by cascade) the cached GC
  // records under it. CASCADE on Job, so it would not block the delete —
  // it is here because it belongs to the job and carries a jobId, which is
  // what clean-test-jobs.mjs counts. Deleting the link deletes nothing in
  // Procore and none of the sub's own records.
  "ProcoreProjectLink",
  // A job's link to a GC's Autodesk Construction Cloud project, and (by
  // cascade) the cached RFIs/submittals under it. Same shape as
  // ProcoreProjectLink for the same reason.
  "AccProjectLink",
  // A job's link to a CompanyCam project. CASCADE on Job, same shape as
  // ProcoreProjectLink — it would not block the delete, but it carries a
  // jobId, which is what clean-test-jobs.mjs counts. Deleting the link
  // deletes nothing in CompanyCam; the imported photos are ordinary
  // JobMedia rows, handled like every other photo.
  "CompanyCamProjectLink",
  // A job's link to a Bluebeam Studio Session. CASCADE on Job, same shape
  // as ProcoreProjectLink and CompanyCamProjectLink — it would not block
  // the delete, but it carries a jobId, which is what clean-test-jobs.mjs
  // counts. Deleting the link deletes nothing in Bluebeam; the Studio
  // Session itself is left exactly as it was.
  "BluebeamStudioSession",
  // An uploaded plan PDF somebody is measuring off. RESTRICT on Job, so
  // this one genuinely blocks the delete. Its pages, calibrations and
  // measurements are NOT listed here and do not need to be: they CASCADE
  // from this row, so deleting the plan reaches all of them, and none of
  // them carries a jobId for clean-test-jobs.mjs to count.
  "TakeoffPlan",
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
  // Keyed on jobId, not reached by deleting a job's contract documents, and
  // RESTRICT on Job -- same shape as InvoiceCounter (#227), which blocked
  // both cleanup scripts until it was added here. ContractDocument itself
  // stays in NEVER_DELETE below (it's the signed evidence); the counter
  // isn't evidence, it's just the number sequence, so it goes with the
  // other per-job counters instead.
  "ContractDocumentVersionCounter",
  // EstimateVersionCounter, the same shape again (#289): keyed on jobId,
  // RESTRICT on Job, and deleting the job's estimate versions does not
  // reach it.
  "EstimateVersionCounter",
  // Clauses on a job's bid proposal (proposals.prisma). Required jobId,
  // RESTRICT on Job — the #227 shape, so it is here AND in both scripts'
  // del() order. The company-scoped ProposalClause library is not: these
  // scripts never delete a company.
  "JobProposalClause",
  // A job's wall runs (wall-types.prisma). Required jobId, RESTRICT on Job —
  // the #227 shape, so it is here AND in both scripts' del() order. The
  // company-level WallType library is not: these scripts never delete a
  // company.
  "WallRun",
  // A job's bid recap (bid-recap.prisma). Keyed on jobId, RESTRICT on Job, and
  // deleting the job's line items does not reach it — the #227 shape, so it is
  // here AND in both scripts' del() order. CompanyBidDefaults is not: these
  // scripts never delete a company.
  "JobBidRecap",
  // WH-347 payroll numbers for a job's weeks, and the per-job counter that
  // issues them (#227 shape: jobId-keyed RESTRICT children of Job that no
  // other delete reaches). The numbers are a sequence record, not signed
  // evidence -- the signed thing is the printed form -- so they go with
  // their scratch job the way the other per-job counters do.
  "Wh347PayrollNumber",
  "Wh347PayrollCounter",
  // `DocumentIntake` does NOT block a Job delete: its `jobId` is optional,
  // so Postgres holds ON DELETE SET NULL and the delete would succeed
  // without this entry. It is in this list anyway, and the distinction is
  // worth stating because the two lists answer two different questions.
  // `scratch-cleanup-order.test.ts` asks "what would REFUSE the delete";
  // this list asks "what belongs to the job", and a scratch job's intake
  // rows belong to it whether or not the database would object.
  //
  // It is not the only non-blocker here, and an earlier draft of this
  // comment claimed it was the first — checked rather than asserted, and it
  // is wrong: deriving the RESTRICT/NO ACTION foreign keys that point at
  // `Job` out of the migration SQL and subtracting them from this list
  // leaves seven entries, `CostEntry`, `InvoiceLineItem`, `Payment`,
  // `SafetyIncident`, `ComplianceDocument` and `OutboundMessage` alongside
  // this one. So membership here has never meant "blocks a job delete", and
  // nobody should read it that way on the strength of a sentence in a
  // comment.
  // Leaving it out would not fail a delete — it would leave rows pointing at
  // no job in a tray somebody then demos, and `clean-test-jobs.mjs` would
  // refuse the whole run by name (`blockingTables`), which is the other way
  // this omission shows up.
  "DocumentIntake",
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
  // An envelope sent through DocuSign is correspondence that reached a GC's
  // inbox. It is voided at DocuSign, never deleted here.
  "DocuSignEnvelope",
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
