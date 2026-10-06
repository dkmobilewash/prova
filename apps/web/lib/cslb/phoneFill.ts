/**
 * WHICH LEADS GET A TELEPHONE NUMBER, AND WHICH DO NOT.
 *
 * A §4104 listing gives a lead a licence number and no way to ring it. The CSLB
 * master file gives a licence number a telephone number. This module is the join,
 * and it is the whole decision: pure, no prisma, no file system, so the one rule
 * that matters can be proved by a test rather than trusted to a script.
 *
 * ── THE ONE RULE THAT MATTERS ──
 *
 * **A number a person typed is never overwritten.** Not corrected, not preferred
 * against, not touched. `SalesLead.phone` is written today only by the hand-typed
 * lead form, so a value in it is somebody's own knowledge — very possibly the
 * mobile of the estimator they actually speak to, which is worth more than the
 * office line CSLB has on file. A bulk job that silently replaced it would destroy
 * exactly the information nobody can get back, and it would do so invisibly across
 * hundreds of rows.
 *
 * So a lead with a phone is reported as `ALREADY_HAS_PHONE` and skipped, and that
 * is true even when the file holds a DIFFERENT number. Noticing the difference is
 * useful and belongs in a report for a person to read; acting on it is not this
 * job's to do.
 *
 * ── WHY THE OUTCOMES ARE FIVE AND NOT A BOOLEAN ──
 *
 * "Nothing happened" has four completely different meanings here, and a run that
 * collapsed them would be unreadable: a lead with no licence at all cannot be
 * looked up, a licence absent from the file may be expired or out of state, a
 * licence present with no phone is the 0.1% the file does not carry, and a lead
 * that already has a number was deliberately left alone. Only the second and third
 * say anything about CSLB; the first says the listing had no licence column and the
 * fourth says the job worked as designed.
 *
 * That is CLAUDE.md's verdict-counting rule applied before the fact: absence of a
 * failure is not a pass, and a summary that cannot distinguish "did not apply"
 * from "could not" reports clean and means nothing.
 *
 * ── THE KEY IS NORMALISED ON BOTH SIDES BY THE SAME FUNCTION ──
 *
 * `licenceKey` normalises the lead's stored number and the file's `LicenseNo`
 * alike, so a class prefix or a leading zero on either side cannot make a real
 * match look like a miss. Two copies of that rule is the failure `masterFile.ts`
 * documents at length; there is one.
 */

import { licenceKey } from "../sales-licence";
import type { CslbRecord } from "./masterFile";

/** The only lead fields this decision reads. */
export type LeadForFill = {
  id: string;
  companyName: string;
  licenceNumber: string | null;
  phone: string | null;
};

export type FillOutcome =
  /** A number was found and the lead had none. The only case that writes. */
  | { kind: "FILLED"; phone: string; record: CslbRecord }
  /** The lead already has a number. Never overwritten — see the header. */
  | { kind: "ALREADY_HAS_PHONE"; existing: string; fileHas: string | null }
  /** The lead carries no licence number, so there is nothing to look up. */
  | { kind: "NO_LICENCE" }
  /** The licence is not in the file: expired-non-renewable, revoked, or not CA. */
  | { kind: "NOT_IN_FILE"; licence: string }
  /** The licence is in the file and its phone column could not be read. */
  | { kind: "NO_PHONE_IN_FILE"; record: CslbRecord };

export type FillDecision = { lead: LeadForFill; outcome: FillOutcome };

