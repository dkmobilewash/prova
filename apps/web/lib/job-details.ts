import type { JobStatus } from "@prova/db";

/**
 * Correcting an estimate, and deciding when one may be removed.
 *
 * Pure: no Prisma, no React, no `requireCompanyContext`. The action in
 * `lib/actions/jobs.ts` reads a form and counts rows; every judgement about
 * what those numbers MEAN lives here, where it can be tested exhaustively
 * without a database.
 *
 * TWO GAPS THIS EXISTS FOR, both found by using the product rather than
 * reading it.
 *
 * A job's name, client and scope could not be changed at all. `jobs.ts` has
 * `updateLineItem`, `updateLineItemForecast` and `updateJobSchedule` and
 * nothing that touches the job's own identity — so a name typed wrong at
 * creation was permanent on every job in the system, and the only remedy
 * was a database script.
 *
 * And a job could not be removed by any means at all. That is RIGHT for a
 * job that has been worked — CLAUDE.md's evidence-record rule, and the
 * per-job invoice counter makes it sharper than a principle: delete a job
 * and its invoices, and a later invoice can reuse a number a GC has already
 * been sent. It is plainly WRONG for an estimate created by accident thirty
 * seconds ago, which is what a person actually does on their first day.
 *
 * So the line is drawn at evidence, not at age or intent: a job that has
 * been SENT, BILLED or WORKED is history. One that has not is a draft, and
 * a person may fix or discard their own draft.
 */

