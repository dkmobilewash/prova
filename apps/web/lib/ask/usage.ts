import { prisma } from "@prova/db";
import type { AskUsageTotals } from "@prova/integrations";

/**
 * What the Ask box costs, and how much of it one person or one company
 * may use.
 *
 * Every question that reaches the model writes one AskUsage row when the
 * loop reports its totals (ask.prisma). The row is the bound: before a
 * question goes to the model, `askAllowance` counts the rows in a rolling
 * hour for the person and a rolling day for the company and refuses in a
 * sentence when either is at its limit. Rows rather than tokens, so a
 * question that fails is bounded exactly like one that answers — a loop
 * hammering the route with a bad key is the case this exists for.
 *
 * The bound is not a PRECONDITION, though, and that distinction cost the
 * whole assistant once (#257): when the rows cannot be read at all, the
 * question goes through and the failure is shouted into the log and onto
 * the settings page, rather than the box refusing everything behind a
 * sentence that names nothing. See askAllowance.
 *
 * THE LIMITS ARE A JUDGMENT CALL, not a derived fact. A foreman asks the
 * box a handful of times a day; an office manager on invoice day maybe
 * thirty. Sixty an hour per person is far above either and far below what
 * a runaway agent produces; five hundred a day per company bounds the
 * bill at roughly the cost of a lunch. Both are one constant to retune.
 *
 * THESE TWO ARE A COURTESY, AND THEY ARE NOT THE PAID ALLOWANCE. The
 * monthly cap a customer has actually bought — questions AND document
 * pages, company-scoped, a hard stop — lives in `lib/ask/allowance.ts`,
 * on its own table, and it FAILS CLOSED where these fail open. The split
 * is deliberate rather than an inconsistency waiting to be tidied:
 * answering unbounded when THIS check breaks costs us a slightly larger
 * model bill, which #257 proved is the lesser fault; answering unbounded
 * when the PAID cap breaks is an unmetered spend surface on something a
 * customer pays a fixed price for. Anyone changing the fail-open below
 * should read that file's header first, and anyone tempted to merge the
 * two should read it twice.
 */
export const ASK_LIMITS = {
  /** Questions one person may send the model in a rolling hour. */
  perPersonPerHour: 60,
  /** Questions one company may send the model in a rolling day. */
  perCompanyPerDay: 500,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The command that brings a database level with the code. Named in the
 * log and on the settings page rather than left to be looked up: #257 was
 * found by someone clicking a retainage command and being told
 * "Something went wrong reading your data", which pointed at neither the
 * schema nor the fix.
 */
export const MIGRATE_COMMAND = "pnpm --filter @prova/db run migrate:deploy";

/** Prisma's code for "the table does not exist in the current database" —
 * a database behind the code, as distinct from a query that is wrong. */
function tableIsMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2021";
}

/**
 * One log line for "the accounting could not be read", loud and naming the
 * fix. Ids and causes only, never the question.
 */
function usageUnreadable(what: string, err: unknown): void {
  const cause = tableIsMissing(err)
    ? `the AskUsage table does not exist in this database, so it is behind the code. Run \`${MIGRATE_COMMAND}\` against it.`
    : `AskUsage could not be read. If this database is behind the code, \`${MIGRATE_COMMAND}\` fixes it.`;
  console.error(`[ask] ${what}: ${cause}`, err);
}

export type Allowance = { ok: true } | { ok: false; error: string };

