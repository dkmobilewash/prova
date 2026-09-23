import { prisma } from "@prova/db";
import { MIGRATE_COMMAND } from "./usage";

/**
 * THE PAID MONTHLY AI ALLOWANCE, AND THE HARD STOP AT THE END OF IT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS FILE FAILS CLOSED. `lib/ask/usage.ts` FAILS OPEN. BOTH ARE RIGHT.
 * ────────────────────────────────────────────────────────────────────────
 *
 * They are two different ceilings answering two different questions, and
 * the split is the whole point of this module rather than an inconsistency
 * to be tidied away later:
 *
 *   - `askAllowance` in usage.ts is a COURTESY limit — 60 questions per
 *     person per hour, 500 per company per day — there to stop a runaway
 *     loop. When it cannot be read it lets the question through and shouts
 *     about it, because #257 proved the alternative: a database one
 *     migration behind took the entire assistant down behind a sentence
 *     that named nothing. The worst case of answering unbounded there is a
 *     bigger bill, paid by us.
 *   - THIS is a ceiling somebody has PAID FOR. C Stream is sold at a fixed
 *     monthly price with an allowance attached, and a cap that answers
 *     unbounded when it cannot check itself is not a cap — it is an
 *     unmetered spend surface wearing one, and the customer's own bill is
 *     the thing on the other side of it. So when this cannot be read the
 *     question is REFUSED, in a sentence that says what happened.
 *
 * Same trade as `lib/outbound-email-limit.ts`, which broke from
 * `askAllowance` for the same shape of reason and says so in its own
 * header. Read the three together before changing any of them.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE UNIT IS CLAIMED BEFORE THE MODEL CALL, NEVER RECORDED AFTER IT.
 * ────────────────────────────────────────────────────────────────────────
 *
 * `recordAskUsage` writes its row when the loop reports its totals, and
 * swallows the write failure on purpose — the answer has already streamed
 * and bookkeeping must not cost somebody their answer. For a courtesy limit
 * that is exactly right. For a paid cap it is a hole you can drive through:
 * a process that dies mid-stream has spent the money and written no row, so
 * the next question is free, and a client that hangs up on every request
 * pays for nothing at all.
 *
 * So the question and its pages are CLAIMED first, in one conditional
 * statement, and the model is only called if the claim succeeded. If the
 * call then fails, the claim is MARKED and NOT RELEASED —
 * `markAskAllowanceFailure`. Why marked rather than released:
 *
 *   1. A released unit makes the cap defeatable by inducing failures,
 *      which is the exact surface reserving up front exists to close.
 *   2. The provider bills the tokens of a stream that died halfway. The
 *      money is usually already gone.
 *   3. A mark is what makes a HUMAN credit possible: the owner sees on
 *      /settings/assistant that the month included failed questions and
 *      can ask for them back. Nothing here adjusts an allowance by itself.
 *
 * ────────────────────────────────────────────────────────────────────────
 * A CLAIM LEDGER ROW, NOT A COUNT OF ROWS.
 * ────────────────────────────────────────────────────────────────────────
 *
 * CLAUDE.md's counter section is the reason. Anything derived from
 * SURVIVING ROWS is reissued when a row is deleted — the `max(n)+1` scar —
 * and "nothing deletes AskUsage today" is the same sentence that let
 * invoice numbering stay broken for a year. A count of rows also cannot
 * reserve anything, because the row does not exist until after the spend,
 * and pages are not rows at all.
 *
 * `AskAllowancePeriod` (packages/db/prisma/schema/ask-allowance.prisma) is
 * therefore one row per company per UTC calendar month whose figures only
 * ever increment. It is NOT a sequence counter — it issues no numbers,
 * nothing is unique on its value, and it is deliberately not named
 * `*Counter` — so it is not part of `counterCensus.test.ts`'s roll-call. It
 * is company-scoped with no `jobId`, so it is not a RESTRICT child of `Job`
 * and the scratch cleanup scripts, which delete under `Job` and `Contact`
 * and never touch `Company`, have nothing to add. `AskUsage` sits in
 * exactly the same position for exactly the same reason.
 *
 * Rollover is a NEW ROW, never a reset in place: next month is a different
 * `periodStart`. Zeroing a period would be issue #148 — a retired number
 * reissued — wearing a usage meter.
 *
 * ────────────────────────────────────────────────────────────────────────
 * NOTHING HERE EVER CHARGES MONEY.
 * ────────────────────────────────────────────────────────────────────────
 *
 * There is no Stripe in this app and this change does not add one. At the
 * stop the person is told what ran out, when it comes back, and who to ask.
 * No overage is billed, nothing silently degrades to a cheaper model, and
 * no allowance is topped up automatically. The one seam where a plan or a
 * prepaid pack would go is `allowanceForCompany` below, and it says what it
 * would need.
 */