export type JobDetails = {
  name: string;
  scope: string | null;
  contactId: string;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function jobDetailsFromForm(formData: FormData): Parsed<JobDetails> {
  const name = String(formData.get("name") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim();

  if (!name) {
    return { ok: false, error: "A job needs a name — it prints on every pay application you send." };
  }
  if (!contactId) {
    return { ok: false, error: "A job needs a client." };
  }

  // An emptied scope is null rather than "". A job with no scope and a job
  // whose scope is the empty string are the same job, and storing two
  // spellings of the same fact is how a filter starts missing rows.
  return { ok: true, value: { name, scope: scope || null, contactId } };
}

/**
 * The CLIENT may only change while the job is an estimate.
 *
 * The name and the scope are descriptions and stay correctable forever — a
 * typo on a contracted job is still a typo. Who the job is FOR is not a
 * description: once contracted, it is who signed, who is invoiced, who
 * holds the retainage and who the pay applications were sent to. Changing
 * it afterwards does not correct a record, it rewrites one.
 *
 * Written as an explicit allow-list of one rather than `status !==
 * "ESTIMATE"`, so a new JobStatus added later cannot quietly inherit
 * permission — the test enumerates every other status for the same reason.
 */
export function mayChangeClient(status: JobStatus): boolean {
  return status === "ESTIMATE";
}

/**
 * Everything hanging off a Job that means somebody has WORKED it.
 *
 * `lineItems` is deliberately absent: an estimate always has line items and
 * they ARE the estimate, not evidence that anything happened to it. The
 * rest of the estimate's working papers — the takeoff, the bid recap, the
 * proposal text — are `JOB_DRAFT_CHILDREN` below, and go with it. Every
 * table that would block a job delete is in exactly one of the two lists,
 * and `jobRemoval.test.ts` derives that set from the migration SQL rather
 * than from this comment. This comment used to say "every other relation on
 * the model is here", and it stopped being true without anybody noticing:
 * on 19 Oct 2026 a saved bid recap or an uploaded takeoff plan made "Remove
 * it" throw a foreign-key error instead of removing the estimate.
 *
 * `table` is the SQL table, so the census can match the two. `single` marks
 * a one-to-one relation, which Prisma's `_count` cannot count;
 * `throughLineItems` marks a grandchild reached through the job's line
 * items, which `_count` cannot reach either. The safe default for "is this
 * record load-bearing" is still yes.
 *
 * `singular`/`plural` are spelled out rather than derived by adding an "s":
 * this list has to produce "1 RFI"/"2 RFIs" and "1 daily field report"/"2
 * daily field reports", and a derivation that works for most of them would
 * be wrong in exactly the cases a person notices.
 */
export type HistoryRelation = {
  key: string;
  table: string;
  singular: string;
  plural: string;
  single?: true;
  throughLineItems?: true;
};

export const JOB_HISTORY_RELATIONS: readonly HistoryRelation[] = [
  { key: "invoices", table: "Invoice", singular: "invoice", plural: "invoices" },
  { key: "timeEntries", table: "TimeEntry", singular: "logged time entry", plural: "logged time entries" },
  { key: "changeOrders", table: "ChangeOrder", singular: "change order", plural: "change orders" },
  { key: "rfis", table: "Rfi", singular: "RFI", plural: "RFIs" },
  { key: "submittals", table: "Submittal", singular: "submittal", plural: "submittals" },
  { key: "punchListItems", table: "PunchListItem", singular: "punch list item", plural: "punch list items" },
  {
    key: "dailyFieldReports",
    table: "DailyFieldReport",
    singular: "daily field report",
    plural: "daily field reports",
  },
  { key: "safetyIncidents", table: "SafetyIncident", singular: "safety incident", plural: "safety incidents" },
  { key: "materialOrders", table: "MaterialOrder", singular: "material order", plural: "material orders" },
  // A PO went (or was drafted to go) to a supplier — same footing as a
  // material order. Added when #881's purchase orders met estimate removal.
  { key: "purchaseOrders", table: "PurchaseOrder", singular: "purchase order", plural: "purchase orders" },
  {
    key: "retainageReleases",
    table: "RetainageRelease",
    singular: "retainage release",
    plural: "retainage releases",
  },
  {
    key: "signatureRequests",
    table: "SignatureRequest",
    singular: "signature request",
    plural: "signature requests",
  },
  {
    key: "contractDocuments",
    table: "ContractDocument",
    singular: "contract document",
    plural: "contract documents",
  },
  {
    key: "estimateVersions",
    table: "EstimateVersion",
    singular: "saved estimate version",
    plural: "saved estimate versions",
  },
  { key: "drawingSets", table: "DrawingSet", singular: "drawing set", plural: "drawing sets" },
  { key: "media", table: "JobMedia", singular: "site photo", plural: "site photos" },
  { key: "toolboxTalks", table: "ToolboxTalk", singular: "toolbox talk", plural: "toolbox talks" },
  { key: "dispatchSlips", table: "DispatchSlip", singular: "dispatch slip", plural: "dispatch slips" },
  {
    key: "prevailingWageDeterminations",
    table: "PrevailingWageDetermination",
    singular: "prevailing wage determination",
    plural: "prevailing wage determinations",
  },
  {
    key: "complianceDocuments",
    table: "ComplianceDocument",
    singular: "compliance document",
    plural: "compliance documents",
  },
  // Added 2026-10-25. Each of these was a RESTRICT child of Job this list
  // did not name, so a job holding one passed the check and then died on
  // Postgres's refusal — thrown, and redacted to "This page didn't load".
  // Every one is a record somebody entered about real work or real
  // correspondence, so it holds the job rather than going with it.
  { key: "backcharges", table: "Backcharge", singular: "backcharge", plural: "backcharges" },
  { key: "closeoutItems", table: "CloseoutItem", singular: "closeout item", plural: "closeout items" },
  {
    key: "closeoutSubmissions",
    table: "CloseoutSubmission",
    singular: "closeout submission",
    plural: "closeout submissions",
  },
  { key: "das140Notices", table: "Das140Notice", singular: "DAS 140 notice", plural: "DAS 140 notices" },
  { key: "das142Requests", table: "Das142Request", singular: "DAS 142 request", plural: "DAS 142 requests" },
  { key: "delayEvents", table: "DelayEvent", singular: "delay event", plural: "delay events" },
  {
    key: "docuSignEnvelopes",
    table: "DocuSignEnvelope",
    singular: "DocuSign envelope",
    plural: "DocuSign envelopes",
  },
  {
    key: "equipmentAssignments",
    table: "EquipmentAssignment",
    singular: "equipment assignment",
    plural: "equipment assignments",
  },
  { key: "lienDeadlines", table: "LienDeadline", singular: "lien deadline", plural: "lien deadlines" },
  { key: "lienWaivers", table: "LienWaiver", singular: "lien waiver", plural: "lien waivers" },
  {
    key: "timesheetSignoffs",
    table: "TimesheetSignoff",
    singular: "timesheet sign-off",
    plural: "timesheet sign-offs",
  },
  { key: "tmTickets", table: "TmTicket", singular: "T&M ticket", plural: "T&M tickets" },
  {
    key: "warrantyPeriod",
    table: "WarrantyPeriod",
    singular: "warranty period",
    plural: "warranty periods",
    single: true,
  },
  {
    key: "warrantyServiceRequests",
    table: "WarrantyServiceRequest",
    singular: "warranty service request",
    plural: "warranty service requests",
  },
  {
    key: "wh347PayrollNumbers",
    table: "Wh347PayrollNumber",
    singular: "WH-347 payroll number",
    plural: "WH-347 payroll numbers",
  },
  { key: "wh347Statements", table: "Wh347Statement", singular: "WH-347 statement", plural: "WH-347 statements" },
  // SET NULL rather than RESTRICT, so it never blocked the delete — it would
  // have silently detached a message somebody SENT from the job it was
  // about. Sent correspondence is the evidence-record rule's first example,
  // so it holds the job the way an RFI does.
  { key: "outboundMessages", table: "OutboundMessage", singular: "sent message", plural: "sent messages" },
  // A cost recorded against one of the estimate's own line items. Not a
  // relation of Job, so `_count` cannot see it and the action counts it
  // through the line items. Without it, the line-item delete would hit
  // `CostEntry_lineItemId_fkey` exactly the way the takeoff plan did.
  {
    key: "costEntries",
    table: "CostEntry",
    singular: "recorded cost",
    plural: "recorded costs",
    throughLineItems: true,
  },
];

/**
 * What goes WITH an estimate when it is removed: its own working papers,
 * deleted in the same transaction as the job.
 *
 * The same line `JOB_HISTORY_RELATIONS` draws, from the other side. A
 * takeoff plan, the items measured on it, the wall runs, the bid recap's
 * rates, the proposal's clause text, who is assigned and the crew days
 * pencilled in — none of it was sent, billed or worked. It is how the number
 * was built, and it means nothing once the estimate it built is gone.
 * Refusing to remove a job because somebody saved its markups is the bug
 * this list exists for.
 *
 * The per-job COUNTERS are here as well, and that is CLAUDE.md's rule
 * rather than a judgement: "per-job counters go with their job". A counter
 * can only have issued a number to a record that is itself in the history
 * list, and the job is refused while any of those exist.
 *
 * `model` is the Prisma delegate, `table` the SQL table for the census.
 * `jobLineItem` is LAST because the takeoff items it may point at are SET
 * NULL, so it can safely follow them; nothing else here references anything
 * else here.
 */
export const JOB_DRAFT_CHILDREN = [
  { model: "jobProposalClause", table: "JobProposalClause" },
  { model: "jobBidRecap", table: "JobBidRecap" },
  { model: "wallRun", table: "WallRun" },
  { model: "takeoffPlan", table: "TakeoffPlan" },
  { model: "takeoffItem", table: "TakeoffItem" },
  { model: "crewScheduleDay", table: "CrewScheduleDay" },
  { model: "jobAssignment", table: "JobAssignment" },
  { model: "changeOrderCounter", table: "ChangeOrderCounter" },
  { model: "invoiceCounter", table: "InvoiceCounter" },
  { model: "rfiCounter", table: "RfiCounter" },
  { model: "submittalCounter", table: "SubmittalCounter" },
  { model: "materialOrderCounter", table: "MaterialOrderCounter" },
  { model: "estimateVersionCounter", table: "EstimateVersionCounter" },
  { model: "contractDocumentVersionCounter", table: "ContractDocumentVersionCounter" },
  { model: "backchargeCounter", table: "BackchargeCounter" },
  { model: "closeoutSubmissionCounter", table: "CloseoutSubmissionCounter" },
  { model: "wh347PayrollCounter", table: "Wh347PayrollCounter" },
  { model: "purchaseOrderCounter", table: "PurchaseOrderCounter" },
  { model: "jobLineItem", table: "JobLineItem" },
] as const;

export type JobHistoryCounts = Record<string, number>;

/**
 * The non-zero kinds, in the order above, as readable phrases.
 *
 * ONLY the non-zero ones. "This job has 0 invoices and 3 logged time
 * entries on file" is the shape of refusal message this repo has already
 * had to fix once, on `deleteSalesLead`.
 */
export function describeJobHistory(counts: JobHistoryCounts): string[] {
  const held: string[] = [];
  for (const relation of JOB_HISTORY_RELATIONS) {
    const n = counts[relation.key] ?? 0;
    if (n > 0) held.push(`${n} ${n === 1 ? relation.singular : relation.plural}`);
  }
  return held;
}
