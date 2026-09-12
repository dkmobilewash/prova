/**
 * The sentences behind every StatusLine, as pure functions of what the
 * page already derived (#241).
 *
 * Two rules, both from the issue and both pinned by status-sentences.test.ts:
 *
 *  - The QUIET sentence names the figures a person would have read off the
 *    old tiles, so nothing is lost by removing them; it is one plain line.
 *  - A PROBLEM is red for money or a deadline already at risk (past a
 *    promised, due or asked-for date; a callback nobody has closed) and
 *    amber for a deadline coming or work sitting in our court. A count is
 *    never a problem on its own: five open RFIs is a Tuesday, five overdue
 *    ones is not.
 *
 * Names are listed up to LISTED, then "and N more", because the sentence
 * has to say WHICH ones — "2 orders past their promised date" is a number,
 * "Tighties LLC, 9 days" is something to pick up the phone about.
 */

export type StatusTone = "red" | "amber";
export type StatusProblem = { text: string; tone: StatusTone };
export type StatusReport = { quiet: string; problems: StatusProblem[] };

export const LISTED = 4;

export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function listed(names: string[]): string {
  if (names.length <= LISTED) return names.join(", ");
  const rest = names.length - LISTED;
  return `${names.slice(0, LISTED).join(", ")} and ${count(rest, "more", "more")}`;
}

const days = (n: number) => count(n, "day");

// ---------------------------------------------------------------- orders

export type LateOrder = { vendorName: string; daysLate: number };

export function materialOrdersStatus(input: {
  late: LateOrder[];
  outstanding: number;
  delivered: number;
}): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.late.length > 0) {
    const names = [...input.late]
      .sort((a, b) => b.daysLate - a.daysLate)
      .map((o) => `${o.vendorName} (${days(o.daysLate)})`);
    problems.push({
      tone: "red",
      text: `${count(input.late.length, "order")} past the promised date — ${listed(names)}.`,
    });
  }
  const quiet =
    input.outstanding + input.delivered === 0
      ? "Nothing on order yet."
      : `Nothing late. ${count(input.outstanding, "order")} outstanding, ${input.delivered} delivered.`;
  return { quiet, problems };
}

// ------------------------------------------------------------------ RFIs

export type OverdueRfi = { number: number; jobName: string; daysOverdue: number };

export function rfisStatus(input: { overdue: OverdueRfi[]; open: number; impact: number }): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.overdue.length > 0) {
    const names = [...input.overdue]
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((r) => `#${r.number} ${r.jobName} (${days(r.daysOverdue)})`);
    problems.push({
      tone: "red",
      text: `${count(input.overdue.length, "RFI")} past the date we asked for — ${listed(names)}.`,
    });
  }
  const impact = input.impact > 0 ? ` ${count(input.impact, "answer")} with cost or schedule impact.` : "";
  const quiet =
    input.open === 0
      ? `No open RFIs.${impact}`
      : `${count(input.open, "RFI")} awaiting an answer, none overdue.${impact}`;
  return { quiet, problems };
}

// ------------------------------------------------------------ submittals

export type SubmittalRef = { number: number; jobName: string };
export type OverdueSubmittal = SubmittalRef & { daysOverdue: number };

export function submittalsStatus(input: {
  revise: SubmittalRef[];
  overdueWithGc: OverdueSubmittal[];
  withGc: number;
  approved: number;
  total: number;
}): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.revise.length > 0) {
    const names = input.revise.map((s) => `#${s.number} ${s.jobName}`);
    problems.push({
      tone: "amber",
      text: `${count(input.revise.length, "submittal")} back in our court to resubmit — ${listed(names)}.`,
    });
  }
  if (input.overdueWithGc.length > 0) {
    const names = [...input.overdueWithGc]
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((s) => `#${s.number} ${s.jobName} (${days(s.daysOverdue)})`);
    problems.push({
      tone: "amber",
      text: `${count(input.overdueWithGc.length, "submittal")} with the GC past the due-back date — ${listed(names)}.`,
    });
  }
  const quiet =
    input.total === 0
      ? "No submittals yet."
      : `${input.withGc} with the GC, ${input.approved} approved, nothing waiting on us.`;
  return { quiet, problems };
}

// -------------------------------------------------------------- drawings

export type BehindSet = { name: string; jobName: string; missing: number };

