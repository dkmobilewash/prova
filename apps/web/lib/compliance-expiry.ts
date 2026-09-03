/**
 * What is about to lapse, across every record that can lapse.
 *
 * Sheet 14's one missing row, and Sheet 26's first: expiration was computed
 * correctly everywhere it was already shown, but only where it was shown.
 * A COI lives on /compliance, a license and a policy and a bond live on
 * /settings, and none of the four sorted or flagged by date — so knowing a
 * renewal was coming required visiting two pages and reading every row.
 * That is not a thing anyone does weekly, and the consequences are not
 * small: a lapsed COI gets a crew turned away at the gate, an expired
 * license can void the contract you are working under.
 *
 * Everything here is derived at read time from the date on the record.
 * Nothing is stored. That is the same rule the schema comments on all four
 * models already state, and it is the reason this could be built without a
 * migration.
 *
 * What this is NOT: delivery. Nothing here emails, texts, or pushes
 * anything — it ranks, and the pages render it. Sheet 26 stays open.
 */

export type RenewalKind =
  | "COMPLIANCE_DOCUMENT"
  | "LICENSE"
  | "INSURANCE_POLICY"
  | "BOND"
  | "MSA"
  | "PREQUALIFICATION";

/**
 * How far ahead each kind is worth warning about.
 *
 * Not one global number, because the lead time you need is the lead time
 * the renewal takes. A COI is a phone call to a broker and can be turned
 * around in a week. A contractor's licence renewal goes through a state
 * board and routinely takes over a month, so a 30-day warning on one of
 * those arrives after it is already too late to act calmly.
 */
export const RENEWAL_HORIZON_DAYS: Record<RenewalKind, number> = {
  COMPLIANCE_DOCUMENT: 30,
  INSURANCE_POLICY: 30,
  LICENSE: 60,
  BOND: 60,
  // A Master Service Agreement is a negotiated contract, not paperwork you
  // resubmit — same lead-time reasoning as LICENSE/BOND.
  MSA: 60,
  // Prequalification is a form/portal resubmission, closer in effort to an
  // insurance renewal than a licence one.
  PREQUALIFICATION: 30,
};

export type RenewalUrgency = "EXPIRED" | "DUE_SOON" | "CURRENT" | "UNDATED";

export type RenewalSource = {
  id: string;
  kind: RenewalKind;
  /** What it is, in the words the user would use. */
  title: string;
  /** Which one it is — the party, the jurisdiction, the carrier. */
  detail: string | null;
  /** The expiry/renewal date as yyyy-mm-dd, or null if the record has none. */
  date: string | null;
  /**
   * Whether a missing date is a gap or just how this record works.
   *
   * This flag is why the list stays readable. Only a COI among compliance
   * documents expires — a lien waiver and a certified payroll report never
   * do. Flagging every undated record would bury four real warnings under
   * two hundred permanent ones, which is how an alert list stops being
   * read at all.
   */
  expectsDate: boolean;
  /** Where to go to fix it. */
  href: string;
  /**
   * A status the record stores about itself, where one exists
   * (CompanyLicense.status). Compared against the date, never trusted over
   * it.
   */
  storedStatus?: string | null;
};

export type Renewal = RenewalSource & {
  urgency: RenewalUrgency;
  /** Negative once past. Null when there is no date. */
  daysUntil: number | null;
  /**
   * Set when a stored status contradicts what the date says. Neither one
   * is corrected automatically: a human entered both, and which is stale is
   * not knowable from here.
   */
  disagreement: string | null;
};

/** A Date as the yyyy-mm-dd it represents in UTC — dates are stored at UTC
 * midnight and rendered in UTC everywhere in this app. */
export function toIsoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function daysUntil(dateIso: string, todayIso: string) {
  const ms = Date.parse(`${dateIso}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * A date expiring TODAY counts as due, not expired — cover normally runs
 * through the end of its last day, and telling someone their still-valid
 * COI has already lapsed is the kind of wrong that makes people stop
 * believing the warning.
 */
export function renewalUrgency(
  dateIso: string | null,
  todayIso: string,
  horizonDays: number,
  expectsDate: boolean,
): RenewalUrgency {
  if (dateIso === null) return expectsDate ? "UNDATED" : "CURRENT";
  const days = daysUntil(dateIso, todayIso);
  if (days < 0) return "EXPIRED";
  if (days <= horizonDays) return "DUE_SOON";
  return "CURRENT";
}

function disagreementFor(source: RenewalSource, urgency: RenewalUrgency): string | null {
  const stored = source.storedStatus;
  if (!stored) return null;
  if (stored === "EXPIRED" && (urgency === "CURRENT" || urgency === "DUE_SOON")) {
    return "Marked expired, but its date has not passed.";
  }
  if (stored === "ACTIVE" && urgency === "EXPIRED") {
    return "Marked active, but its date has passed.";
  }
  return null;
}

export function classifyRenewal(source: RenewalSource, todayIso: string): Renewal {
  const urgency = renewalUrgency(
    source.date,
    todayIso,
    RENEWAL_HORIZON_DAYS[source.kind],
    source.expectsDate,
  );
  return {
    ...source,
    urgency,
    daysUntil: source.date === null ? null : daysUntil(source.date, todayIso),
    disagreement: disagreementFor(source, urgency),
  };
}

const URGENCY_ORDER: Record<RenewalUrgency, number> = {
  EXPIRED: 0,
  DUE_SOON: 1,
  UNDATED: 2,
  CURRENT: 3,
};

/**
 * Everything that needs attention, worst first.
 *
 * Deliberately drops CURRENT rows. A list that shows what is fine
 * alongside what is not is a list you have to read in full to use, which
 * defeats the point of having it — the records themselves are still on
 * their own pages.
 *
 * Within expired, longest-lapsed first; within due, soonest first. A
 * record that disagrees with itself is never dropped, whatever its date
 * says, because one of the two facts is wrong and neither page shows that.
 */
export function renewalAlerts(sources: RenewalSource[], todayIso: string): Renewal[] {
  return sources
    .map((source) => classifyRenewal(source, todayIso))
    .filter((renewal) => renewal.urgency !== "CURRENT" || renewal.disagreement !== null)
    .sort((a, b) => {
      const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (byUrgency !== 0) return byUrgency;
      if (a.daysUntil !== null && b.daysUntil !== null && a.daysUntil !== b.daysUntil) {
        return a.daysUntil - b.daysUntil;
      }
      return a.title.localeCompare(b.title);
    });
}

export function summarizeRenewals(renewals: Renewal[]) {
  return {
    expired: renewals.filter((r) => r.urgency === "EXPIRED").length,
    dueSoon: renewals.filter((r) => r.urgency === "DUE_SOON").length,
    undated: renewals.filter((r) => r.urgency === "UNDATED").length,
    disagreeing: renewals.filter((r) => r.disagreement !== null).length,
    total: renewals.length,
  };
}

/** "expired 9 days ago" / "due in 3 days" / "due today" — the phrasing the
 * rows use, kept here so the pages can't word the same state differently. */
export function renewalTiming(renewal: Renewal): string {
  if (renewal.daysUntil === null) return "no date recorded";
  if (renewal.daysUntil < 0) {
    const days = Math.abs(renewal.daysUntil);
    return `expired ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  if (renewal.daysUntil === 0) return "due today";
  return `due in ${renewal.daysUntil} ${renewal.daysUntil === 1 ? "day" : "days"}`;
}