export async function askAllowance(companyId: string, userId: string, now: Date = new Date()): Promise<Allowance> {
  // `feature: "ask"` is load-bearing rather than tidy. These two ceilings are
  // about how many QUESTIONS a person may ask, and since 2026-09-14 this
  // table also holds compliance extractions, WIP narratives and estimate
  // drafts. Without the filter, uploading four compliance documents would
  // silently cost somebody four of their hourly questions — a limit tightening
  // itself as a side effect of a metering change nobody connected to it.
  //
  // Bounding those three is a real and separate problem: the audit that found
  // them put compliance extraction at $2.25-$4.50 a call, which a ROW count is
  // the wrong instrument for. That wants a spend ceiling, and it is not this.
  let person: number;
  let company: number;
  try {
    [person, company] = await Promise.all([
      prisma.askUsage.count({
        where: { userId, feature: "ask", createdAt: { gte: new Date(now.getTime() - HOUR) } },
      }),
      prisma.askUsage.count({
        where: { companyId, feature: "ask", createdAt: { gte: new Date(now.getTime() - DAY) } },
      }),
    ]);
  } catch (err) {
    // FAILS OPEN, and the reason is three functions down: recordAskUsage
    // already swallows its own write failure, because the accounting must
    // not cost the person their answer. The READ was not extended the
    // same courtesy, so a database one migration behind took the whole
    // assistant down behind a sentence that named nothing (#257) — every
    // question calls this, so a missing table is not one broken command,
    // it is the feature. Answering unbounded is the lesser fault: this is
    // an internal accounting table, and the alternative is the product
    // not working.
    //
    // Said plainly because it is a real cost, not a free win: while this
    // is failing, NOTHING is bounding the model calls. That is why the
    // line below is console.error rather than a warning, and why the
    // settings page says so on screen instead of printing a reassuring
    // zero.
    //
    // Note the two now compose: a database that has AskUsage but not yet
    // its `feature` column lands here too, which is the correct outcome —
    // the question is answered rather than refused by a schema gap.
    usageUnreadable("the limit check could not run, so this question went to the model unbounded", err);
    return { ok: true };
  }
  if (person >= ASK_LIMITS.perPersonPerHour) {
    return {
      ok: false,
      error: `You've asked ${ASK_LIMITS.perPersonPerHour} questions in the last hour, which is the limit. Give it a few minutes.`,
    };
  }
  if (company >= ASK_LIMITS.perCompanyPerDay) {
    return {
      ok: false,
      error: `Your company has asked ${ASK_LIMITS.perCompanyPerDay} questions in the last day, which is the limit. It frees up as the day rolls on.`,
    };
  }
  return { ok: true };
}

/** "answered", a card ("proposal"), chips ("clarify"), or the loop's own
 * failure reason. Stored as a string so a new reason needs no migration. */
export type AskUsageOutcome = "answered" | "proposal" | "clarify" | `error:${string}`;

/**
 * The outcome written when the number-provenance guard holds an answer back
 * (lib/ask/provenance.ts).
 *
 * A STRING IN AN EXISTING COLUMN RATHER THAN A NEW TABLE, deliberately.
 * `outcome` is free-form precisely so a new reason needs no migration, and
 * this is exactly that case. It buys the RATE — how often the guard fires,
 * on /settings/assistant, which is the figure that decides whether anybody
 * trusts it — with no schema change and nothing for the demo database to
 * drift behind.
 *
 * What it does NOT buy is the detail. The offending figure and the question
 * go to the runtime log and nowhere else; storing a figure the app has just
 * decided it cannot vouch for, in a table an owner reads, would be putting
 * the untraceable number back on a screen by another route. If the rate
 * turns out to be worth investigating case by case, that is a table and a
 * migration and a decision, not a column quietly repurposed.
 */
export const PROVENANCE_OUTCOME: AskUsageOutcome = "error:number_provenance";

/**
 * Which model caller a row is.
 *
 * Until 2026-09-14 this table held Ask and nothing else, while three other
 * callers in `packages/integrations/src/anthropic.ts` spent money silently —
 * so `/settings/assistant` reported a number that was not the bill.
 *
 * A union rather than a free string, unlike `outcome`: `outcome` carries a
 * model-supplied reason and must not need a migration to gain one, but the
 * set of model CALLERS is a fact about this codebase that somebody has to
 * add code to change. Adding a caller should make the compiler ask which
 * feature it is.
 */
