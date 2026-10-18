"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import {
  draftProposalClauses,
  PROPOSAL_CLAUSE_PROMPT_VERSION,
  type ClauseFactInput,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "@/lib/actions/shared";
import { loadProposalFacts } from "@/lib/estimating/proposal-facts-query";

/**
 * Drafting, accepting and dismissing the clauses a scope letter is missing.
 *
 * `lib/estimating/proposal-facts.ts` decides WHICH facts need answering;
 * `packages/integrations/src/proposalClauses.ts` writes the sentence. This is
 * the seam between them and the database, and the three rules it enforces are
 * the ones a prompt cannot:
 *
 *   - a clause reaches the LETTER only when somebody presses accept. Drafting
 *     writes `ProposalClauseDraft` rows and nothing else;
 *   - a fact already answered is never drafted again, in any status;
 *   - a drafted clause whose `factRef` is not one of the facts we sent is
 *     dropped by `parseDraftedClauses` before it gets here.
 *
 * Every action returns `ActionResult`, so a refusal is a sentence the form can
 * render — production redacts a thrown message to a digest.
 */

// THE SAME CAPABILITY THE PAGE GATES ON. `/jobs/[id]/proposal` requires
// MANAGE_ESTIMATING — "a proposal is a bid" — and
// `action-capability-guards.test.ts` refuses an action behind a guarded page
// that answers a different question. The first draft of this file used
// VIEW_JOB_COSTS, which asks whether somebody may SEE money rather than
// whether they may write a bid, and the census caught it.
// THE HOUSE SENTENCE, word for word, and not one of my own.
// `action-capability-guards.test.ts` recognises a capability refusal by
// matching /part of your job function/ — so a refusal phrased any other way
// reads to that census as NO REFUSAL AT ALL, and it caught this file saying
// "only editable by people who manage estimating" instead. That is the right
// catch for the right reason: the sentence is also what a person reads, and
// every other estimating action tells them the same thing in the same words.
const PROPOSALS_ONLY =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Draft a clause for every fact this letter is silent about.
 *
 * NOTHING IS WRITTEN TO THE PROPOSAL. The result is a queue of suggestions with
 * their citations, which is the whole difference between this and
 * `draft-lines.ts` — that one writes line items directly because a number on a
 * screen can be seen and changed, and an exclusion sent to a GC cannot.
 */
export async function draftProposalGapClauses(jobId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(PROPOSALS_ONLY);
  const { company } = context;

  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: company.id }, select: { id: true, name: true } });
  if (!job) return actionFail("That job is no longer in this company. Reload the page.");

  const facts = await loadProposalFacts(jobId, company.id);
  if (facts.length === 0) {
    // NOT AN ERROR, and the sentence says which of the two it is. "Nothing this
    // app can see" is doing real work here: it has never read the GC's scope
    // sheet, so an empty queue is not a complete letter.
    return actionFail(
      "There is nothing this app can see that your proposal is silent about. That is not the same as a complete letter — it has not read the GC's scope sheet.",
    );
  }

  // THE GATE BEFORE ANYTHING ELSE, so a company that has switched this off is
  // told no before a model call is prepared.
  const gate = await aiGate(company.id, "PROPOSAL_DRAFT");
  if (!gate.ok) return actionFail(gate.error);

  const input: ClauseFactInput[] = facts.map((fact) => ({
    kind: fact.kind,
    ref: fact.ref,
    summary: fact.summary,
    citation: fact.citation,
    priced: fact.priced,
  }));

  let drafted;
  try {
    drafted = await draftProposalClauses({
      facts: input,
      projectName: job.name,
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: context.id,
          feature: "proposal-draft",
          model: gate.model,
          // `proposal`: every clause is a suggestion somebody accepts or
          // rejects. Nothing is filed by the machine.
          outcome: "proposal",
          jobId,
          promptVersion: PROPOSAL_CLAUSE_PROMPT_VERSION,
          usage,
        }),
    });
  } catch {
    // The thrown text is not passed through: an SDK error can carry a request
    // URL or a key fragment, and this string is rendered on screen.
    return actionFail("The proposal writer could not finish. Try it again.");
  }

  if (drafted.clauses.length === 0) {
    return actionFail("The proposal writer returned no clauses. Try it again.");
  }

  // A citation travels with the clause rather than being looked up later: the
  // fact it came from may be re-read tomorrow and say something different, and
  // what the estimator accepted was THIS sentence against THIS quote.
  const citations = new Map(facts.map((fact) => [fact.ref, fact.citation]));
  const factKinds = new Map(facts.map((fact) => [fact.ref, fact.kind]));

  await prisma.proposalClauseDraft.createMany({
    data: drafted.clauses.map((clause) => ({
      companyId: company.id,
      jobId,
      kind: clause.kind,
      text: clause.text,
      factKind: factKinds.get(clause.factRef) ?? "SPEC_FINDING",
      factRef: clause.factRef,
      citation: citations.get(clause.factRef) ?? null,
      model: gate.model,
      promptVersion: PROPOSAL_CLAUSE_PROMPT_VERSION,
    })),
  });

  revalidatePath(`/jobs/${jobId}/proposal`);
  return actionOk;
}