function typed(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What should happen to ONE lead.
 *
 * The order of the tests is the point. `ALREADY_HAS_PHONE` is checked FIRST, before
 * the licence is even read, so there is no path through this function in which a
 * lead with a number can reach the branch that writes one.
 */
export function fillOutcome(
  lead: LeadForFill,
  lookup: (licence: string) => CslbRecord | undefined,
): FillOutcome {
  const existing = typed(lead.phone);
  const licence = licenceKey(lead.licenceNumber).key;

  if (existing !== null) {
    const record = licence === null ? undefined : lookup(licence);
    return { kind: "ALREADY_HAS_PHONE", existing, fileHas: record?.phone ?? null };
  }
  if (licence === null) return { kind: "NO_LICENCE" };

  const record = lookup(licence);
  if (!record) return { kind: "NOT_IN_FILE", licence };
  if (record.phone === null) return { kind: "NO_PHONE_IN_FILE", record };

  return { kind: "FILLED", phone: record.phone, record };
}

export type FillSummary = Record<FillOutcome["kind"], number>;

/**
 * Every outcome kind at zero.
 *
 * A TOTAL record, so a new outcome cannot be added without this failing to compile
 * — which is what stops a kind being invented and then quietly missing from every
 * report.
 */
export function emptySummary(): FillSummary {
  return {
    FILLED: 0,
    ALREADY_HAS_PHONE: 0,
    NO_LICENCE: 0,
    NOT_IN_FILE: 0,
    NO_PHONE_IN_FILE: 0,
  };
}

/** The whole plan for a set of leads, and the counts that describe it. */
export function fillPlan(
  leads: readonly LeadForFill[],
  lookup: (licence: string) => CslbRecord | undefined,
): { decisions: FillDecision[]; summary: FillSummary } {
  const summary = emptySummary();
  const decisions = leads.map((lead) => {
    const outcome = fillOutcome(lead, lookup);
    summary[outcome.kind] += 1;
    return { lead, outcome };
  });
  return { decisions, summary };
}

/**
 * A write carries the phone it EXPECTED to find, not just the one to set.
 *
 * That is optimistic concurrency and the reason for it is a real race rather than a
 * theoretical one: planning reads every lead, the run then takes as long as it
 * takes, and somebody typing a telephone number into the lead form in that window
 * must win. Passing the observed value lets the UPDATE itself say "only if this is
 * still what it was", so the database refuses the overwrite even if the decision
 * layer above were wrong.
 *
 * Belt and braces on purpose. `fillOutcome` already cannot produce a write for a
 * lead with a number; this makes it so that a future edit which breaks that still
 * cannot destroy one.
 */
export type PhoneWrite = { id: string; phone: string; expectPhone: string | null };

/** The writes a plan implies, and nothing else. */
export function writesFrom(decisions: readonly FillDecision[]): PhoneWrite[] {
  return decisions.flatMap(({ lead, outcome }) =>
    outcome.kind === "FILLED"
      ? [{ id: lead.id, phone: outcome.phone, expectPhone: lead.phone }]
      : [],
  );
}

/**
 * The narrowest client this needs, so the apply can be executed by a test without
 * a database and by the runner with one. `updateMany` rather than `update` because
 * it takes a WHERE that can fail to match without throwing, which is the whole
 * mechanism: a count of zero means the row moved under us.
 */
export type PhoneFillClient = {
  salesLead: {
    updateMany(args: {
      where: { id: string; phone: string | null };
      data: { phone: string };
    }): Promise<{ count: number }>;
  };
};

export type ApplyResult = {
  written: number;
  /** Leads whose phone changed between planning and applying. Never overwritten. */
  raced: string[];
};

/**
 * Apply the writes, one conditional UPDATE each.
 *
 * Not wrapped in a transaction, deliberately: these rows are independent, a
 * partial run leaves every lead it did reach correctly filled, and holding a
 * transaction open across hundreds of updates against a pooled Neon connection is
 * how `connection_limit=5` becomes everybody's problem. Re-running is safe and
 * idempotent — a lead filled by the last run simply reports as already having one.
 */
export async function applyPhoneFill(
  client: PhoneFillClient,
  writes: readonly PhoneWrite[],
): Promise<ApplyResult> {
  const result: ApplyResult = { written: 0, raced: [] };
  for (const write of writes) {
    const { count } = await client.salesLead.updateMany({
      where: { id: write.id, phone: write.expectPhone },
      data: { phone: write.phone },
    });
    if (count === 1) result.written += 1;
    else result.raced.push(write.id);
  }
  return result;
}

/**
 * The licence index, built from whatever rows the reader produced.
 *
 * `LicenseNo` is the file's primary key so a duplicate should be impossible, which
 * is exactly why a duplicate is COUNTED rather than ignored: a run that quietly
 * dropped half the file to collisions would otherwise look like a run against a
 * file with fewer licences in it. The FIRST row wins, so the result does not depend
 * on how the stream happened to be chunked.
 */
export function indexByLicence(records: readonly CslbRecord[]): {
  byLicence: Map<string, CslbRecord>;
  duplicates: number;
} {
  const byLicence = new Map<string, CslbRecord>();
  let duplicates = 0;
  for (const record of records) {
    if (byLicence.has(record.licence)) {
      duplicates += 1;
      continue;
    }
    byLicence.set(record.licence, record);
  }
  return { byLicence, duplicates };
}
