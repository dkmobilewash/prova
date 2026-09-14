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
 * they ARE the estimate, not evidence that anything happened to it. Every
 * other relation on the model is here, because the safe default for "is
 * this record load-bearing" is yes.
 *
 * `singular`/`plural` are spelled out rather than derived by adding an "s":
 * this list has to produce "1 RFI"/"2 RFIs" and "1 daily field report"/"2
 * daily field reports", and a derivation that works for most of them would
 * be wrong in exactly the cases a person notices.
 */
export const JOB_HISTORY_RELATIONS = [
  { key: "invoices", singular: "invoice", plural: "invoices" },
  { key: "timeEntries", singular: "logged time entry", plural: "logged time entries" },
  { key: "changeOrders", singular: "change order", plural: "change orders" },
  { key: "rfis", singular: "RFI", plural: "RFIs" },
  { key: "submittals", singular: "submittal", plural: "submittals" },
  { key: "punchListItems", singular: "punch list item", plural: "punch list items" },
  { key: "dailyFieldReports", singular: "daily field report", plural: "daily field reports" },
  { key: "safetyIncidents", singular: "safety incident", plural: "safety incidents" },
  { key: "materialOrders", singular: "material order", plural: "material orders" },
  { key: "retainageReleases", singular: "retainage release", plural: "retainage releases" },
  { key: "signatureRequests", singular: "signature request", plural: "signature requests" },
  { key: "contractDocuments", singular: "contract document", plural: "contract documents" },
  { key: "estimateVersions", singular: "saved estimate version", plural: "saved estimate versions" },
  { key: "drawingSets", singular: "drawing set", plural: "drawing sets" },
  { key: "media", singular: "site photo", plural: "site photos" },
  { key: "toolboxTalks", singular: "toolbox talk", plural: "toolbox talks" },
  { key: "dispatchSlips", singular: "dispatch slip", plural: "dispatch slips" },
  {
    key: "prevailingWageDeterminations",
    singular: "prevailing wage determination",
    plural: "prevailing wage determinations",
  },
  { key: "complianceDocuments", singular: "compliance document", plural: "compliance documents" },
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
