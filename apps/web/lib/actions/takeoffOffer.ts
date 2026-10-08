"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import {
  overCeiling,
  requestNote,
  requestProblem,
  withinDedupeWindow,
  type OfferRequest,
} from "@/lib/takeoff-offer";
import { offerIntakeAddress } from "@/lib/takeoff-offer-config";
import { actionFail, type ActionResult, type ActionResultWith } from "./shared";

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
