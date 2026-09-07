import type { DispatchOutcome } from "@/lib/notification-dispatch";

/**
 * The semantics of ONE unattended run: who is mailed, in what order, and
 * what happens when one person's send goes wrong.
 *
 * Deliberately knows nothing about HTTP, Prisma or the clock. The route
 * handler supplies the recipients, the dispatcher and the time; this
 * decides the sequence. That split exists because everything that has ever
 * gone wrong with a batch in this project is a loop question — one failure
 * eating the rest, one person's data reaching another, the tail of the
 * list never being reached — and none of those need a database to
 * reproduce. `notification-run.test.ts` reproduces all of them.
 *
 * **ONE DISPATCH PER PERSON, ONE AT A TIME, AND THAT IS NOT A PERFORMANCE
 * CHOICE.** `dispatchAlertDigest` is safe to run twice because a run only
 * sends the notices whose ledger keys it WON, and those keys are
 * `(userId, dispatchKey)`. Two different people therefore never contend.
 * The same person dispatched twice concurrently does: both runs read, both
 * compute, one loses the claim and stays silent — which works, but wastes
 * a whole alert assembly and makes the report lie about how many notices
 * were due. So the loop is sequential and the recipient list is a set of
 * distinct users.
 *
 * The thing NOT to do here, ever, is compute one alert list per COMPANY
 * and mail it to everybody in it. Alerts are capability-filtered per user
 * — a FIELD member's list is not an owner's — so a company-level batch
 * would both mail people alerts they are not allowed to see and collapse
 * every person's ledger claim into one. Per user, always.
 */

/** Everything one send needs, resolved before the loop starts. The same
 * shape `dispatchAlertDigest` takes, on purpose: the run resolves the
 * principal once and hands it over, rather than letting a second place
 * decide what somebody's role is. */
export type RunRecipient = {
  id: string;
  companyId: string;
  email: string;
  name: string | null;
  role: string;
  jobFunction: string | null;
};

/** What happened to one person. No email address in here: the run report
 * goes into a log and a cron response, and neither is a place to put a
 * list of everyone's address. The user id is enough to look one up. */
export type RecipientOutcome =
  | { userId: string; result: "sent"; noticeCount: number }
  | { userId: string; result: "nothing-due" }
  | { userId: string; result: "already-claimed" }
  | { userId: string; result: "failed"; error: string };

/** Why a run stopped before reaching everybody. `null` means it didn't. */
export type RunStop = "email-not-configured" | "time-budget";

export type RunReport = {
  /** How many people the run was given. */
  considered: number;
  /** How many it actually called the dispatcher for. */
  attempted: number;
  sent: number;
  nothingDue: number;
  alreadyClaimed: number;
  failed: number;
  /** `considered - attempted`. Named rather than left to arithmetic
   * because it is the number that says somebody was skipped, and a
   * skipped person gets no email at all today. */
  notAttempted: number;
  stopped: RunStop | null;
  outcomes: RecipientOutcome[];
};

/**
 * The default time budget, in milliseconds.
 *
 * A scheduled function is killed at its platform limit, and a kill lands
 * WHEREVER it lands — which, for this dispatcher, can be between claiming
 * a notice and sending it. That is the one state the ledger cannot undo:
 * the milestone is spent and no email exists. Stopping cleanly between two
 * people cannot produce it, so the loop stops itself early rather than
 * letting the platform stop it late.
 *
 * The route sets `maxDuration` to 60s; this leaves room to finish the
 * person in flight and write the response.
 */
export const DEFAULT_RUN_BUDGET_MS = 45_000;

/**
 * Longest-unnotified first.
 *
 * The order only shows when a run cannot finish — and then it is the whole
 * difference between "today's tail waits until tomorrow" and "the same
 * people are never reached, ever". Ordering by id, or by creation, starves
 * the same tail every single night, silently, and the milestone ledger
 * makes that permanent: a rung nobody was there to fire still passes.
 *
 * Never dispatched to at all comes first — a new colleague has the most to
 * be told and the least chance of having been told it. Then oldest
 * dispatch first. Then id, so the order is TOTAL: two people with
 * identical timestamps must not swap places between two runs, or a
 * budget-truncated run cuts the list in a different place each night.
 */
