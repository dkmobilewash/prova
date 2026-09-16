/**
 * What may be corrected on a logged hour, and what may never be.
 *
 * Issue #63: a field time entry had one action, Remove, and it fired on the
 * first click — so correcting "10 hours" that should have been "8" meant
 * destroying the row and typing a new one. On a prevailing-wage job these
 * rows ARE the record of what a person was paid and for what, and #61's
 * sibling finding already has the app comparing entered hours against a rule
 * set ("entered 10 straight, rules imply 8 straight, 2 OT"). That comparison
 * presumes the entered figure is a record rather than a draft.
 *
 * THE DECISION THIS FILE IS, because the issue deliberately left it open.
 *
 * A correction changes the FIGURES. It never changes WHOSE day it was or
 * WHICH day it was.
 *
 *   LOCKED — `jobId`, `employeeUserId`, `crewMemberId`, `date`. These four
 *   are what a WH-347 line is keyed by: the project, the named person, the
 *   day worked. Change any one of them and the row is not a corrected record
 *   of Tuesday's work, it is a record of somebody else's Wednesday — a new
 *   entry, not an edit. So the path for those stays what it has always been:
 *   delete the entry and enter the right one, which now takes two clicks
 *   instead of one. This is CLAUDE.md's evidence-record rule applied to the
 *   table it had not yet been applied to (identity fields locked after
 *   creation), and it is the same rule the CrewMember trigger enforces one
 *   table over: "a misspelt name is fixed by archiving the row and creating a
 *   corrected one."
 *
 *   CORRECTABLE — hours, pay type, note, per diem, travel pay, cost code,
 *   craft classification. Every one of these is a figure or a classification
 *   ABOUT that person's day, entered by hand at the end of a shift, and every
 *   one of them is routinely mistyped. Craft classification is the debatable
 *   one and it is deliberately in: it drives the wage rate and the apprentice
 *   ratio, a wrong one is a wrong rate on a government filing, and correcting
 *   it moves no hour from one person to another. The test in this file's
 *   sibling asserts these seven EXACTLY, not "at least", so widening the set
 *   is a decision somebody has to make on purpose.
 *
 * WHAT THIS IS NOT, said plainly because the issue asked for more. It records
 * THAT an entry was corrected, WHEN, and BY WHOM (`lastCorrectedAt`,
 * `lastCorrectedByUserId`) — the three things the issue names — and it does
 * NOT record what the figure used to be. Recovering the previous value needs
 * the amendment row the issue suggests (a locked original with a correction
 * beside it, the way SubmittalRevision handles a package going again), and
 * that is a bigger change than this one: every read path — WH-347, certified
 * payroll, the apprentice ratio, burdened labor cost, the job page totals —
 * would have to learn to ignore superseded rows, and a read path that misses
 * that DOUBLES the hours on a signed filing. Half of that model is worse than
 * none of it, so it is a follow-up rather than something smuggled in here.
 *
 * THE ENFORCEMENT IS IN THE DATABASE, not in this file. The parse below drops
 * a locked field, the action refuses one out loud, and
 * `20260913120000_add_time_entry_correction` installs a BEFORE UPDATE trigger
 * that raises on one. Only the third of those survives a psql session, and
 * `time-entry-correction.test.ts` fails the build if the trigger stops
 * naming every column this module calls locked. The reason the trigger is
 * acceptable NOW when it was removed in September: the whole point of that
 * removal was that TimeEntry is live payroll and nothing exercised the
 * trigger, so real rows would have met it first. There is a form now, and a
 * click-list that saves a correction through it.
 *
 * No prisma import, no "use server": this is a pure module so both the action
 * and the tests can use it, and so the key set of the update payload is
 * something a unit test can hold still.
 */

export const TIME_ENTRY_PAY_TYPES = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"] as const;

export type TimeEntryPayType = (typeof TIME_ENTRY_PAY_TYPES)[number];

export const TIME_ENTRY_PAY_TYPE_OPTIONS: readonly { value: TimeEntryPayType; label: string }[] = [
  { value: "STRAIGHT", label: "Straight" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "DOUBLE_TIME", label: "Double time" },
  { value: "SHIFT_DIFFERENTIAL", label: "Shift differential" },
];

/** The stored value when nothing matches, rather than an empty cell — an
 * unrecognised pay type is a thing worth seeing, not hiding. */