/**
 * What one company may use in a month. The figures Cyrus is selling at
 * $399/month: roughly 300 questions and 300 document pages.
 *
 * COMPANY-SCOPED, not per person, because that is what is being sold — a
 * company buys the seat count it needs and the allowance is the business's.
 * A per-person split of it is a product decision nobody has made, and
 * inventing one here would put a limit on a foreman that no invoice
 * mentions.
 */
export const ASK_MONTHLY_ALLOWANCE = {
  /** Questions one company may send the model in a calendar month. */
  questions: 300,
  /** Document pages one company may send the model in a calendar month. */
  pages: 300,
} as const;

export type MonthlyAllowance = { questions: number; pages: number };

/**
 * THE PLAN SEAM. Today every company gets the same allowance.
 *
 * This is the one function a plan, a tier or a prepaid pack has to change,
 * and it is async already so that becoming a database read later is not a
 * signature change rippling through every caller. What such a change would
 * need, written down so the next person does not have to infer it:
 *
 *   - somewhere to read the company's plan from. There is no Stripe, no
 *     subscription and no plan column in this schema; adding one is its
 *     own decision and its own PR.
 *   - a rule for a pack that spans a period boundary, since the ledger row
 *     is keyed on the month. The likely shape is a second additive figure
 *     on the period row rather than a bigger cap, so that what was bought
 *     and what was included stay separately readable.
 *   - a decision about what happens at the stop for a company that COULD
 *     buy more. This file will not make that decision by itself: the
 *     product promise is a hard stop and never an auto-billed overage, so
 *     the most a paid tier may do here is raise the number a person is
 *     told about, never charge them for passing it.
 */
export async function allowanceForCompany(_companyId: string): Promise<MonthlyAllowance> {
  return { ...ASK_MONTHLY_ALLOWANCE };
}