export type AskUsageFeature =
  | "ask"
  | "wip-narrative"
  | "compliance-extract"
  /** Reading a sub's quote document (lib/actions/quoteRead.ts). Its own row
   *  rather than folded into `compliance-extract`, even though both are one
   *  whole file into one request and both claim the SAME page ledger: they are
   *  switched separately, so a bill that could not tell them apart could not
   *  answer "what did the thing we turned off actually cost us". */
  | "quote-extract"
  | "draft-estimate-lines"
  /** The public-web lookup behind "start a bid" (lib/ask/commands/
   *  estimating.ts). Its own row, because web search is billed per search
   *  on top of tokens and would otherwise hide inside an Ask row. */
  | "bid-research"
  /** One lead-search pass (lib/ask/commands/leads.ts, bound in
   *  lib/ask/leadFinder.ts): the public-web search for projects out to
   *  bid. Its own row for the same reason as bid-research — web search
   *  bills per search on top of tokens — and because the spec that built
   *  it replaces its cost ESTIMATE with what these rows and the log line
   *  below measure, before any scheduling decision is made. Not "ask", so
   *  a pass never costs a person one of their hourly questions. */
  | "lead-search"
  /** One sheet's title block, read during plan-set ingestion
   *  (lib/plan-ingest/titleBlock.ts). Its own row rather than folded into
   *  `compliance-extract` or `quote-extract`, because it spends a DIFFERENT
   *  LEDGER: plan sheets are metered on `AskAllowancePeriod.planSheetsUsed`
   *  against a 1,500-a-month ceiling, not on the 300 document pages the other
   *  two share. A bill that could not tell them apart could not answer the
   *  question this feature exists to make answerable — what a plan set costs to
   *  ingest — which `docs/ai/DECISIONS.md` records as unmeasured. And the rows
   *  are the measurement: hundreds per set, so they are the first place in this
   *  app where per-feature spend is a volume question rather than a unit price. */
  | "plan-ingestion"
  /** Reading a bid addendum (lib/actions/addendumRead.ts). Its own row rather
   *  than folded into `quote-extract`, though both are one whole file into one
   *  request: they are switched separately and they spend DIFFERENT ledgers — a
   *  quote costs document pages, an addendum costs addendum pages — so a bill
   *  that could not tell them apart could not answer either "what did the thing
   *  we turned off cost us" or "which allowance did this month go on". */
  | "addendum-read"
  /** Reading ONE spec section for what it demands that costs money
   *  (`lib/actions/specRead.ts`). Its own row rather than folded into
   *  `addendum-read`, though both are bid documents arriving on a bid nobody
   *  has won: a section is thirty pages against a letter's eight, they are
   *  switched separately, and they spend DIFFERENT ledgers — so a bill that
   *  could not tell them apart could not answer either "what did the thing we
   *  turned off cost us" or "which allowance did this month go on". */
  | "spec-read";

export type AskUsageRecord = {
  companyId: string;
  /** Nullable because the column is: a model call is not guaranteed to have
   *  a person behind it. Every caller today does pass one. */
  userId: string | null;
  model: string;
  usage: AskUsageTotals;
  outcome: AskUsageOutcome;
  /** Defaults to "ask" so every existing call site is unchanged. */
  feature?: AskUsageFeature;
  /**
   * The job this spend belongs to, when there is one.
   *
   * WHY IT IS WORTH HAVING, and it is not book-keeping: the first question
   * anybody asks about an AI bill is "which jobs is this going on", and until
   * now nothing could answer it — every row was company-wide, so a job whose
   * drawings were read three times looked exactly like one nobody touched.
   * Step 0 of the AI plan, at Diego's request.
   *
   * A PLAIN COLUMN, DELIBERATELY NOT A FOREIGN KEY (ask.prisma says so too).
   * This table is an append-only spend ledger; a job deleted by the scratch
   * cleanup must not take its billing history with it, and `ON DELETE SET
   * NULL` would erase the attribution rather than keep it. What was spent is a
   * fact about the past.
   *
   * Absent for the calls that genuinely have no job — a lead search, a bid
   * research pass on a project that is not a job yet, a question about the
   * whole company — which is why it is nullable rather than required.
   */
  jobId?: string | null;
  /**
   * Which version of the prompt produced this, once prompts are versioned.
   *
   * NOTHING SETS THIS YET, and that is recorded rather than hidden: the column
   * is here so that when a prompt changes, the rows written before and after
   * are TELLABLE APART — which is the whole basis of saying a change made
   * anything better. Retrofitting it would mean a migration and a month of
   * rows that cannot be attributed to either version. The prompts themselves
   * are versioned in the step that first changes one.
   */
  promptVersion?: string | null;
};

