/**
 * Who can legally be on the site tomorrow.
 *
 * Sheet 17's gap that nothing else covers. The incident log records what
 * already went wrong and the toolbox talks record what was said; neither
 * answers the question a foreman is asked at a gate, which is whether the
 * man standing next to him can produce a current card. Today that answer
 * lives in a folder in somebody's truck, and the way it is discovered is
 * that a crew is turned away and stands idle while the office looks.
 *
 * Everything here is DERIVED at read time from the dates on the records.
 * Nothing is stored — no "expired" flag, no "current card" pointer. A
 * renewed card is a new row and the superseded one stays, so which row
 * governs is a question about today, and a stored answer to it is wrong
 * the morning after it is written.
 *
 * Pure functions, no database and no session, for the same reason
 * lib/permissions.ts is: this is where "is this crew clear to work" has an
 * answer, and lib/certifications.test.ts is where that answer is pinned.
 *
 * The day counting comes from lib/compliance-expiry.ts rather than a
 * second copy of it. That file already decides that a date expiring TODAY
 * is due rather than expired, and two modules disagreeing about the
 * boundary would be a bug nobody could see.
 */

import { daysUntil } from "./compliance-expiry";

export const CERTIFICATION_KINDS = [
  "OSHA_10",
  "OSHA_30",
  "SCAFFOLD_COMPETENT_PERSON",
  "SCAFFOLD_USER",
  "AERIAL_LIFT",
  "POWERED_INDUSTRIAL_TRUCK",
  "FALL_PROTECTION",
  "SILICA_AWARENESS",
  "RESPIRATOR_FIT_TEST",
  "RESPIRATOR_MEDICAL_EVALUATION",
  "HEARING_CONSERVATION",
  "FIRST_AID_CPR",
  "HOT_WORK",
  "CONFINED_SPACE",
  "HAZARD_COMMUNICATION",
  "SITE_ORIENTATION",
  "OTHER",
] as const;

export type CertificationKindValue = (typeof CERTIFICATION_KINDS)[number];

export const CERTIFICATION_LABELS: Record<CertificationKindValue, string> = {
  OSHA_10: "OSHA 10",
  OSHA_30: "OSHA 30",
  SCAFFOLD_COMPETENT_PERSON: "Scaffold competent person",
  SCAFFOLD_USER: "Scaffold user",
  AERIAL_LIFT: "Aerial / scissor lift",
  POWERED_INDUSTRIAL_TRUCK: "Forklift / telehandler",
  FALL_PROTECTION: "Fall protection",
  SILICA_AWARENESS: "Silica awareness",
  RESPIRATOR_FIT_TEST: "Respirator fit test",
  RESPIRATOR_MEDICAL_EVALUATION: "Respirator medical evaluation",
  HEARING_CONSERVATION: "Hearing conservation",
  FIRST_AID_CPR: "First aid / CPR",
  HOT_WORK: "Hot work",
  CONFINED_SPACE: "Confined space",
  HAZARD_COMMUNICATION: "Hazard communication",
  SITE_ORIENTATION: "Site orientation",
  OTHER: "Other",
};

/**
 * How far ahead each kind is worth warning about.
 *
 * Not one global number, for the reason RENEWAL_HORIZON_DAYS gives in
 * compliance-expiry.ts: the lead time you need is the lead time the
 * renewal takes. A respirator fit test is a half-day appointment. An
 * OSHA 30 is thirty hours of classroom you have to get a seat on, and a
 * 30-day warning on one of those arrives after it is already too late to
 * do anything calm about it.
 */
export const CERTIFICATION_HORIZON_DAYS: Record<CertificationKindValue, number> = {
  // Courses with seats to book.
  OSHA_10: 60,
  OSHA_30: 60,
  SCAFFOLD_COMPETENT_PERSON: 60,
  FIRST_AID_CPR: 45,
  CONFINED_SPACE: 45,
  // A physician or licensed health care professional has to sign this off,
  // and the questionnaire goes out and comes back.
  RESPIRATOR_MEDICAL_EVALUATION: 45,
  // Appointments and half-day refreshers.
  SCAFFOLD_USER: 30,
  AERIAL_LIFT: 30,
  POWERED_INDUSTRIAL_TRUCK: 30,
  FALL_PROTECTION: 30,
  SILICA_AWARENESS: 30,
  RESPIRATOR_FIT_TEST: 30,
  HEARING_CONSERVATION: 30,
  HOT_WORK: 30,
  HAZARD_COMMUNICATION: 30,
  // Booked with the GC and done on their site, usually within the week.
  SITE_ORIENTATION: 14,
  // Unknown by definition, so the middle of the range.
  OTHER: 30,
};

