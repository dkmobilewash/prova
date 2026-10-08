"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { emailSetupProblem, sendEmail } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { deliveredReadFor } from "@/lib/drawing-set-read-query";
import { deliveryBody, deliverySubjectLine } from "@/lib/takeoff-delivery";
import {
  overCeiling,
  requestNote,
  requestProblem,
  withinDedupeWindow,
  type OfferRequest,
} from "@/lib/takeoff-offer";
import { offerIntakeAddress } from "@/lib/takeoff-offer-config";
import {
  actionFail,
  ownerRefusal,
  type ActionResult,
  type ActionResultWith,
} from "./shared";

/**
 * THE FREE DRAWING-SET READ — the write half of `/wall-takeoff`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY UNAUTHENTICATED ACTION IN THE APP. READ THIS BEFORE
 * CHANGING A LINE OF IT.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Every other action in `lib/actions` opens with `requireCompanyContext()`,
 * and that call is doing two jobs: it says who is asking, and it says which
 * tenant's rows the action is allowed to touch. There is no signed-in user
 * here — `/wall-takeoff` is a public page handed to a contractor who has
 * never heard of us, and a form that demands an account before it will take
 * a name is not an offer, it is a signup.
 *
 * So the `requireCompanyContext()` line is ABSENT ON PURPOSE. It is not an
 * oversight and it must not be "fixed" back in: adding it would redirect
 * every real caller to `/sign-in` and the page would collect nothing.
 *
 * WHY THAT IS SAFE, stated as the three properties that make it so rather
 * than as a reassurance:
 *
 *   1. THE TARGET COMPANY IS NEVER INPUT. It is resolved server-side from
 *      `Company.isProvaOperator` — see that field's comment in
 *      `company.prisma`: exactly one row in production is ever true, set by
 *      hand. No `companyId` is read from the FormData, so there is no
 *      parameter to aim at a tenant. An endpoint with a stable id that
 *      anyone can POST to must have nothing to point, and this one has
 *      nothing to point.
 *
 *   2. THE WRITE SET IS EXACTLY THREE ROWS, all on that one company: a
 *      `SalesLead`, one `SalesOpportunity`, one `SalesActivity`. Nothing is
 *      updated, nothing is deleted, no file is written, no mail is sent.
 *      Prova's own internal CRM is the only thing this can reach.
 *
 *   3. TWO CEILINGS BOUND IT, both decided in `lib/takeoff-offer.ts`:
 *      `overCeiling` caps how many inbound leads this form will create in
 *      an hour, and `withinDedupeWindow` makes a repeat submit from the same
 *      address a no-op. Together those are the difference between an open
 *      write path and an unusable pipeline. Neither is security — a public
 *      form with no ceiling is simply a CRM somebody can fill up in an
 *      afternoon, and the refusal when the ceiling trips still gives the
 *      contractor the intake address, so nothing is lost.
 *
 * ── WHY NOTHING HERE THROWS, AND WHY THERE IS NO `runAction` BOUNDARY ──
 *
 * Production REDACTS a thrown Server Action message to a digest — CLAUDE.md,
 * verified on a real production build — so an action declaring an
 * `ActionResult` shape has promised the caller a sentence it can render, and
 * `ownerRefusalCensus.test.ts` fails the build on one that refuses by
 * throwing. Every refusal below is therefore RETURNED.
 *
 * There is deliberately no `runAction(...)` wrapper and no local
 * `try`/`catch` for `InputError`, because nothing in this module raises one:
 * the form is read with plain string reads, and every validation decision
 * belongs to `requestProblem`, which RETURNS a sentence rather than throwing
 * it. A catch arm nothing can reach is the "written, documented, and never
 * called" shape CLAUDE.md records three live instances of, and it would read
 * as a boundary while guarding nothing.
 *
 * If a shared parser from `./shared` (`decimalFromForm`, `enumFromForm`, …)
 * is ever introduced here, it throws the shared `InputError` and this action
 * NEEDS the boundary — `actionErrorBoundaryCensus.test.ts` rule C is the
 * guard for exactly that and will fail the build naming this function. Take
 * `InputError` and `runAction` FROM `./shared` when that day comes and never
 * declare local copies: sixteen local classes of that name existed once, and
 * `instanceof` is false between two classes that merely share a name, so a
 * refusal walked past a local boundary and reached a brand-new owner as
 * "Digest: 446730191" on the first screen of the product (#407).
 *
 * `runAction` itself could not be used here in any case: it is typed
 * `() => Promise<ActionResult>`, and this action returns a payload. The
 * house pattern for `ActionResultWith` is an explicit boundary — see
 * `bidRecap.ts` and `wallTypes.ts`.
 *
 * ── WHAT THIS ACTION DOES NOT DO ──
 *
 * It sends no email. Delivery is separate work. The contractor's next step
 * is theirs and the page says so: they send the set to `sendTo`, which is
 * why that address is returned on success rather than merely used in the
 * refusals. An action that silently knew the address while the confirmation
 * guessed at it is how a page ends up promising a mailbox nothing reads.
 */