/**
 * Writes the row and one log line. A row that fails to write must not
 * cost the person their answer — the answer has already streamed — so the
 * failure is logged and swallowed here, deliberately, and the log line
 * goes out BEFORE the write so the runtime log carries the cost either
 * way. Ids only in the line; never the question.
 */
export async function recordAskUsage(record: AskUsageRecord): Promise<void> {
  const { usage } = record;
  const feature = record.feature ?? "ask";
  console.log("[ask] usage", {
    feature,
    companyId: record.companyId,
    userId: record.userId,
    model: record.model,
    // An id, like every other field here. Never a job NAME — the rule this
    // log line has followed since it was written is ids and counts only.
    jobId: record.jobId ?? null,
    outcome: record.outcome,
    passes: usage.passes,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    // Web searches bill per search on top of tokens. LOGGED AND NOT STORED,
    // deliberately: no AskUsage column fits a search count and this table's
    // own rule is that a new figure must not force a migration — the token
    // columns are token counts, `passes` is model calls, and abusing either
    // would corrupt what /settings/assistant reports. The runtime log is
    // the record until somebody decides a column is worth a migration; the
    // SPEND stays bounded either way, at ASK_WEB_SEARCH_MAX_USES per
    // question times the row limits above.
    webSearches: usage.webSearches ?? 0,
  });
  try {
    await prisma.askUsage.create({
      data: {
        feature,
        companyId: record.companyId,
        userId: record.userId,
        model: record.model,
        passes: usage.passes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        // THE FIFTH BILLED UNIT, and it was being dropped here. Web search
        // charges per search on top of tokens; the totals object has carried
        // the count since lead search shipped and this insert never took it,
        // so every searched pass has a row that understates what it cost.
        // `?? 0` because the field is optional on the totals type — a caller
        // that never enables web search has none, which is not the same as
        // zero searches on a caller that does, but both cost nothing.
        webSearches: usage.webSearches ?? 0,
        outcome: record.outcome,
        jobId: record.jobId ?? null,
        promptVersion: record.promptVersion ?? null,
      },
    });
  } catch (err) {
    console.error("[ask] usage row not written", err);
  }
}

export type UsageSummary = {
  /**
   * False when AskUsage could not be read. Every figure is then zero —
   * and zero is the dangerous answer here, because "0 questions sent to
   * the model" is exactly what a quiet month looks like. Without this
   * flag the page would report a broken table as a reassuring fact, which
   * is the same shape as every vacuous check this repo has paid for. The
   * page reads it and says which of the two it is looking at.
   */
  readable: boolean;
  /**
   * Ask questions only — the rows `askAllowance` counts, and therefore the
   * only figure the hourly and daily limits are about.
   *
   * SPLIT FROM `calls` BECAUSE THE PAGE PRINTED ONE AND MEANT THE OTHER.
   * The `feature` column arrived so the three non-Ask callers would stop
   * spending invisibly; the limit side was filtered to `ask` the same day
   * and the reading side was not. So the settings page summed all four
   * features, called the total "questions sent to the model", and printed
   * the Ask-only limits in the next clause — two numbers over different
   * row sets, touching, with nothing to say they were different. A company
   * running document extractions saw a question count it could not
   * reconcile against a limit those rows never counted toward.
   */
  questions: number;
  /** Every model call in the window, all features. This is the one that
   * maps to the Anthropic invoice, which is what the column was for. */
  calls: number;
  /**
   * Answers the number-provenance guard held back, out of `questions`.
   *
   * THE RATE IS THE POINT. A guard nobody can see the firing rate of is a
   * guard nobody trusts: at zero for a month it is either working or
   * broken, and those look identical from the outside; climbing, it is
   * either catching a real regression in the model's behaviour or refusing
   * good answers, and which one it is decides whether to tighten the rule
   * or the prompt. Neither question can be asked without this number.
   *
   * Counted from the same rows as everything else on that page, so the
   * figure and the limits cannot disagree about what a question is.
   */
  blockedAnswers: number;
  inputTokens: number;
  outputTokens: number;
  /** Per feature, so the bill can be attributed rather than just totalled.
   * An unrecognised feature keeps its raw name instead of being dropped —
   * a set that silently shrinks is this repo's most expensive shape. */
  byFeature: { feature: string; label: string; calls: number; tokens: number }[];
  byPerson: { who: string; calls: number; tokens: number }[];
};