/**
 * MISSING is the one that does not come from a date, and it is the one
 * this feature exists for. A worker with no row at all for something the
 * company requires looks exactly like a worker who does not need it —
 * until a gate guard asks. Everything else is read off `expiresOn`.
 *
 * UNDATED means nobody recorded an expiry. It is deliberately NOT read as
 * "never expires": some cards genuinely do not, but a blank cannot tell
 * you which case it is, and guessing the safe-looking one is how a lapsed
 * card sits on a green screen.
 */
export type CertificationStanding = "MISSING" | "EXPIRED" | "UNDATED" | "EXPIRING" | "CURRENT";

/** Worst first. The order the roster sorts by and the order a worker's own
 * worst standing is taken from. */
export const STANDING_RANK: Record<CertificationStanding, number> = {
  MISSING: 0,
  EXPIRED: 1,
  UNDATED: 2,
  EXPIRING: 3,
  CURRENT: 4,
};

/** One palette per standing, so the worker chip and the holding chip can
 * never colour the same state two ways on one screen. Lives here beside
 * the labels rather than in a component, so the page and the row read it
 * from the same place. */
export function standingChipClass(standing: CertificationStanding): string {
  switch (standing) {
    case "MISSING":
    case "EXPIRED":
      return "bg-red-500/15 text-red-300";
    case "UNDATED":
      return "bg-amber-500/15 text-amber-300";
    case "EXPIRING":
      return "bg-amber-500/15 text-amber-200";
    default:
      return "bg-green-500/15 text-green-300";
  }
}

export const STANDING_LABELS: Record<CertificationStanding, string> = {
  MISSING: "Nothing on file",
  EXPIRED: "Expired",
  UNDATED: "No expiry recorded",
  EXPIRING: "Expiring",
  CURRENT: "Current",
};

/** One recorded card, as the pages hand it in: dates already reduced to the
 * yyyy-mm-dd they represent in UTC. */
export type CertificationRecord = {
  id: string;
  kind: CertificationKindValue;
  otherLabel: string | null;
  issuer: string | null;
  referenceNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  documentUrl: string | null;
  documentLabel: string | null;
};

export type RequirementRecord = {
  id: string;
  kind: CertificationKindValue;
  otherLabel: string;
  notes: string | null;
};

/**
 * What makes two records the same thing.
 *
 * For every kind but OTHER that is just the kind. OTHER carries its own
 * label, and "Site badge" typed with a capital S in one place and a small
 * one in another is the same requirement — matching them case-sensitively
 * would report a gap the worker has actually closed, which is the fastest
 * way to teach somebody to ignore this page.
 */
export function certificationKey(kind: CertificationKindValue, otherLabel: string | null): string {
  if (kind !== "OTHER") return kind;
  return `OTHER:${(otherLabel ?? "").trim().toLowerCase()}`;
}

/** What to call it on screen. */
export function certificationTitle(kind: CertificationKindValue, otherLabel: string | null): string {
  if (kind === "OTHER") {
    const label = (otherLabel ?? "").trim();
    return label || CERTIFICATION_LABELS.OTHER;
  }
  return CERTIFICATION_LABELS[kind];
}

export function standingOf(
  expiresOn: string | null,
  todayIso: string,
  horizonDays: number,
): CertificationStanding {
  if (expiresOn === null) return "UNDATED";
  const days = daysUntil(expiresOn, todayIso);
  // Expiring TODAY is still valid today — see renewalUrgency in
  // compliance-expiry.ts, which draws the boundary in the same place.
  if (days < 0) return "EXPIRED";
  if (days <= horizonDays) return "EXPIRING";
  return "CURRENT";
}

export type Holding = {
  key: string;
  kind: CertificationKindValue;
  /** The label the OTHER kind carries, or null. */
  otherLabel: string | null;
  title: string;
  standing: CertificationStanding;
  /** Negative once past, null when the governing record has no expiry or
   * when there is no record at all. */
  daysUntil: number | null;
  /** Whether the company requires this of everyone. */
  required: boolean;
  /** The record that decides, or null when standing is MISSING. */
  governing: CertificationRecord | null;
  /** Every record held for this thing, newest expiry first — the renewal
   * history, which is what gets read back after an incident. */
  history: CertificationRecord[];
};

