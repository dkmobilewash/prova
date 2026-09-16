/**
 * The name a worker is called on a document that leaves the building.
 *
 * `User.name` is nullable, and seven call sites read
 * `employeeUser.name ?? employeeUser.email`. On an internal screen that
 * fallback is reasonable — it identifies a person. On CERTIFIED PAYROLL it
 * is not: the WH-347 worker-name column is a statement to a government
 * agency about who did the work, and an email address is not that person's
 * name. A wrong name on a filed form is a correction to an agency rather
 * than a patch.
 *
 * So this never returns the email. It returns a placeholder and says the
 * name is missing, which lets the page do what the rest of this codebase
 * does with something it cannot compute: show the gap instead of filling
 * it. Same shape as `hasUncomputedHours` on the row beside it — hours with
 * no fringe schedule are marked, not silently priced at zero.
 *
 * Pure, and separate from the page, so the rule is testable without
 * rendering anything.
 */

export type WorkerIdentity = {
  name: string | null;
  email: string;
};

export type PayrollWorkerName = {
  /** Safe to print on a filing. Never an email address. */
  label: string;
  /** True when the account has no usable name — the filing is not ready. */
  nameMissing: boolean;
};

/** What the name column says when nobody has recorded one. Deliberately a
 * sentence a reader acts on, not a dash they skim past. */
export const NAME_NOT_RECORDED = "Name not recorded";

export function payrollWorkerName(user: WorkerIdentity): PayrollWorkerName {
  // Trimmed, because a name of spaces is not a name and would otherwise
  // print as an empty cell — which reads as a formatting bug rather than
  // as missing data, and is the version nobody chases.
  const name = user.name?.trim();
  if (name) return { label: name, nameMissing: false };
  return { label: NAME_NOT_RECORDED, nameMissing: true };
}

/** The name a crew member (a worker with no login) is called on a filing.
 * Same rule as `payrollWorkerName`: a real name or the placeholder, never
 * an email and never an empty cell. */
export function crewMemberName(crew: {
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
}): PayrollWorkerName {
  const name = [crew.legalFirstName, crew.legalMiddleName, crew.legalLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (name) return { label: name, nameMissing: false };
  return { label: NAME_NOT_RECORDED, nameMissing: true };
}

/** The name for a time entry, whether it names a User or a crew member.
 * The entry is one or the other (the XOR constraint enforces it), so this
 * is exhaustive: employeeUser wins when set, else the crew member. */
export function timeEntryWorkerName(entry: {
  employeeUser: WorkerIdentity | null;
  crewMember: {
    legalFirstName: string;
    legalMiddleName: string | null;
    legalLastName: string;
  } | null;
}): PayrollWorkerName {
  if (entry.employeeUser) return payrollWorkerName(entry.employeeUser);
  if (entry.crewMember) return crewMemberName(entry.crewMember);
  return { label: NAME_NOT_RECORDED, nameMissing: true };
}

/** The stable id a payroll document groups a time entry's worker by. A User
 * id for an employee, a crew-member id for a no-login worker. Exactly one is
 * always set (the XOR constraint), so the `""` fallback is unreachable but
 * keeps the type non-null for callers that key a Map. */
export function timeEntryWorkerId(entry: {
  employeeUserId: string | null;
  crewMemberId: string | null;
}): string {
  return entry.employeeUserId ?? entry.crewMemberId ?? "";
}