/** One hour, the window `HOURLY_LEAD_CEILING` is a ceiling over. The count
 *  and the comparison both live in `lib/takeoff-offer.ts`; this is only the
 *  boundary of the query that feeds `overCeiling`. */
const CEILING_WINDOW_MS = 3_600_000;

/**
 * `actionFail`, narrowed to the failure branch so it fits a union that
 * carries a payload on success.
 *
 * `shared.ts` documents exactly this problem on `ownerRefusal`, which
 * returns `Extract<ActionResult, { ok: false }>` rather than `ActionResult`
 * for the same reason: `{ ok: true }` is not assignable to
 * `{ ok: true; value: … }`, so the full `ActionResult` cannot be returned
 * from an action with a payload at all. Only the failure branch fits every
 * union that has one.
 *
 * One assertion rather than a second copy of the helper — the alternative is
 * writing `{ ok: false, error }` by hand at six call sites, which is the
 * drift `actionFail` exists to prevent. `specRead.ts` carries the same cast
 * for the same reason.
 */
function fail(error: string): Extract<ActionResult, { ok: false }> {
  return actionFail(error) as Extract<ActionResult, { ok: false }>;
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function readRequest(formData: FormData): OfferRequest {
  return {
    companyName: text(formData, "companyName"),
    contactName: text(formData, "contactName"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    trade: text(formData, "trade"),
    projectName: text(formData, "projectName"),
    gcName: text(formData, "gcName"),
  };
}

export type DrawingSetReadResult = {
  /** Where the contractor sends the set. Returned, not assumed, so the
   *  confirmation state renders the same address the action validated. */
  sendTo: string;
  /** True when a request from this address was already on file inside the
   *  dedupe window, so nothing new was written. The contractor is told the
   *  same thing either way — from their side it DID work both times, which
   *  is the whole point of the window. */
  alreadyHadIt: boolean;
};

export async function requestDrawingSetRead(
  formData: FormData,
): Promise<ActionResultWith<DrawingSetReadResult>> {
  // Read once and use in both the refusals and the success payload: the
  // config module's own header says the page and the action each read this
  // independently so the page can never offer a path the action refuses.
  // Reading it twice WITHIN one action would only add a way for the two
  // halves of this function to disagree with each other.
  const intakeAddress = offerIntakeAddress();

  // The operator company, resolved from the flag and never from input —
  // property 1 above. `findFirst` with no scoping is correct here precisely
  // because there is no caller to scope to.
  const operator = await prisma.company.findFirst({
    where: { isProvaOperator: true },
    select: { id: true },
  });
  if (!operator) {
    // The install has no operator row, which is a misconfiguration on our
    // side and not something a contractor can act on — so the sentence does
    // not explain it, it gives them the way out. Naming the address matters
    // more here than anywhere else in this file: they came to hand over a
    // bid set and this is the one branch where the form cannot take it.
    return fail(
      intakeAddress
        ? `We could not take the request just now. Email the drawing set to ${intakeAddress} and we will read it by hand.`
        : "We could not take the request just now. Try again shortly.",
    );
  }

  const sendTo = intakeAddress;
  if (!sendTo) {
    // No intake address means there is nowhere for the set to go, so a lead
    // created here would be a promise nothing can keep — the contractor
    // would sit waiting for an email that is waiting for them. Refused
    // independently of the page rather than trusting that the page checked,
    // because a POST can arrive without the page ever having rendered.
    return fail("The free drawing-set read is not open right now.");
  }

  const request = readRequest(formData);
  const problem = requestProblem(request);
  if (problem) return fail(problem);

  const now = new Date();

  const recentInbound = await prisma.salesLead.count({
    where: {
      companyId: operator.id,
      source: "INBOUND",
      createdAt: { gte: new Date(now.getTime() - CEILING_WINDOW_MS) },
    },
  });
  if (overCeiling(recentInbound)) {
    return fail(
      `We have had a lot of requests in the last hour, so this form has paused. Email the drawing set to ${sendTo} and it reaches the same person.`,
    );
  }

  // Case-insensitive because a contractor types their own address with
  // whatever capitals their phone decided on, and the second submit is the
  // one this is for. `mode: "insensitive"` rather than lowercasing both
  // sides in JS: the comparison has to happen where the rows are, or the
  // query would have to read every lead on the company to do it.
  const existing = await prisma.salesLead.findFirst({
    where: {
      companyId: operator.id,
      email: { equals: request.email, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (existing && withinDedupeWindow(existing.createdAt, now)) {
    // Deliberately idempotent, which no other create action in this app is
    // (#19 disabled 57 create buttons while in flight instead). A disabled
    // button does not cover this case: a public form is double-submitted,
    // and then filled in AGAIN twenty minutes later by somebody who is not
    // sure it worked. Two identical leads is not a data problem, it is
    // somebody getting rung twice.
    return { ok: true, value: { sendTo, alreadyHadIt: true } };
  }

  // The day the request arrived, at UTC midnight like every other date in
  // this app. `SalesActivity.occurredOn` is normally ENTERED rather than
  // stamped — nobody entered anything here, so the honest value is the day
  // the form was submitted, derived from the same `now` the dedupe window
  // was measured against so the two cannot disagree. `createdAt` on all
  // three rows stays Prisma's stamp, which is correct: it records when a
  // request arrived, not a business date somebody chose.
  const arrivedOn = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

  // One transaction, because a lead with no note is a lead nobody can act
  // on: `SalesLead` has no trade, project or GC column, so everything the
  // contractor actually typed lives in the NOTE and only there.
  await prisma.$transaction(async (tx) => {
    const lead = await tx.salesLead.create({
      data: {
        companyId: operator.id,
        companyName: request.companyName,
        contactName: request.contactName || null,
        email: request.email,
        phone: request.phone || null,
        source: "INBOUND",
      },
    });

    const opportunity = await tx.salesOpportunity.create({
      data: {
        companyId: operator.id,
        leadId: lead.id,
        stage: "NEW",
        // estimatedMrr left null on purpose. Read the field's comment:
        // null is "not yet estimated" and 0 would read as "worth nothing",
        // which is a different claim and a false one — nobody has looked
        // at this deal yet.
      },
    });

    await tx.salesActivity.create({
      data: {
        companyId: operator.id,
        leadId: lead.id,
        // Attached to the deal as well as the lead, because this note IS
        // the opening record of that deal — /sales reads activities per
        // opportunity, and an unattached one would be invisible there.
        opportunityId: opportunity.id,
        type: "NOTE",
        occurredOn: arrivedOn,
        summary: requestNote(request),
        // followUpOn null: nothing is owed yet. loggedByUserId null: no
        // user recorded this, a public form did, and the column is
        // nullable for exactly the case where history has no author.
      },
    });
  });

  // The pipeline, the follow-up queue and the last-contact column on /sales
  // are all derived from these rows, so the operator's own page moves with
  // every write here.
  revalidatePath("/sales");

  return { ok: true, value: { sendTo, alreadyHadIt: false } };
}

/**
 * ──────────────────────────────────────────────────────────────────────────
 * SENDING THE READ BACK — and this one IS authenticated, unlike everything
 * above it in this file.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The header above argues at length that `requireCompanyContext()` is absent
 * ON PURPOSE and must not be "fixed" back in. That argument is about
 * `requestDrawingSetRead` and only about it: a contractor who has never heard
 * of us submits that form, so demanding a session would collect nothing.
 *
 * NOTHING OF THAT APPLIES HERE, and the asymmetry is the point. This action
 * is pressed by one of OUR OWN people, from Prova's internal CRM, to mail a
 * finished read to a prospect. The caller is known, the lead is ours, and the
 * row it writes is an evidence record of correspondence we sent. So this half
 * of the module opens with `requireCompanyContext()` and gates exactly as
 * `lib/actions/sales.ts` does — operator company AND `role === "OWNER"` —
 * because /sales is the screen this belongs to.
 *
 * TWO MODULES, ONE FILE, OPPOSITE RULES. Read which function you are in
 * before copying a line out of either.
 *
 * ── WHY THE GATE IS RETURNED AND NOT THROWN ──
 *
 * `sales.ts`'s own gate is `assertSalesAccess`, which THROWS, and that is
 * correct there: every action in that file is wrapped in `runAction`, which
 * converts an `InputError` to a returned failure. It is NOT correct here.
 * This action declares `ActionResultWith<…>`, production redacts a thrown
 * Server Action message to a digest, and `ownerRefusalCensus.test.ts` fails
 * the build on an action that promises a legible refusal and then throws one
 * — see `shared.ts`'s documentation of the `ownerRefusal`/`assertOwner` pair,
 * which is the authority rather than this comment. So the two checks
 * `assertSalesAccess` makes are made here as RETURNS, in the same order and
 * with the same two sentences:
 *
 *   - a non-operator company gets "Not found", because this feature does not
 *     exist for them and an authorization message would be a stranger lie
 *     than silence;
 *   - a member at the operator company gets the real reason.
 *
 * `assertSalesAccess` itself is deliberately not imported: it is private to
 * `sales.ts` and it throws, which is the one thing this action may not do.
 *
 * ── WHY A FAILED SEND STILL RETURNS `ok: true` ──
 *
 * The valuable half of this action is the TEXT, not the transmission. Three
 * of the branches below cannot send — no address on the lead, no mail
 * provider configured, the provider refused it — and in every one of them the
 * composed subject and body are still returned so the operator can paste them
 * into their own mail client and the prospect still gets their read.
 *
 * Reporting those as `{ ok: false }` would throw the body away to report that
 * a side effect did not happen, and the screen would have nothing to show but
 * an error. So `sent` and `problem` carry that news INSIDE a success, and the
 * caller renders both. `ok: false` is reserved for the cases where there is
 * no read to give back at all.
 *
 * ── WHY THE TEXT IS NOT COMPOSED HERE ──
 *
 * `deliverySubjectLine` and `deliveryBody` (`lib/takeoff-delivery.ts`) are the
 * only place that knows what this email says, and this action must never
 * grow a second copy of a line of it. CLAUDE.md's rule for a canonical list
 * is both guards — that the list is complete and that it is the ONLY one —
 * and it records a hand-rolled copy of a shared list quoting a bid $1,732.50
 * under the screen that shared its source. The same defect against a
 * prospective customer's first sample of the product would be worse: they
 * would be comparing our email to our own page.
 *
 * That module had 44 passing tests and NOTHING CALLED IT. "Written,
 * documented, and never called" is a shape CLAUDE.md records three live
 * instances of in a single day, every one of them green, because nothing
 * referenced the dead code. This action is the call site.
 *
 * ── WHY THE SETUP PROBLEM COMES FROM A FUNCTION, NOT FROM `process.env` ──
 *
 * `emailSetupProblem()` is read rather than `RESEND_API_KEY` tested here, for
 * the reason `lib/help-config.ts`'s `helpChannelFromEnv` sets out at length:
 * a page must never offer a path the action then refuses, and the only way
 * two halves of a feature can agree about whether sending is available is for
 * both to ask the same function. `sendEmail` consults it too, so an
 * unconfigured install is reported identically whether this branch is reached
 * or the send is attempted.
 */

/**
 * What the operator gets back. `subject` and `body` are present on every
 * success, including the ones that could not send — see the header.
 */
export type SentReadResult = {
  /** True only when the provider accepted the message. */
  sent: boolean;
  subject: string;
  body: string;
  /** Why it did not send, in a sentence the screen renders as-is. Null on a
   *  real send. Never a reason-code: the operator acts on this. */
  problem: string | null;
};

export async function sendDrawingSetRead(
  leadId: string,
  planId: string,
): Promise<ActionResultWith<SentReadResult>> {
  const context = await requireCompanyContext();

  // The two checks `assertSalesAccess` makes, RETURNED rather than thrown.
  // Tenant identity first, person identity second, same order and same two
  // sentences as `sales.ts` — a non-operator company must not be able to
  // tell the two refusals apart.
  if (!context.company.isProvaOperator) return fail("Not found");
  const refusal = ownerRefusal(context, "Only the account owner can use the sales CRM");
  if (refusal) return refusal;

  // One call, both rows, both scoped to this company. `deliveredReadFor`
  // returns null when EITHER the lead or the plan belongs to somebody else,
  // which is deliberate and is why the sentence below does not say which:
  // answering "that lead exists but the plan is not yours" from an action
  // reachable with a guessed id is a membership oracle over another tenant's
  // files. The operator reached this from their own screen, so a single
  // sentence costs them nothing.
  const read = await deliveredReadFor(leadId, planId, context.company.id);
  if (!read) return fail("We could not find that lead and drawing set together.");

  const subject = deliverySubjectLine(read);
  const body = deliveryBody(read);

  const lead = await prisma.salesLead.findUnique({
    where: { id: leadId },
    select: { email: true, contactName: true },
  });
  // `deliveredReadFor` already proved the lead is ours, so a null here is a
  // row deleted between two queries rather than a scoping failure. Refused
  // with the same sentence, because the two are indistinguishable from the
  // caller's side and there is nothing to send either way.
  if (!lead) return fail("We could not find that lead and drawing set together.");

  // The public form requires an address, but `SalesLead.email` is nullable
  // and a lead can be typed in by hand on /sales or edited afterwards. The
  // read is already composed at this point and it is the thing worth having,
  // so it is returned rather than discarded to report the gap.
  const to = (lead.email ?? "").trim();
  // MUTANT_A: record the EMAIL activity regardless of whether the send
  // succeeds. Every "no activity row" test must go RED.
  await prisma.salesActivity.create({
    data: {
      companyId: context.company.id,
      leadId,
      type: "EMAIL",
      occurredOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      summary: `Emailed the free drawing-set read of ${read.subject.fileName ?? "the drawing set they sent"} to ${to}.`,
      loggedByUserId: context.id,
    },
  });
  if (!to) {
    return {
      ok: true,
      value: {
        sent: false,
        subject,
        body,
        problem:
          "This lead has no email address on file, so there is nobody to send it to. The read is below — add an address to the lead, or copy it into your own mail.",
      },
    };
  }

  // Asked BEFORE attempting the send rather than inferred from its failure.
  // `sendEmail` would return the same sentence, but an install with no
  // provider is a state the screen should be able to state plainly rather
  // than a refusal it discovers, and the two must agree — which they do
  // because both read this one function.
  const setupProblem = emailSetupProblem();
  if (setupProblem) {
    return { ok: true, value: { sent: false, subject, body, problem: setupProblem } };
  }

  const send = await sendEmail({ to, toName: lead.contactName, subject, text: body });
  if (!send.ok) {
    return {
      ok: true,
      value: {
        sent: false,
        subject,
        body,
        // `mayHaveSent` is the provider having ACCEPTED the message and
        // returned no id to track it by — see `email.ts`, which sets it for
        // exactly that case. "It did not go" and "it may already have gone"
        // are different things to tell somebody who is about to press send
        // again at a prospect, so the sentence says which.
        problem: send.mayHaveSent
          ? `${send.error}. It may already have reached them — check with them before sending it again.`
          : send.error,
      },
    };
  }

  // ONLY NOW. An EMAIL activity is an evidence record that we wrote to this
  // prospect; writing one on a send that failed is a false record of
  // correspondence, and the next person reading the lead would see a contact
  // that never happened. Every branch above returns before reaching here.
  //
  // `occurredOn` is normally ENTERED rather than stamped — nobody entered
  // anything here, because nobody was asked: the operator pressed send. So
  // the honest value is the day the send happened, DERIVED FROM THE SEND and
  // stored at UTC midnight like every other date in this app, rather than a
  // business date somebody chose.
  // MUTANT_A_MOVED_FROM_HERE

  // The lead's own page shows its activity list; /sales derives the pipeline,
  // the follow-up queue and the last-contact column from these rows.
  revalidatePath(`/sales/${leadId}`);
  revalidatePath("/sales");

  return { ok: true, value: { sent: true, subject, body, problem: null } };
}