/** Newest first: latest expiry, then latest issue, then whatever is left
 * in a stable order so two runs never disagree. */
function byNewest(a: CertificationRecord, b: CertificationRecord) {
  if (a.expiresOn !== b.expiresOn) {
    if (a.expiresOn === null) return 1;
    if (b.expiresOn === null) return -1;
    return a.expiresOn < b.expiresOn ? 1 : -1;
  }
  if (a.issuedOn !== b.issuedOn) {
    if (a.issuedOn === null) return 1;
    if (b.issuedOn === null) return -1;
    return a.issuedOn < b.issuedOn ? 1 : -1;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Which of a worker's records for one thing decides where they stand.
 *
 * The BEST standing the records actually support, not the newest record.
 * Two cases drive that, and both are ordinary:
 *
 *  - A renewal is in hand while the old card is still on file. The new one
 *    governs, which "newest expiry" would also get right.
 *  - An expired card sits next to one somebody logged without an expiry
 *    date. That is NOT the same as being definitely lapsed, and reporting
 *    EXPIRED would be claiming to know something nobody recorded. It reads
 *    as UNDATED — go and look at the card — which is the true answer.
 *
 * Ranking never promotes a record to CURRENT that isn't; UNDATED sits
 * below EXPIRING precisely so an unchecked date can never look better
 * than a date somebody actually read.
 */
export function governingCertification(
  records: CertificationRecord[],
  todayIso: string,
): { governing: CertificationRecord | null; standing: CertificationStanding; daysUntil: number | null } {
  if (records.length === 0) {
    return { governing: null, standing: "MISSING", daysUntil: null };
  }

  const ranked = [...records].sort((a, b) => {
    const standingA = standingOf(a.expiresOn, todayIso, CERTIFICATION_HORIZON_DAYS[a.kind]);
    const standingB = standingOf(b.expiresOn, todayIso, CERTIFICATION_HORIZON_DAYS[b.kind]);
    if (standingA !== standingB) return STANDING_RANK[standingB] - STANDING_RANK[standingA];
    return byNewest(a, b);
  });

  const governing = ranked[0];
  const standing = standingOf(
    governing.expiresOn,
    todayIso,
    CERTIFICATION_HORIZON_DAYS[governing.kind],
  );
  return {
    governing,
    standing,
    daysUntil: governing.expiresOn === null ? null : daysUntil(governing.expiresOn, todayIso),
  };
}

export type WorkerInput = {
  id: string;
  name: string | null;
  email: string;
};

export type WorkerStanding = {
  worker: WorkerInput;
  /** One per distinct thing the worker holds OR the company requires,
   * worst standing first. */
  holdings: Holding[];
  /** Only the holdings that are not CURRENT — what a person has to act on. */
  problems: Holding[];
  worst: CertificationStanding;
};

/**
 * Every worker, and where each of them stands.
 *
 * Requirements are folded in as MISSING holdings, which is the whole
 * reason CertificationRequirement exists: a gap in the records is
 * invisible until something says it should have been filled. Same shape
 * as the field-report week that names the weekdays nothing was filed for.
 */
export function rosterStanding(
  workers: WorkerInput[],
  certifications: (CertificationRecord & { holderUserId: string })[],
  requirements: RequirementRecord[],
  todayIso: string,
): WorkerStanding[] {
  const byWorker = new Map<string, (CertificationRecord & { holderUserId: string })[]>();
  for (const record of certifications) {
    const bucket = byWorker.get(record.holderUserId);
    if (bucket) bucket.push(record);
    else byWorker.set(record.holderUserId, [record]);
  }

  const requiredKeys = new Map<string, RequirementRecord>();
  for (const requirement of requirements) {
    requiredKeys.set(certificationKey(requirement.kind, requirement.otherLabel), requirement);
  }

  return workers
    .map((worker) => {
      const held = byWorker.get(worker.id) ?? [];

      const groups = new Map<string, CertificationRecord[]>();
      for (const record of held) {
        const key = certificationKey(record.kind, record.otherLabel);
        const bucket = groups.get(key);
        if (bucket) bucket.push(record);
        else groups.set(key, [record]);
      }
      // A requirement with nothing against it still gets a row — that row
      // IS the finding.
      for (const key of requiredKeys.keys()) {
        if (!groups.has(key)) groups.set(key, []);
      }

      const holdings: Holding[] = [...groups.entries()].map(([key, records]) => {
        const requirement = requiredKeys.get(key) ?? null;
        const sample = records[0] ?? null;
        const kind = sample?.kind ?? requirement?.kind ?? "OTHER";
        const otherLabel = sample ? sample.otherLabel : (requirement?.otherLabel ?? null);
        const { governing, standing, daysUntil: until } = governingCertification(records, todayIso);
        return {
          key,
          kind,
          otherLabel,
          title: certificationTitle(kind, otherLabel),
          standing,
          daysUntil: until,
          required: requirement !== null,
          governing,
          history: [...records].sort(byNewest),
        };
      });

      holdings.sort((a, b) => {
        const byStanding = STANDING_RANK[a.standing] - STANDING_RANK[b.standing];
        if (byStanding !== 0) return byStanding;
        return a.title.localeCompare(b.title);
      });

      const problems = holdings.filter((holding) => holding.standing !== "CURRENT");
      const worst = holdings.length === 0 ? "CURRENT" : holdings[0].standing;

      return { worker, holdings, problems, worst };
    })
    .sort((a, b) => {
      const byWorst = STANDING_RANK[a.worst] - STANDING_RANK[b.worst];
      if (byWorst !== 0) return byWorst;
      if (a.problems.length !== b.problems.length) return b.problems.length - a.problems.length;
      return (a.worker.name ?? a.worker.email).localeCompare(b.worker.name ?? b.worker.email);
    });
}

export function summarizeRoster(roster: WorkerStanding[]) {
  const counts = { missing: 0, expired: 0, undated: 0, expiring: 0 };
  for (const row of roster) {
    for (const holding of row.problems) {
      if (holding.standing === "MISSING") counts.missing += 1;
      else if (holding.standing === "EXPIRED") counts.expired += 1;
      else if (holding.standing === "UNDATED") counts.undated += 1;
      else if (holding.standing === "EXPIRING") counts.expiring += 1;
    }
  }
  return {
    ...counts,
    // The number that gets said out loud: how many PEOPLE, not how many
    // cards. Four lapsed cards on one man is one man to sort out.
    workersWithProblems: roster.filter((row) => row.problems.length > 0).length,
    workers: roster.length,
  };
}

export type CrewJob = {
  id: string;
  name: string;
  /** User ids assigned to the job. */
  crew: string[];
};

export type JobCrewStanding = {
  job: { id: string; name: string };
  /** Assigned crew who are not clear, worst first. Everyone else is fine
   * and is deliberately left out — a list you have to read in full to use
   * is a list nobody uses. */
  short: WorkerStanding[];
  /** How many people are assigned at all, so "0 of 6" can be said rather
   * than an empty box that might mean nobody is assigned. */
  crewSize: number;
};

/**
 * The same roster, cut by job.
 *
 * This is the shape the question is actually asked in — not "who is
 * short" but "is Maple Street clear on Monday". A job with crew assigned
 * and nobody short is dropped; a job with NO crew assigned is dropped too,
 * because it has no answer rather than a good one.
 */
export function jobCrewStanding(jobs: CrewJob[], roster: WorkerStanding[]): JobCrewStanding[] {
  const byWorker = new Map(roster.map((row) => [row.worker.id, row]));

  return jobs
    .map((job) => {
      const standings = job.crew
        .map((userId) => byWorker.get(userId))
        .filter((row): row is WorkerStanding => row !== undefined);
      const short = standings
        .filter((row) => row.problems.length > 0)
        .sort((a, b) => STANDING_RANK[a.worst] - STANDING_RANK[b.worst]);
      return { job: { id: job.id, name: job.name }, short, crewSize: job.crew.length };
    })
    .filter((row) => row.short.length > 0)
    .sort((a, b) => {
      if (a.short.length !== b.short.length) return b.short.length - a.short.length;
      return a.job.name.localeCompare(b.job.name);
    });
}

/** "expired 9 days ago" / "expires in 3 days" / "expires today" — the
 * phrasing every row uses, kept here so two pages can't word the same
 * state differently. */
export function standingTiming(holding: Holding): string {
  if (holding.standing === "MISSING") return "nothing recorded";
  if (holding.daysUntil === null) return "no expiry date recorded";
  if (holding.daysUntil < 0) {
    const days = Math.abs(holding.daysUntil);
    return `expired ${days} ${days === 1 ? "day" : "days"} ago`;
  }
  if (holding.daysUntil === 0) return "expires today";
  return `expires in ${holding.daysUntil} ${holding.daysUntil === 1 ? "day" : "days"}`;
}
