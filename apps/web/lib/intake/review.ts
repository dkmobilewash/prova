/**
 * What the intake tray shows, and in what order.
 *
 * Pure and session-free, the same split `lib/job-media.ts` uses against the
 * route that enforces it: the decisions that matter — which row a person
 * reads first, what the counts at the top say — are decidable without a
 * database and are pinned in `review.test.ts`.
 *
 * THE ORDER IS THE FEATURE. A tray of eighty files is only worth having if
 * the ones the machine is unsure about are the ones you read first.
 * `orderBy: { createdAt: "desc" }` gives you the order the files happened
 * to upload in, and sorting by the confidence enum gives you HIGH, LOW,
 * MEDIUM (alphabetical) — both of which bury the four rows a person is
 * actually needed for under sixty they are not.
 */

/**
 * Every destination this screen can file something as.
 *
 * Written down FOUR times in this repo — here, in `classify.ts`'s
 * `IntakeKind`, in the Prisma enum, and in the migration's `CREATE TYPE` —
 * and `review.test.ts` requires all four to agree, because the failure is
 * invisible to typecheck and lint: a dropdown offering a value the database
 * enum does not hold is a 500 on the confirm button, on the one row
 * somebody overrode by hand.
 *
 * The order is the order the dropdown offers, which is roughly how often a
 * specialty sub receives each thing, with UNKNOWN last because it is not a
 * destination — it is the absence of one.
 */
export const INTAKE_KINDS = [
  "DRAWING",
  "SUBMITTAL",
  "RFI_RESPONSE",
  "COMPLIANCE_DOC",
  "EXECUTED_SUBCONTRACT",
  "PAY_APP",
  "LIEN_WAIVER",
  "CERTIFIED_PAYROLL",
  "PHOTO",
  "UNKNOWN",
] as const;

export type IntakeKindValue = (typeof INTAKE_KINDS)[number];

/**
 * A kind something can actually be FILED as — everything except UNKNOWN.
 *
 * UNKNOWN is in `INTAKE_KINDS` because the dropdown has to be able to SHOW
 * it: it is what a row arrives as, and the label a person sees before they
 * choose. It is not a destination, and the confirm action refuses it. Having
 * the exclusion in the type means the refusal and the write cannot drift
 * apart — a future caller that skips the check will not compile.
 */
export type FilableKind = Exclude<IntakeKindValue, "UNKNOWN">;

/**
 * What each destination is CALLED on screen.
 *
 * "Filed as", never "added to your submittals" — this pass records the
 * accepted kind and job on the intake row and does not create a Submittal,
 * an Rfi or a ComplianceDocument. Routing each kind into its destination
 * model is a second change with per-model identity rules (a submittal
 * number is issued from a counter, an RFI is an evidence record whose
 * fields lock on creation), and a label promising it before it exists is
 * how a demo becomes a lie.
 */
export const INTAKE_KIND_LABELS: Record<IntakeKindValue, string> = {
  DRAWING: "Drawing revision",
  SUBMITTAL: "Submittal",
  RFI_RESPONSE: "RFI response",
  COMPLIANCE_DOC: "Compliance document",
  EXECUTED_SUBCONTRACT: "Executed subcontract",
  PAY_APP: "Pay application",
  LIEN_WAIVER: "Lien waiver",
  CERTIFIED_PAYROLL: "Certified payroll",
  PHOTO: "Photo",
  UNKNOWN: "Couldn't place it",
};

export function intakeKindLabel(kind: string): string {
  return INTAKE_KIND_LABELS[kind as IntakeKindValue] ?? kind;
}

/** True for a value this build knows how to file as. Used to validate what
 * comes back from a `<select>`, which is a value the browser's owner can
 * edit. */
export function isIntakeKind(value: string): value is IntakeKindValue {
  return (INTAKE_KINDS as readonly string[]).includes(value);
}

/** The shape the ordering needs. Deliberately structural rather than the
 * Prisma row type: the page passes rows, the tests pass literals, and
 * neither should have to build a `DocumentIntake`. */
export type ReviewableRow = {
  proposedKind: string;
  proposedConfidence: string;
  fileName: string;
};

export type StatusedRow = ReviewableRow & { status: string };

/**
 * How far up the page a row belongs. Lower sorts higher.
 *
 * UNKNOWN outranks everything, including an UNKNOWN the classifier was
 * confident about: "confidently unplaceable" is still a row only a person
 * can move. After that it is plain uncertainty, ascending.
 *
 * AN UNRECOGNISED CONFIDENCE SORTS UP, not down, and that is the one
 * genuinely arguable line in this file. A value this build has never seen
 * is far more likely to be a newer classifier than an attack, and the cost
 * of the two mistakes is not symmetric: sorted up it wastes a second of
 * somebody's attention, sorted down it is a row nobody ever looks at.
 */
const CONFIDENCE_RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export function reviewRank(row: ReviewableRow): number {
  if (row.proposedKind === "UNKNOWN") return 0;
  return CONFIDENCE_RANK[row.proposedConfidence] ?? 1;
}

/**
 * The tray, uncertain first.
 *
 * Copies before sorting — a server component passing its query result
 * straight in must not have that array reordered underneath whatever else
 * reads it.
 *
 * The tie-break is the filename rather than nothing, because `Array.sort`
 * being stable only preserves the order it was GIVEN, and the order it is
 * given here is a database order that can change between two renders of the
 * same page. A row that moves under the cursor between a glance and a click
 * is how somebody files the wrong document.
 */
