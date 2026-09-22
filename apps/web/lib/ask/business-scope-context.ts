import { hasNoScopeAnswers, type BusinessScopeAnswers } from "@/lib/businessScope";

/**
 * What kind of contractor is asking — the three onboarding answers, said to
 * the model in one short paragraph.
 *
 * WHY THIS EXISTS. A sub who files a pay application every month and runs
 * certified payroll on public jobs lives in a different week from one who
 * bills owners direct and has never seen a WH-347. Until now Ask could not
 * tell them apart, so every answer was written for the average of the two:
 * it would explain prevailing wage to somebody who has never touched it,
 * and explain nothing about it to somebody for whom it is Friday's chore.
 * The answers are already on the Company row (`/welcome`, lib/businessScope.ts);
 * this is the second thing they buy, after the nav filter.
 *
 * THIS IS CONTEXT FOR PHRASING AND RELEVANCE. IT IS NOT A FILTER, AND
 * NOTHING HERE MAY BECOME ONE. The onboarding screen's own copy promises
 * "nothing is removed for good: search and Ask can still reach anything" —
 * so a company that answered "no public work" still gets a full, real
 * answer about certified payroll, from the same tools, if they ask. That
 * promise is on screen where a contractor can read it, and this file is one
 * of the two places it could be broken (lib/businessScope.ts's own header
 * names the other). The paragraph below therefore says so to the model in
 * as many words, and `answer-business-scope.test.ts` pins that sentence
 * rather than trusting it to survive an edit.
 *
 * The mechanism is deliberately the SMALLEST one that could work: a string
 * in the per-request context block, alongside `accessContext` and
 * `pageContextSentence` in answer.ts. No tool is added, no tool is removed,
 * no tool's result changes, and the offered tool list is byte-identical for
 * every set of answers. There is nothing here for a later edit to turn into
 * a gate without deleting the file and writing a different one.
 *
 * Pure and DB-free, same as its neighbours: answers in, a paragraph or null
 * out. The answers themselves come off the Company row the session already
 * loaded (app/api/ask/route.ts), so this costs no database read.
 */

/**
 * One clause per answered question, in the words the question was asked in.
 *
 * NEGATIVES ARE PRINTED HERE, and that is the one way this differs from
 * `businessScopeLine` in lib/businessScope.ts, which prints affirmatives
 * only. That line is a summary a person reads about themselves, where "no"
 * clauses are noise. This paragraph is the opposite job: "does no public
 * work" is the single most useful thing the model can know, because it is
 * what stops a prevailing-wage aside from landing in an answer about
 * something else. A missing clause means unanswered, never "no".
 */
function clauses(answers: BusinessScopeAnswers): string[] {
  const parts: string[] = [];

  if (answers.contractingRelationship === "UNDER_GENERAL_CONTRACTORS") {
    parts.push("they work under general contractors");
  } else if (answers.contractingRelationship === "DIRECT_FOR_OWNERS") {
    parts.push("they contract direct for owners, not under GCs");
  } else if (answers.contractingRelationship === "BOTH") {
    parts.push("they work under general contractors on some jobs and direct for owners on others");
  }

  if (answers.doesPublicWork === true) parts.push("they take public / prevailing-wage work");
  else if (answers.doesPublicWork === false) parts.push("they take no public or prevailing-wage work");

  if (answers.filesMonthlyPayApps === true) parts.push("a GC makes them file a pay application every month to get paid");
  else if (answers.filesMonthlyPayApps === false) parts.push("they do not file monthly pay applications");

  return parts;
}

/**
 * The paragraph, or null when there is nothing to say.
 *
 * Null for an all-null company — someone who skipped the questions, or
 * whose company predates them — and that case is the COMMON one, not an
 * edge. It short-circuits on `hasNoScopeAnswers`, the same function the nav
 * filter and the profile line short-circuit on, so "skipped" and "signed up
 * before this existed" and "nav hides nothing" are one rule in one place
 * rather than three that can drift. For those companies `answer.ts` joins
 * nothing extra into the context and Ask behaves exactly as it did before
 * this file existed — asserted directly, by comparing the context string
 * against the one a no-scope request produces.
 *
 * Also null if every ANSWERED field somehow yields no clause, which cannot
 * happen today (every value of every field has a clause) but costs one line
 * to be safe about: an empty "HOW THIS COMPANY WORKS. ." is worse than
 * silence, and this is the same defensive shape `businessScopeLine` uses.
 */
export function businessScopeContext(answers: BusinessScopeAnswers): string | null {
  if (hasNoScopeAnswers(answers)) return null;
  const parts = clauses(answers);
  if (parts.length === 0) return null;

  return (
    `HOW THIS COMPANY WORKS. They told us when they signed up that ${parts.join("; ")}. ` +
    `Let that shape what you mention first and how you word it: do not explain a routine that is ` +
    `plainly part of their week, and do not write as though something they told us they never do is ` +
    `their normal chore. ` +
    `THIS NEVER LIMITS WHAT YOU ANSWER. It is not a filter: every tool is still offered and every ` +
    `question still gets a full, real answer from those tools. If they ask about something outside ` +
    `this shape — certified payroll at a company that does no public work — answer it properly. ` +
    `Never tell them a feature or a rule does not apply to them, and never say they do not do ` +
    `something. ` +
    `These answers are not facts about any job, invoice or person, and a tool result always wins.`
  );
}