export function timeEntryPayTypeLabel(value: string): string {
  return TIME_ENTRY_PAY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Unrecognized/missing selection falls back to STRAIGHT rather than
 * erroring — every entry needs some pay type, and straight time is the
 * overwhelmingly common case. Unchanged from `logTimeEntry`, which this
 * replaced in place. */
export function timeEntryPayTypeFromForm(formData: FormData): TimeEntryPayType {
  const raw = String(formData.get("payType") ?? "");
  return TIME_ENTRY_PAY_TYPES.includes(raw as TimeEntryPayType) ? (raw as TimeEntryPayType) : "STRAIGHT";
}

/**
 * The columns a correction may never write, and the ones the database
 * trigger refuses.
 *
 * `crewMemberId` is NULL on every row today and read by nothing (see
 * labor.prisma), and it is in this list anyway: the guarantee it carries —
 * "an hour, once attributed, does not change hands" — is the one CLAUDE.md
 * records losing when the original trigger came out, and the moment that
 * column is wired is the moment an update path would be able to move a
 * filed hour from one named person to another.
 */
export const TIME_ENTRY_LOCKED_COLUMNS = ["jobId", "employeeUserId", "crewMemberId", "date"] as const;

/** The seven fields a correction may touch. Named as data rather than left
 * implicit in a type, so a test can assert the SIZE of the set the update
 * payload is built from — CLAUDE.md's rule for anything that derives one. */
export const TIME_ENTRY_CORRECTABLE_KEYS = [
  "hours",
  "payType",
  "note",
  "perDiemAmount",
  "travelPayAmount",
  "lineItemId",
  "craftClassificationId",
] as const;

export type TimeEntryFigures = {
  hours: string;
  payType: TimeEntryPayType;
  note: string | null;
  perDiemAmount: string | null;
  travelPayAmount: string | null;
  /** Raw form values. The action still checks both against this company and
   * this job before they reach the database — a form value is not a
   * permission. */
  lineItemId: string | null;
  craftClassificationId: string | null;
};

type Parsed = { ok: true; value: TimeEntryFigures } | { ok: false; error: string };

function optionalMoney(
  formData: FormData,
  key: string,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: true, value: null };
  if (Number.isNaN(Number(value))) return { ok: false, error: `${label} has to be a number, or left blank.` };
  if (Number(value) < 0) return { ok: false, error: `${label} can't be negative.` };
  return { ok: true, value };
}

/**
 * The figures half of a time entry, from either form — the create form and
 * the correction form post the same field names, which is what makes one
 * `<TimeEntryFields>` safe to share between them.
 *
 * Returns its refusals rather than throwing them: production redacts a
 * thrown Server Action message to a digest, so a user submitting "eight"
 * hours would get an opaque failure instead of the sentence written for
 * them.
 */
export function parseTimeEntryFigures(formData: FormData): Parsed {
  const hours = String(formData.get("hours") ?? "").trim();
  if (!hours || Number.isNaN(Number(hours)) || Number(hours) <= 0) {
    return { ok: false, error: "Hours has to be a positive number — e.g. 8, or 7.5." };
  }

  const perDiemAmount = optionalMoney(formData, "perDiemAmount", "Per diem");
  if (!perDiemAmount.ok) return perDiemAmount;

  const travelPayAmount = optionalMoney(formData, "travelPayAmount", "Travel pay");
  if (!travelPayAmount.ok) return travelPayAmount;

  const note = String(formData.get("note") ?? "").trim();
  const lineItemId = String(formData.get("lineItemId") ?? "").trim();
  const craftClassificationId = String(formData.get("craftClassificationId") ?? "").trim();

  return {
    ok: true,
    value: {
      hours,
      payType: timeEntryPayTypeFromForm(formData),
      note: note || null,
      perDiemAmount: perDiemAmount.value,
      travelPayAmount: travelPayAmount.value,
      lineItemId: lineItemId || null,
      craftClassificationId: craftClassificationId || null,
    },
  };
}

/**
 * The Prisma `data` for a correction, built field by field.
 *
 * DELIBERATELY NOT `{ ...figures, lastCorrectedAt }`. A spread writes
 * whatever the object happens to carry, so a field added to
 * `TimeEntryFigures` later would reach the database without anybody
 * deciding it should. Naming each one makes the payload's key set a fact a
 * test can assert, and it is asserted exactly rather than as a subset.
 *
 * `lastCorrectedAt` is stamped rather than entered, which is the same
 * distinction `createdAt` makes: it records when a mutation happened, not a
 * business date somebody would ever backdate. CLAUDE.md's "dates that
 * matter are ENTERED" rule is about the day the work happened — that is
 * `date`, and it is locked.
 */
export function timeEntryCorrectionUpdateData(
  figures: TimeEntryFigures,
  correctedByUserId: string,
  correctedAt: Date,
) {
  return {
    hours: figures.hours,
    payType: figures.payType,
    note: figures.note,
    perDiemAmount: figures.perDiemAmount,
    travelPayAmount: figures.travelPayAmount,
    lineItemId: figures.lineItemId,
    craftClassificationId: figures.craftClassificationId,
    lastCorrectedAt: correctedAt,
    lastCorrectedByUserId: correctedByUserId,
  };
}

/**
 * Which locked fields a request tried to change, in plain words.
 *
 * The correction form renders the person and the day as text, so a request
 * carrying a DIFFERENT value for either did not come from that form. This
 * exists so that case gets a sentence instead of a raw trigger exception
 * (which production would redact to a digest anyway) — it is the message,
 * not the enforcement. The enforcement is the database trigger; see the
 * header of this file, and the census's own instruction not to add a check
 * in an action and call it done.
 *
 * A locked field that is ABSENT is the normal case and says nothing, which
 * is why this compares only what was actually sent.
 */
export function submittedLockedFieldChanges(
  formData: FormData,
  stored: { employeeUserId: string | null; date: Date },
): string[] {
  const changed: string[] = [];

  const employeeUserId = String(formData.get("employeeUserId") ?? "").trim();
  if (employeeUserId && employeeUserId !== stored.employeeUserId) changed.push("the person");

  const date = String(formData.get("date") ?? "").trim();
  if (date && date !== stored.date.toISOString().slice(0, 10)) changed.push("the day worked");

  return changed;
}