export function drawingsStatus(input: { behind: BehindSet[]; inHand: number; total: number }): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.behind.length > 0) {
    const names = [...input.behind]
      .sort((a, b) => b.missing - a.missing)
      .map((s) => `${s.name} on ${s.jobName} (${count(s.missing, "issue")} not received)`);
    problems.push({
      tone: "red",
      text: `${count(input.behind.length, "set")} being built from paper that is out of date — ${listed(names)}.`,
    });
  }
  let quiet: string;
  if (input.total === 0) quiet = "No drawing sets yet.";
  else if (input.inHand === input.total) quiet = `All ${count(input.total, "set")} current and in hand.`;
  else quiet = `${input.inHand} of ${count(input.total, "set")} current and in hand, none behind.`;
  return { quiet, problems };
}

// -------------------------------------------------------------- messages

export type FailedMessage = { to: string; subject: string };

export function messagesStatus(input: {
  failed: FailedMessage[];
  unconfirmed: number;
  sent: number;
  rate: number | null;
}): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.failed.length > 0) {
    const names = input.failed.map((m) => `${m.to} (${m.subject})`);
    problems.push({
      tone: "red",
      text: `${count(input.failed.length, "message")} bounced, refused or flagged as spam — ${listed(names)}.`,
    });
  }
  if (input.unconfirmed > 0) {
    problems.push({
      tone: "amber",
      text: `${count(input.unconfirmed, "message")} sent and never confirmed delivered.`,
    });
  }
  let quiet: string;
  if (input.sent === 0) quiet = "Nothing sent yet.";
  else if (input.rate === null) quiet = `${count(input.sent, "message")} sent, nothing bounced, nothing confirmed yet.`;
  else quiet = `Nothing bounced. ${input.rate}% of what went out is confirmed at the far end.`;
  return { quiet, problems };
}

// ---------------------------------------------------------------- safety

/** A record, never an alert: a recordable case is a fact on the 300 log,
 * not money or a date at risk, so this page never colours. */
export function safetyStatus(input: {
  year: number;
  cases: number;
  recordable: number;
  daysAway: number;
}): StatusReport {
  const quiet =
    input.cases === 0
      ? `No cases logged for ${input.year}.`
      : `${count(input.cases, "case")} logged for ${input.year}: ${input.recordable} recordable on the 300 log, ${input.daysAway} with days away.`;
  return { quiet, problems: [] };
}

// ---------------------------------------------------------------- alerts

export function alertsStatus(input: {
  overdue: number;
  dueSoon: number;
  standing: number;
  /** Already formatted, or null when no alert names a figure. Named, not
   * owed — the page says so beside it. */
  amountNamed: string | null;
}): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.overdue > 0) problems.push({ tone: "red", text: `${count(input.overdue, "alert")} past due.` });
  if (input.dueSoon > 0) problems.push({ tone: "amber", text: `${count(input.dueSoon, "alert")} coming up.` });
  const money = input.amountNamed ? ` Money named by these alerts: ${input.amountNamed}, not a balance.` : "";
  const quiet =
    input.overdue + input.dueSoon + input.standing === 0
      ? "Nothing needs attention."
      : `Nothing past due. ${count(input.standing, "standing condition")} with no date.${money}`;
  return { quiet, problems };
}

// -------------------------------------------------------------- closeout

export function closeoutStatus(input: {
  outstandingJobs: number;
  outstandingItems: number;
  readyToSubmit: number;
  inWarranty: number;
  openCallbacks: number;
  /** Retainage behind an unfinished closeout, already formatted, or null
   * for a viewer who may not see money. */
  retainage: string | null;
}): StatusReport {
  const problems: StatusProblem[] = [];
  if (input.openCallbacks > 0) {
    problems.push({ tone: "red", text: `${count(input.openCallbacks, "open callback")}.` });
  }
  if (input.outstandingJobs > 0) {
    const items = input.outstandingItems > 0 ? `, ${count(input.outstandingItems, "item")} still owed` : "";
    const money = input.retainage ? `, ${input.retainage} of retainage behind it` : "";
    problems.push({
      tone: "amber",
      text: `${count(input.outstandingJobs, "job")} with closeout outstanding${items}${money}.`,
    });
  }
  if (input.readyToSubmit > 0) {
    problems.push({ tone: "amber", text: `${count(input.readyToSubmit, "package")} ready to send today.` });
  }
  const quiet = `Nothing outstanding. ${count(input.inWarranty, "job")} still in warranty.`;
  return { quiet, problems };
}

// ------------------------------------------------------------- assistant

export function assistantStatus(input: { proposed: number; done: number; notDone: number }): StatusReport {
  const quiet =
    input.proposed === 0
      ? "No cards in the last 30 days."
      : `${count(input.proposed, "card")} in the last 30 days: ${input.done} done, ${input.notDone} refused by the app when tapped.`;
  return { quiet, problems: [] };
}