/** Midnight UTC on the first of the month `now` falls in. */
export function periodStartFor(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Midnight UTC on the first of the NEXT month — when the allowance comes
 * back. `Date.UTC` rolls month 12 into January of the next year itself, so
 * December needs no special case. */
export function periodResetsAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "1 October" — the date a person is told the allowance comes back. No
 * year unless the reset crosses one, which is the only time it helps. */
export function resetSentence(now: Date): string {
  const at = periodResetsAt(now);
  const sameYear = at.getUTCFullYear() === now.getUTCFullYear();
  return `1 ${MONTHS[at.getUTCMonth()]}${sameYear ? "" : ` ${at.getUTCFullYear()}`}`;
}

/** What was claimed, so the same units can be marked if the call fails. */
export type AllowanceClaim = {
  companyId: string;
  periodStart: Date;
  questions: number;
  pages: number;
};

export type AllowanceClaimResult =
  | { ok: true; claim: AllowanceClaim; left: { questions: number; pages: number } }
  | { ok: false; error: string };

/** What one ask wants to claim. `pages` is 0 on a question with no file. */
export type AllowanceRequest = { questions: number; pages: number };

/**
 * The sentence when the accounting itself cannot be read.
 *
 * Deliberately NOT the one #257 was blamed for. That refusal named nothing
 * and pointed nowhere; this one says what happened, that nothing was
 * charged, and what to do. The log line beside it names the migration
 * command — a person reading a phone should not be handed a shell command,
 * and an owner reading /settings/assistant is, because that page says it in
 * full.
 */
const UNREADABLE =
  "We couldn't check your company's monthly AI allowance just now, so this question wasn't sent to the assistant. " +
  "Nothing has been charged. Try again in a few minutes — if it keeps happening, contact C Stream.";

function unreadable(what: string, err: unknown): void {
  console.error(
    `[ask] ${what}: the monthly allowance ledger could not be read or written, so the question was REFUSED ` +
      `rather than answered unbounded — this cap fails closed, unlike the hourly and daily limits in ` +
      `lib/ask/usage.ts. If this database is behind the code, \`${MIGRATE_COMMAND}\` fixes it.`,
    err,
  );
}

/**
 * The stop. What ran out, when it comes back, who to ask — and that
 * nothing has been billed, said out loud rather than left to be assumed.
 *
 * Both ceilings are named when both are gone, because being told about the
 * questions and then hitting the pages two minutes later is the support
 * call this sentence exists to prevent.
 */
function stopSentence(
  allowance: MonthlyAllowance,
  used: { questionsUsed: number; pagesUsed: number },
  want: AllowanceRequest,
  now: Date,
): string {
  const outOfQuestions = used.questionsUsed + want.questions > allowance.questions;
  const outOfPages = used.pagesUsed + want.pages > allowance.pages;
  const pagesLeft = Math.max(0, allowance.pages - used.pagesUsed);

  const parts: string[] = [];
  if (outOfQuestions) {
    parts.push(
      `your company has used ${used.questionsUsed} of its ${allowance.questions} assistant questions for this month`,
    );
  }
  if (outOfPages) {
    parts.push(
      want.pages > allowance.pages
        ? `that file is ${want.pages} pages and the whole monthly allowance is ${allowance.pages}`
        : `this file needs ${want.pages} document ${want.pages === 1 ? "page" : "pages"} and only ` +
          `${pagesLeft} of this month's ${allowance.pages} ${pagesLeft === 1 ? "is" : "are"} left`,
    );
  }
  // Belt and braces: a claim can only fail because one of the two is out,
  // but a sentence that names nothing is the #257 defect and must not be
  // reachable by arithmetic nobody re-checked.
  if (parts.length === 0) {
    parts.push(`your company has reached its monthly assistant allowance`);
  }

  return (
    `That wasn't sent — ${parts.join(", and ")}. Nothing extra has been charged and nothing will be: ` +
    `the allowance starts again on ${resetSentence(now)}. If you need more before then, ask your account ` +
    `owner to contact C Stream.`
  );
}

/**
 * Claim `want` against this company's month, or refuse.
 *
 * ATOMIC BY THE STATEMENT, NOT BY A READ-THEN-WRITE. The claim is one
 * conditional `updateMany`:
 *
 *     UPDATE "AskAllowancePeriod"
 *        SET "questionsUsed" = "questionsUsed" + $n, "pagesUsed" = "pagesUsed" + $p
 *      WHERE "companyId" = … AND "periodStart" = …
 *        AND "questionsUsed" <= cap - $n AND "pagesUsed" <= cap - $p
 *
 * Under Postgres READ COMMITTED, two concurrent asks for the last unit
 * cannot both match: the second statement blocks on the first's row lock
 * and then re-evaluates its WHERE against the newly committed values, so it
 * updates zero rows and is refused. `count === 0` is therefore the refusal
 * and there is no window between checking and claiming for the other one to
 * fit through. That is the `InvoiceCounter` collision (#224) prevented by
 * construction rather than caught afterwards by a unique index — and it is
 * why nothing here reads the row first and decides in JavaScript.
 */
export async function claimAskAllowance(
  companyId: string,
  want: AllowanceRequest,
  now: Date = new Date(),
): Promise<AllowanceClaimResult> {
  const allowance = await allowanceForCompany(companyId);
  const periodStart = periodStartFor(now);
  try {
    // The period row for this month, created on first use. Two questions
    // arriving together race here too; the unique index decides, and P2002
    // means the other one won, which is a success for us — the row exists.
    try {
      await prisma.askAllowancePeriod.upsert({
        where: { companyId_periodStart: { companyId, periodStart } },
        create: { companyId, periodStart },
        update: {},
      });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code !== "P2002") throw err;
    }

    const claimed = await prisma.askAllowancePeriod.updateMany({
      where: {
        companyId,
        periodStart,
        questionsUsed: { lte: allowance.questions - want.questions },
        pagesUsed: { lte: allowance.pages - want.pages },
      },
      data: {
        questionsUsed: { increment: want.questions },
        pagesUsed: { increment: want.pages },
      },
    });

    const row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart } },
      select: { questionsUsed: true, pagesUsed: true },
    });
    // Only reachable if the row vanished between two statements, which
    // nothing in this app does. Refused rather than assumed, because the
    // assumption is the one that spends money.
    if (!row) {
      unreadable("the allowance period row disappeared mid-claim", null);
      return { ok: false, error: UNREADABLE };
    }

    if (claimed.count === 0) {
      return {
        ok: false,
        error: stopSentence(allowance, row, want, now),
      };
    }
    return {
      ok: true,
      claim: { companyId, periodStart, questions: want.questions, pages: want.pages },
      left: {
        questions: Math.max(0, allowance.questions - row.questionsUsed),
        pages: Math.max(0, allowance.pages - row.pagesUsed),
      },
    };
  } catch (err) {
    unreadable("the monthly allowance could not be claimed", err);
    return { ok: false, error: UNREADABLE };
  }
}