/**
 * Accept a draft: it becomes a clause on this job's proposal.
 *
 * THE CLAUSE IS A SNAPSHOT, which is `proposals.prisma`'s own rule for the
 * library — "a clause already on a job's proposal is a snapshot and does not
 * move". So the text is copied rather than referenced, and editing the draft
 * afterwards changes nothing on the letter.
 *
 * `text` is taken from the FORM, not from the draft row, so an estimator who
 * corrected the wording gets what they typed. That is the point of a review
 * step.
 */
export async function acceptProposalDraft(draftId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(PROPOSALS_ONLY);
  const { company } = context;

  const draft = await prisma.proposalClauseDraft.findFirst({
    where: { id: draftId, companyId: company.id },
    select: { id: true, jobId: true, kind: true, text: true, status: true },
  });
  if (!draft) return actionFail("That draft is no longer on this job. Reload the page.");
  if (draft.status !== "PROPOSED") {
    return actionFail("That draft has already been dealt with. Reload the page to see where it went.");
  }

  const edited = String(formData.get("text") ?? "").trim();
  const text = edited.length > 0 ? edited : draft.text;

  // ONE TRANSACTION, because the two writes are one fact: a clause on the
  // letter whose draft still reads PROPOSED would be offered again, and a draft
  // marked accepted with no clause behind it is a fact the queue thinks is
  // answered and the letter does not mention. Either both or neither.
  const clause = await prisma.$transaction(async (tx) => {
    const created = await tx.jobProposalClause.create({
      data: { companyId: company.id, jobId: draft.jobId, kind: draft.kind, text },
      select: { id: true },
    });
    await tx.proposalClauseDraft.update({
      where: { id: draft.id },
      data: {
        status: "ACCEPTED",
        text,
        acceptedClauseId: created.id,
        acceptedByUserId: context.id,
        acceptedAt: new Date(),
      },
    });
    return created;
  });

  revalidatePath(`/jobs/${draft.jobId}/proposal`);
  return clause.id.length > 0 ? actionOk : actionFail("The clause could not be added. Try it again.");
}

/**
 * Dismiss a draft. The fact stays answered and is never proposed again.
 *
 * RECORDED RATHER THAN DELETED, and that is the whole design: an estimator who
 * decided a requirement does not belong on this letter should not be asked
 * again next time somebody presses draft. A deleted row would make this a nag.
 */
export async function dismissProposalDraft(draftId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(PROPOSALS_ONLY);
  const { company } = context;

  const draft = await prisma.proposalClauseDraft.findFirst({
    where: { id: draftId, companyId: company.id },
    select: { id: true, jobId: true, status: true },
  });
  if (!draft) return actionFail("That draft is no longer on this job. Reload the page.");
  if (draft.status === "ACCEPTED") {
    return actionFail("That clause is already on the proposal. Remove it there instead.");
  }

  await prisma.proposalClauseDraft.update({ where: { id: draft.id }, data: { status: "DISMISSED" } });
  revalidatePath(`/jobs/${draft.jobId}/proposal`);
  return actionOk;
}

/**
 * Put an accepted clause into the company's reusable library.
 *
 * OFFERED, NEVER AUTOMATIC — Diego's call. "We exclude dumpsters" belongs in
 * every bid, and `ProposalClause` is the library that ships empty because
 * nothing ever grew it from real use. One press after accepting is how it fills.
 *
 * OWNER-ONLY, because this writes to a company-wide list every future bid
 * copies from. `ownerRefusal` returns a readable refusal rather than throwing —
 * `assertOwner` throws, and a thrown Server Action message is redacted in
 * production, which would make this a dead button.
 */
export async function saveClauseToLibrary(draftId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(PROPOSALS_ONLY);
  const refusal = ownerRefusal(context, "Only an owner can add a clause to the company's standard set.");
  if (refusal) return refusal;
  const { company } = context;

  const draft = await prisma.proposalClauseDraft.findFirst({
    where: { id: draftId, companyId: company.id, status: "ACCEPTED" },
    select: { id: true, jobId: true, kind: true, text: true },
  });
  if (!draft) return actionFail("That clause has not been accepted onto this proposal yet.");

  const already = await prisma.proposalClause.findFirst({
    where: { companyId: company.id, kind: draft.kind, text: draft.text },
    select: { id: true },
  });
  // Said plainly rather than silently succeeding: an estimator who presses this
  // twice should learn that the clause is already there, not wonder whether it
  // worked.
  if (already) return actionFail("That clause is already in your standard set.");

  await prisma.proposalClause.create({
    data: { companyId: company.id, kind: draft.kind, text: draft.text },
  });
  revalidatePath(`/jobs/${draft.jobId}/proposal`);
  return actionOk;
}