/** Display names for the four known callers. Deliberately a lookup with a
 * fallback rather than an exhaustive Record: a feature added later must
 * still appear on the page, under its own name, rather than vanish. */
const FEATURE_LABELS: Record<string, string> = {
  ask: "Ask",
  "wip-narrative": "WIP narrative",
  "compliance-extract": "Document extraction",
  "quote-extract": "Quote reading",
  "draft-estimate-lines": "Estimate drafting",
  "bid-research": "Bid research (web)",
  "lead-search": "Lead search (web)",
  "plan-ingestion": "Plan sheet reading",
  "addendum-read": "Addendum reading",
  "spec-read": "Spec section reading",
};

/** The last thirty days for the settings page, grouped by who asked.
 * Counted in the database, named from the User rows that still exist. */
export async function usageSummary(companyId: string, now: Date = new Date()): Promise<UsageSummary> {
  const since = new Date(now.getTime() - 30 * DAY);
  // `.catch` rather than a try/catch around an annotated variable:
  // groupBy's return type is inferred from its argument, and annotating
  // the binding to hoist it out of a try block breaks that inference.
  // This also keeps the guard on exactly ONE call — a failure in the User
  // lookup below is not this defect and must still throw, since an
  // unreadable User means the person is not signed in and this page never
  // rendered.
  const groups = await prisma.askUsage
    .groupBy({
      // `outcome` is grouped BY rather than counted in a second query, so
      // the held-back figure comes off the same rows as the call and token
      // totals beside it. Everything below sums across groups already, so
      // splitting them further changes no other number on the page — which
      // is the whole reason this was cheaper than another round trip on a
      // page somebody opens to find out why the box is behaving oddly.
      by: ["userId", "feature", "outcome"],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    })
    .catch((err: unknown) => {
      usageUnreadable("the usage figures could not be read for the settings page", err);
      return null;
    });
  if (groups === null) {
    return {
      readable: false,
      questions: 0,
      calls: 0,
      blockedAnswers: 0,
      inputTokens: 0,
      outputTokens: 0,
      byFeature: [],
      byPerson: [],
    };
  }
  const ids = groups.map((g) => g.userId).filter((id): id is string => id !== null);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const tokensOf = (g: (typeof groups)[number]) =>
    (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0);

  // One row per person and per feature comes back, so both breakdowns fold
  // out of the same query rather than a second one.
  const perPerson = new Map<string, { who: string; calls: number; tokens: number }>();
  const perFeature = new Map<string, { feature: string; label: string; calls: number; tokens: number }>();
  for (const g of groups) {
    const who = (g.userId && nameOf.get(g.userId)) || "a removed account";
    const person = perPerson.get(who) ?? { who, calls: 0, tokens: 0 };
    person.calls += g._count._all;
    person.tokens += tokensOf(g);
    perPerson.set(who, person);

    const feature = perFeature.get(g.feature) ?? {
      feature: g.feature,
      label: FEATURE_LABELS[g.feature] ?? g.feature,
      calls: 0,
      tokens: 0,
    };
    feature.calls += g._count._all;
    feature.tokens += tokensOf(g);
    perFeature.set(g.feature, feature);
  }

  return {
    readable: true,
    questions: groups.reduce((n, g) => n + (g.feature === "ask" ? g._count._all : 0), 0),
    calls: groups.reduce((n, g) => n + g._count._all, 0),
    blockedAnswers: groups.reduce((n, g) => n + (g.outcome === PROVENANCE_OUTCOME ? g._count._all : 0), 0),
    inputTokens: groups.reduce((n, g) => n + (g._sum.inputTokens ?? 0), 0),
    outputTokens: groups.reduce((n, g) => n + (g._sum.outputTokens ?? 0), 0),
    byFeature: [...perFeature.values()].sort((a, b) => b.calls - a.calls),
    byPerson: [...perPerson.values()].sort((a, b) => b.calls - a.calls),
  };
}