/**
 * The model call that followed a claim failed. MARK IT — never release it.
 *
 * The header says why at length. In short: releasing would let anybody
 * defeat the cap by making calls fail, the tokens of a half-finished
 * stream are billed anyway, and this figure is what lets an owner ask a
 * human for a credit. It is bookkeeping AFTER the fact, so — unlike the
 * claim itself — a failure to write it is logged and swallowed: the claim
 * already stands, which is the conservative direction.
 */
export async function markAskAllowanceFailure(claim: AllowanceClaim): Promise<void> {
  try {
    await prisma.askAllowancePeriod.updateMany({
      where: { companyId: claim.companyId, periodStart: claim.periodStart },
      data: {
        failedQuestions: { increment: claim.questions },
        failedPages: { increment: claim.pages },
      },
    });
  } catch (err) {
    console.error("[ask] allowance failure not marked; the claim stands", err);
  }
}

export type AllowanceSummary = {
  /**
   * False when the ledger could not be read. The page must NOT print zeros
   * then — "0 used" is what an untouched month looks like — and it must say
   * that this cap fails closed, because while it is unreadable the box is
   * refusing every question rather than answering unbounded. That is the
   * opposite of what the usage section above it says about the hourly and
   * daily limits, and an owner comparing the two needs both to be true.
   */
  readable: boolean;
  allowance: MonthlyAllowance;
  questionsUsed: number;
  pagesUsed: number;
  failedQuestions: number;
  failedPages: number;
  questionsLeft: number;
  pagesLeft: number;
  /** "1 October" — when this month's figures go back to zero. */
  resetsOn: string;
  /** Either ceiling is down to a fifth or less. The warning threshold, kept
   * here rather than in the page so the sentence and the number cannot
   * drift apart. */
  low: boolean;
};

/** A quarter is comfortable, a tenth is too late to react to. A fifth of a
 * 300-question month is 60 questions, which is about a week's use. */
const LOW_FRACTION = 0.2;

/** This month's figures for /settings/assistant. Reads only. */
export async function allowanceSummary(
  companyId: string,
  now: Date = new Date(),
): Promise<AllowanceSummary> {
  const allowance = await allowanceForCompany(companyId);
  const empty = {
    allowance,
    questionsUsed: 0,
    pagesUsed: 0,
    failedQuestions: 0,
    failedPages: 0,
    questionsLeft: allowance.questions,
    pagesLeft: allowance.pages,
    resetsOn: resetSentence(now),
  };
  let row: {
    questionsUsed: number;
    pagesUsed: number;
    failedQuestions: number;
    failedPages: number;
  } | null;
  try {
    row = await prisma.askAllowancePeriod.findUnique({
      where: { companyId_periodStart: { companyId, periodStart: periodStartFor(now) } },
      select: { questionsUsed: true, pagesUsed: true, failedQuestions: true, failedPages: true },
    });
  } catch (err) {
    unreadable("the allowance figures could not be read for the settings page", err);
    return { ...empty, readable: false, low: false };
  }
  // No row is not a failure: it is a month nobody has asked anything in.
  if (!row) return { ...empty, readable: true, low: false };

  const questionsLeft = Math.max(0, allowance.questions - row.questionsUsed);
  const pagesLeft = Math.max(0, allowance.pages - row.pagesUsed);
  return {
    readable: true,
    allowance,
    questionsUsed: row.questionsUsed,
    pagesUsed: row.pagesUsed,
    failedQuestions: row.failedQuestions,
    failedPages: row.failedPages,
    questionsLeft,
    pagesLeft,
    resetsOn: resetSentence(now),
    low:
      questionsLeft <= allowance.questions * LOW_FRACTION ||
      pagesLeft <= allowance.pages * LOW_FRACTION,
  };
}