export function orderRecipients(
  recipients: RunRecipient[],
  lastSentAt: ReadonlyMap<string, Date | null>,
): RunRecipient[] {
  // Absent from the map and present-as-null are the same fact — nobody has
  // ever been sent anything — because `groupBy` returns no row for a user
  // with no dispatches at all. Both must read as "never", never as the
  // epoch: that happens to sort the same way today, and would stop doing so
  // the moment "never" needed to mean anything else.
  const at = (recipient: RunRecipient): number | null =>
    lastSentAt.get(recipient.id)?.getTime() ?? null;

  return [...recipients].sort((a, b) => {
    const aAt = at(a);
    const bAt = at(b);
    if (aAt === null && bAt !== null) return -1;
    if (aAt !== null && bAt === null) return 1;
    if (aAt !== null && bAt !== null && aAt !== bAt) return aAt - bAt;
    return a.id.localeCompare(b.id);
  });
}

/** The app's own origin, for the links inside a scheduled email.
 *
 * FROM CONFIGURATION, NEVER FROM A REQUEST, and the docstring on
 * `originFromRequest` in `lib/actions/notifications.ts` says why at
 * length. Short version: that helper reads `x-forwarded-host`, which is
 * something the caller controls, and it is harmless there only because the
 * button mails the person who clicked it. This run mails OTHER PEOPLE. A
 * host taken from whatever request happened to trigger the cron would put
 * that host in the links of everybody's email.
 *
 * Returns null rather than a default when unset. There is no safe guess:
 * the wrong origin is a working-looking email whose every link goes
 * somewhere else, which is worse than no email. The caller fails closed.
 *
 * Only the origin survives — a value with a path (`https://app…/alerts`,
 * an easy thing to paste into a settings field) is reduced to its origin,
 * since `digestBody` appends its own paths.
 */
export function configuredBaseUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.host) return null;
  return `${url.protocol}//${url.host}`;
}

/**
 * Mails everybody, in order, and reports what happened to each.
 *
 * **NO ONE PERSON CAN END THE RUN**, except the one condition below that
 * would end it identically for everybody. A thrown Prisma error, a
 * provider timeout, an address the provider refuses — each is that
 * person's outcome and nothing more. The alternative is what this loop
 * exists to avoid: the first bad address in a company stops every send
 * behind it, and because the ledger has already spent nothing for them,
 * nobody notices anything except that the emails stopped.
 *
 * The exception is an unconfigured email provider. `dispatchAlertDigest`
 * checks that BEFORE claiming anything and reports it as `unconfigured`,
 * so it is the one failure that consumes nothing — and it will be the
 * identical answer for every remaining person, because it is about the
 * deployment, not about them. Continuing would produce a report of two
 * hundred identical lines that hides the one fact worth reading. Stopping
 * costs nothing: no milestone was spent, so tomorrow's run says everything
 * today's would have.
 */
export async function runDigests(options: {
  recipients: RunRecipient[];
  dispatch: (recipient: RunRecipient) => Promise<DispatchOutcome>;
  /** Injected so the budget is testable without waiting for it. */
  now?: () => number;
  budgetMs?: number;
}): Promise<RunReport> {
  const { recipients, dispatch } = options;
  const now = options.now ?? (() => Date.now());
  const budgetMs = options.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const startedAt = now();

  const outcomes: RecipientOutcome[] = [];
  let stopped: RunStop | null = null;

  for (const recipient of recipients) {
    // Checked BEFORE starting somebody, never during. A person half sent
    // to is the state the ledger cannot describe.
    if (now() - startedAt >= budgetMs) {
      stopped = "time-budget";
      break;
    }

    let outcome: DispatchOutcome;
    try {
      outcome = await dispatch(recipient);
    } catch (error) {
      outcomes.push({
        userId: recipient.id,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!outcome.ok) {
      outcomes.push({
        userId: recipient.id,
        result: "failed",
        error: outcome.error,
      });
      if ("unconfigured" in outcome && outcome.unconfigured) {
        stopped = "email-not-configured";
        break;
      }
      continue;
    }

    if (outcome.sent) {
      outcomes.push({
        userId: recipient.id,
        result: "sent",
        noticeCount: outcome.noticeCount,
      });
      continue;
    }

    outcomes.push({ userId: recipient.id, result: outcome.reason });
  }

  const count = (result: RecipientOutcome["result"]) =>
    outcomes.filter((outcome) => outcome.result === result).length;

  return {
    considered: recipients.length,
    attempted: outcomes.length,
    sent: count("sent"),
    nothingDue: count("nothing-due"),
    alreadyClaimed: count("already-claimed"),
    failed: count("failed"),
    notAttempted: recipients.length - outcomes.length,
    stopped,
    outcomes,
  };
}