export function sortForReview<T extends ReviewableRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const rank = reviewRank(a) - reviewRank(b);
    if (rank !== 0) return rank;
    return a.fileName.localeCompare(b.fileName);
  });
}

export type IntakeCounts = {
  /** In the tray, placed, and the machine is sure. One click each, or all
   * of them at once. */
  readyToFile: number;
  /** In the tray, placed, and the machine is NOT sure. */
  needALook: number;
  /** In the tray and UNKNOWN. Never auto-filed, whatever the confidence. */
  couldNotPlace: number;
  filed: number;
  dismissed: number;
};

/**
 * The three numbers at the top of the screen, plus what has left the tray.
 *
 * COUNTED OVER THE TRAY ONLY. A filed or dismissed row is gone from the
 * list underneath, and a count that still includes it is a number that
 * disagrees with the rows it sits above — which is the specific way a
 * summary line stops being trusted.
 */
export function countIntake(rows: readonly StatusedRow[]): IntakeCounts {
  const counts: IntakeCounts = {
    readyToFile: 0,
    needALook: 0,
    couldNotPlace: 0,
    filed: 0,
    dismissed: 0,
  };
  for (const row of rows) {
    if (row.status === "FILED") {
      counts.filed += 1;
      continue;
    }
    if (row.status === "DISMISSED") {
      counts.dismissed += 1;
      continue;
    }
    if (row.proposedKind === "UNKNOWN") counts.couldNotPlace += 1;
    else if (row.proposedConfidence === "HIGH") counts.readyToFile += 1;
    else counts.needALook += 1;
  }
  return counts;
}

/**
 * The counts as one line of English — the sentence the demo reads off the
 * screen.
 *
 * "ready to file" rather than "filed automatically", and the distinction is
 * the honesty of this whole screen: nothing is filed until a person
 * confirms it. A line claiming 62 documents were filed by themselves, above
 * a table of 62 documents that have not been, is the kind of copy that
 * survives a demo and not a customer.
 */
export function intakeSummarySentence(counts: IntakeCounts): string {
  const parts: string[] = [];
  if (counts.readyToFile > 0) parts.push(`${counts.readyToFile} ready to file`);
  if (counts.needALook > 0) {
    parts.push(`${counts.needALook} need${counts.needALook === 1 ? "s" : ""} a look`);
  }
  if (counts.couldNotPlace > 0) parts.push(`${counts.couldNotPlace} we couldn't place`);
  if (parts.length === 0) return "Nothing waiting";
  return parts.join(", ");
}

/** What the alert source needs to know about the tray, and nothing else. */
export type IntakeTraySummary = {
  readyToFile: number;
  needsALook: number;
  unmatchedJobNames: { name: string; files: number }[];
};

/**
 * How many files a job name must appear on before it is a MISSING JOB
 * rather than a word.
 *
 * One file mentioning "Riverside" is a word in a filename. Three are a job
 * somebody has not created, or has created under another name. The whole
 * value of the suggestion is that it is worth acting on, and a list of
 * every stray capitalised noun in a folder of eighty is not.
 */
export const UNMATCHED_JOB_FLOOR = 3;

/**
 * The tray as the alert engine sees it.
 *
 * Pure, and separate from the query, for the reason `alerts-query.ts` states
 * about itself: it fetches and normalises, `alerts.ts` decides. This is the
 * normalising half and it is the part with a judgement in it — which job
 * names count as missing — so it is here where it can be tested without a
 * database.
 *
 * Job names are compared case-insensitively and trimmed. That is deliberately
 * crude: this decides whether to SUGGEST that somebody look, not whether to
 * file anything, and a fuzzy match that quietly filed a document onto the
 * wrong job is the failure this whole screen is built to avoid.
 */
export function intakeTraySummary(
  rows: readonly {
    proposedKind: string;
    proposedConfidence: string;
    status: string;
    jobHint: string | null;
    jobId: string | null;
  }[],
  jobNames: readonly string[],
): IntakeTraySummary {
  const known = new Set(jobNames.map((name) => name.trim().toLowerCase()).filter(Boolean));

  const byName = new Map<string, { name: string; files: number }>();
  for (const row of rows) {
    // A row already ON a job is not evidence of a missing one, whatever its
    // hint said — somebody answered that question.
    if (row.jobId) continue;
    const hint = row.jobHint?.trim();
    if (!hint) continue;
    const key = hint.toLowerCase();
    if (known.has(key)) continue;
    const held = byName.get(key);
    if (held) held.files += 1;
    else byName.set(key, { name: hint, files: 1 });
  }

  // Through countIntake, never re-derived: the tray header and the alert
  // beside it must split the same tray the same way. They did not, once.
  const counts = countIntake(rows as unknown as readonly StatusedRow[]);
  return {
    readyToFile: counts.readyToFile,
    needsALook: counts.needALook + counts.couldNotPlace,
    unmatchedJobNames: [...byName.values()]
      .filter((entry) => entry.files >= UNMATCHED_JOB_FLOOR)
      // Loudest first, then by name so two of the same size have a stable order.
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
  };
}
