"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { emailSetupProblem, sendEmail } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { deliveredReadFor } from "@/lib/drawing-set-read-query";
import { deliveryBody, deliverySubjectLine } from "@/lib/takeoff-delivery";
import { viewerAsOf } from "@/lib/viewerToday";
import {
  DEDUPE_WINDOW_HOURS,
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
 *   2. THE WRITE SET IS BOUNDED AND ENUMERATED, all of it on that one
 *      company. A first request writes FOUR rows: a `SalesLead`, one
 *      `SalesOpportunity`, that opportunity's opening `SalesStageChange`,
 *      and one `SalesActivity`. A repeat inside the dedupe window writes
 *      exactly ONE — a `SalesActivity` on the lead that is already there.
 *      Nothing is updated, nothing is deleted, no file is written, no mail
 *      is sent. Prova's own internal CRM is the only thing this can reach.
 *
 *      THIS SENTENCE SAID "EXACTLY THREE ROWS" AND NAMED THREE MODELS, and
 *      it was a safety property rather than a description — so it is
 *      corrected here rather than left to be read as one. The stage change
 *      is the fourth because the house convention for `SalesOpportunity` is
 *      four rows, not three: `sales.prisma` says `SalesStageChange` is
 *      "written only by createSalesOpportunity and updateSalesOpportunity,
 *      in the same transaction as the row itself", and an opportunity with
 *      no history is excluded from every read on /sales that asks how long
 *      a deal has been sitting. A write set that is one row short of the
 *      convention is not a smaller blast radius, it is a deal nobody can
 *      see.
 *
 *   3. EVERY FIELD IS LENGTH-CAPPED AND CONTROL-CHARACTER-STRIPPED before
 *      anything is written — `readRequest` below, which says what each cap
 *      is for. An unauthenticated write with unbounded text is a row
 *      somebody can make arbitrarily large, and a field carrying newlines
 *      is a forged line in the delivery mail.
 *
 *   4. TWO CEILINGS BOUND IT, both decided in `lib/takeoff-offer.ts`:
 *      `overCeiling` caps how many inbound leads this form will create in
 *      an hour, and `withinDedupeWindow` makes a repeat submit from the same
 *      address create no second lead. Together those are the difference
 *      between an open write path and an unusable pipeline. Neither is
 *      security — a public form with no ceiling is simply a CRM somebody can
 *      fill up in an afternoon, and the refusal when the ceiling trips still
 *      gives the contractor the intake address, so nothing is lost.
 *
 *      WHAT NEITHER CEILING IS, AND IT IS WORTH STATING BECAUSE THE CODE
 *      LOOKS LIKE IT: both are a READ followed by a WRITE, with no lock and
 *      no unique index between them. Concurrent POSTs can all pass their
 *      count before any of them commits, so the hourly ceiling is a ceiling
 *      on sequential submits and the dedupe window is proof against a human
 *      filling the form in twice, not against a script firing twenty at
 *      once. Closing that needs a unique index or an advisory lock — a
 *      migration, which is announced in Slack before it is pushed. Moving
 *      these two reads inside the transaction below would NOT close it:
 *      Postgres runs at READ COMMITTED here, so a transaction still cannot
 *      see a sibling's uncommitted insert, and the only thing it would
 *      change is how long each request holds one of five pooled
 *      connections.
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

/**
 * HOW LONG EACH FIELD IS ALLOWED TO BE, and why each number is the number.
 *
 * `requestProblem` caps the EMAIL at 320 (`looksLikeEmailAddress`, which is
 * the SMTP maximum) and nothing else. Everything below arrives on an
 * UNAUTHENTICATED POST, so "nobody would type that" is not a bound: without
 * these, one request can write a row of any size to Prova's own CRM, and
 * every one of these strings is also read back out into the delivery mail and
 * onto /sales.
 *
 * The numbers are the longest value a real contractor could have, roughly
 * doubled — not round numbers for their own sake. A refusal here is a dead
 * end for somebody who came to hand over a bid set, so the caps are set where
 * only a paste or a script can reach them.
 */
const FIELD_LIMITS = {
  /** A legal entity name with its suffixes. "Ridgeline Drywall & Plaster
   *  Systems of Southern Nevada, Incorporated" is 72 characters. */
  companyName: 160,
  /** A person's full name. Long enough for a double-barrelled surname and a
   *  title somebody types in anyway. */
  contactName: 120,
  /** A phone number with a country code, an extension and whatever
   *  punctuation their phone put in. Not parsed, so this is the only bound
   *  it has. */
  phone: 40,
  /** A project name as a GC writes it on a bid invitation — these run long
   *  ("Sunset Medical Office Building — Shell & Core, Phase 2"). */
  projectName: 200,
  /** A GC's company name, same shape as ours. */
  gcName: 160,
} as const;

/**
 * Control characters are STRIPPED rather than refused, which is the opposite
 * of the decision made about length below, and the asymmetry is deliberate.
 *
 * A control character in one of these fields is almost never typed — it is
 * pasted, out of a PDF bid invitation or a spreadsheet, and the contractor
 * cannot see it. Refusing "Acme Drywall\r\nInc" with a sentence about
 * characters they cannot see is a dead end they have no way to act on. A
 * length they CAN see, and can shorten.
 *
 * It matters at all because a newline in `companyName` is a forged line in
 * the delivery mail: `lib/takeoff-delivery.ts` renders a plain-text body with
 * one fact per line, so a field carrying `\n` plants a line that reads as
 * ours. That renderer defends itself too — both layers, because neither is
 * sufficient alone. This one stops the character reaching the database at
 * all, so it is also not in the note, not on /sales, and not in anything
 * written later that nobody has thought about yet.
 *
 * C0 (including tab and newline), DEL, C1, and the two Unicode line
 * separators — every one of them replaced with a SPACE rather than deleted,
 * so "Acme\nDrywall" is "Acme Drywall" and not "AcmeDrywall", and then runs
 * of whitespace are collapsed. None of these fields is multi-line on the
 * form, so nothing legitimate is lost.
 */
function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(formData: FormData, key: string) {
  return singleLine(String(formData.get(key) ?? ""));
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

/**
 * Which field is too long, as a sentence naming it and the limit — or null.
 *
 * REFUSED RATHER THAN TRUNCATED, and this is the choice the other way round
 * from `singleLine` above. Truncating silently is the worse failure here
 * because of WHO reads these strings next: `companyName` is how the operator
 * knows whose drawing set has just landed, and `projectName` is how they
 * match it to the right bid. A truncated company name is a lead that is
 * quietly about somebody slightly else, and nothing on /sales says it was
 * cut. The form clears nothing on a failure (`TakeoffOfferForm`'s header is
 * explicit about why), so a refusal arrives over what they typed and
 * shortening it is one edit.
 *
 * `trade` and `email` are absent on purpose: `requestProblem` already bounds
 * both — `trade` against the enum, `email` at 320 — and a second cap here
 * would be a second list of the same rule.
 *
 * Returned in field order, not longest-first, so two runs over the same input
 * name the same field.
 */
function tooLongProblem(request: OfferRequest): string | null {
  const fields: { key: keyof typeof FIELD_LIMITS; label: string }[] = [
    { key: "companyName", label: "company name" },
    { key: "contactName", label: "name" },
    { key: "phone", label: "phone number" },
    { key: "projectName", label: "project name" },
    { key: "gcName", label: "general contractor" },
  ];
  for (const { key, label } of fields) {
    const limit = FIELD_LIMITS[key];
    if (request[key].length > limit) {
      return `That ${label} is too long — ${limit} characters or fewer and we will take it from there.`;
    }
  }
  return null;
}

/**
 * What comes back on success — and it is ONE FIELD, which is the fix rather
 * than a simplification.
 *
 * THIS TYPE CARRIED AN `alreadyHadIt: boolean` AND IT WAS AN EMAIL-ENUMERATION
 * ORACLE. Its own comment claimed "the contractor is told the same thing
 * either way", and that was false twice over: `TakeoffOfferForm` rendered a
 * distinct paragraph when it was true, and the flag was in the raw POST
 * response whatever the page did with it. So anyone could POST an address to
 * this endpoint and learn whether it is a `SalesLead` on Prova's operating
 * company from the last day — leads this form created AND ones we typed in
 * ourselves off a cold call. A hit writes nothing, so it cost the prober
 * nothing and was not bounded by anything: only MISSES create a lead, and
 * only leads count against the hourly ceiling. Twenty probes an hour into who
 * is talking to us, on a page whose whole purpose is being handed to named
 * prospects.
 *
 * So the response is now identical for a first request and a repeat, byte for
 * byte, and `takeoffOffer.dbtest.ts` asserts that rather than trusting it.
 * Nothing is lost by the submitter: their next step is the same sentence
 * either way — send the set to this address — which is what made the flag
 * safe to remove and is also what made it worthless to them in the first
 * place.
 *
 * A REPEAT IS NO LONGER SILENT, which is the other half of making this
 * honest. The dedupe branch below writes the note onto the existing lead, so
 * "identical response" does not mean "the second request was thrown away".
 */
export type DrawingSetReadResult = {
  /** Where the contractor sends the set. Returned, not assumed, so the
   *  confirmation state renders the same address the action validated. */
  sendTo: string;
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
  // The band's own rules first — required fields and the shape of the address
  // — because those are the corrections a real contractor hits, and
  // `requestProblem` owns the ordering between them. The length refusal is
  // second because nothing typed by hand reaches it.
  const problem = requestProblem(request) ?? tooLongProblem(request);
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
  //
  // SCOPED TO `source: "INBOUND"`, WHICH IS WHAT THIS FORM CREATES, and the
  // lookup was missing that for the same reason the ceiling count above has
  // always had it. Without it a lead the operator typed in by hand off a cold
  // call — OUTBOUND, REFERRAL, EVENT — makes a contractor's genuine FIRST
  // request read as a repeat, so no lead is created for somebody we have
  // never heard from and the operator never learns they asked.
  //
  // What this discriminator is and is not: `SalesLeadSource` is the only
  // column that distinguishes these rows, and INBOUND is the nearest it gets
  // to "this form made it". A lead somebody hand-enters AS inbound still
  // matches, which is a narrower hole than the one it closes and needs a
  // column to fix rather than a `where` clause.
  const existing = await prisma.salesLead.findFirst({
    where: {
      companyId: operator.id,
      source: "INBOUND",
      email: { equals: request.email, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      // The deal this lead is already in, so the repeat's note hangs off the
      // same opportunity the first one did — /sales reads activities per
      // opportunity and an unattached one is invisible there. Newest first
      // and one row: a lead can have more than one opportunity over time
      // (`sales.prisma`), and the live one is the last one opened.
      opportunities: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });

  // The day the request arrived, at UTC midnight like every other date in
  // this app. `SalesActivity.occurredOn` is normally ENTERED rather than
  // stamped — nobody entered anything here, so the honest value is the day
  // the form was submitted. `createdAt` on all three rows stays Prisma's
  // stamp, which is correct: it records when a request arrived, not a
  // business date somebody chose.
  //
  // `viewerAsOf()` RATHER THAN THE SERVER'S OWN DAY, and the first version of
  // this line got it wrong: it read `now.toISOString().slice(0, 10)`, which is
  // UTC's calendar date. A contractor in Hawaii filling this in at 9pm local
  // is already tomorrow in UTC, so their request would be logged on a date
  // that had not happened where they were sitting. `viewerAsOf` reads the
  // viewer's zone and floors to UTC when there is no request scope, so it is
  // never worse than what it replaced.
  //
  // It survived `viewerDayCensus.test.ts` only because that census matches the
  // one-expression form and this was written in two steps — the same defect
  // its sibling `sendDrawingSetRead` was caught committing in ONE step and
  // fixed. Worth knowing before trusting that census's scope: the pattern it
  // reads for is narrower than the mistake it is about.
  const arrivedOn = await viewerAsOf();

  if (existing && withinDedupeWindow(existing.createdAt, now)) {
    // Deliberately idempotent IN THE LEAD, which no other create action in
    // this app is (#19 disabled 57 create buttons while in flight instead). A
    // disabled button does not cover this case: a public form is
    // double-submitted, and then filled in AGAIN twenty minutes later by
    // somebody who is not sure it worked. Two identical leads is not a data
    // problem, it is somebody getting rung twice.
    //
    // THE NOTE IS NOT IDEMPOTENT, AND THAT IS THE CORRECTION. This branch
    // used to return `ok` and write NOTHING AT ALL, which is only harmless
    // when the second submit is the same submit. It very often is not: a sub
    // bidding four jobs this week fills this in on Monday morning for
    // "Harborview / Turner" and again that afternoon for "Civic Center /
    // Swinerton". `SalesLead` has no project, GC or trade column, so the
    // whole of the second request lived in a note that was never written —
    // the project, the GC and the fact that a SECOND set was coming, all
    // discarded behind a confirmation screen that said we had their details.
    //
    // So the dedupe window now suppresses the LEAD and the DEAL, which is
    // what it is for — nobody gets rung twice, and the pipeline does not
    // count one contractor as two — while everything the contractor typed is
    // written onto the lead that already exists. Exactly one row.
    await prisma.salesActivity.create({
      data: {
        companyId: operator.id,
        leadId: existing.id,
        opportunityId: existing.opportunities[0]?.id ?? null,
        type: "NOTE",
        occurredOn: arrivedOn,
        // `requestNote(request)` unchanged and in full, under one line saying
        // which branch wrote it. Without that line two notes a few hours
        // apart on one lead read as a double write rather than as two bids,
        // and the operator's first question — "did the form fire twice?" — is
        // the one the note can answer for free. The window's length is read
        // from the constant that decides it, so the sentence cannot drift
        // from the rule.
        summary: `Sent the /wall-takeoff form again within ${DEDUPE_WINDOW_HOURS} hours, so no second lead was created. What they sent this time:\n\n${requestNote(request)}`,
        // followUpOn and loggedByUserId null for the same reasons as the
        // first note below: nothing is owed yet, and a public form has no
        // author.
      },
    });

    // The lead's activity list and /sales's last-contact column both move.
    revalidatePath("/sales");

    // Byte-identical to the success below. See `DrawingSetReadResult`.
    return { ok: true, value: { sendTo } };
  }

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

    // THE OPENING STAGE RECORD, in the same transaction as the row itself —
    // which is what `sales.prisma` says this model is for, in as many words:
    // "written only by createSalesOpportunity and updateSalesOpportunity, in
    // the same transaction as the row itself". This action is now the third
    // writer and it matches `createSalesOpportunity`'s shape rather than
    // inventing one.
    //
    // IT WAS MISSING, and the cost was not cosmetic. `lib/sales-pipeline.ts`
    // derives `daysInStage` from this history, and both `longestOpen` and
    // `trackedOpenCount` filter on `daysInStage !== null` — so every deal
    // this form created was excluded from the "what has gone quiet" list on
    // /sales. The one read whose whole job is surfacing a neglected deal
    // could not see the deals made by the feature built to generate them,
    // while `SalesOpportunityRow` rendered "stage not recorded" beside each
    // one. It also falsified `historyDisagrees`'s own comment — "should be
    // unreachable: both writes happen in one transaction" — which was true of
    // every other writer and is true again now.
    //
    // `fromStage: null` because the deal did not come from anywhere; it
    // started here. `effectiveOn` is `arrivedOn`, the same day as the note:
    // the day the request arrived IS the day this deal reached NEW, and it is
    // the one date in this action. `recordedByUserId` null — the column is
    // nullable for exactly the case where history has no author, and here
    // there is no user, only a public form. No `note`: the stage did not move
    // for a reason, it opened, and what they typed is in the activity below.
    await tx.salesStageChange.create({
      data: {
        companyId: operator.id,
        opportunityId: opportunity.id,
        fromStage: null,
        toStage: "NEW",
        effectiveOn: arrivedOn,
        recordedByUserId: null,
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

  return { ok: true, value: { sendTo } };
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
 * ── AND ONE OF THOSE BRANCHES STILL WRITES THE EVIDENCE RECORD ──
 *
 * `sent: false` is not the same question as "was anything written". A
 * provider that ACCEPTED the message and returned no id to track it by has
 * almost certainly delivered it (`email.ts` says so where it sets
 * `mayHaveSent`), so that branch records the EMAIL activity and annotates it
 * — it does not report a clean send, and it does not leave a sent mail with
 * no record. `lib/actions/messages.ts` and `lib/notification-dispatch.ts` are
 * the precedent and the branch itself cites them. The other failure branches
 * write nothing, which is the same rule read the other way: evidence of an
 * email that does not exist is worse than none.
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
 * referenced the dead code. This action is the call site that SENDS it.
 *
 * It is not the only one, and the distinction is load-bearing rather than
 * pedantic: `/sales/[id]/drawing-read` renders the same two functions as a
 * PREVIEW on the screen, which is the whole reason the operator can see what
 * the prospect will get before pressing send. Two callers of one renderer is
 * the point — a preview composed differently from the thing that goes out is
 * the drift this section is about, wearing a reassuring shape.
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
  /** True only when the provider CONFIRMED it, with a message id to track it
   *  by. False on a send the provider accepted without one — that branch is
   *  not a clean send and must not render as one, even though it does write
   *  the activity row. See the header. */
  sent: boolean;
  subject: string;
  body: string;
  /** Why it did not send, in a sentence the screen renders as-is. Null on a
   *  real send. Never a reason-code: the operator acts on this. */
  problem: string | null;
};

/**
 * THE EMAIL ACTIVITY — written by BOTH branches that reached the provider,
 * which is one helper rather than two copies for the reason CLAUDE.md gives
 * for every canonical value in this repo: the second copy is the one that
 * drifts. The summary's first sentence is the record of WHAT was sent and to
 * WHOM, and it must read the same whether or not the provider gave us an id.
 *
 * `occurredOn` is normally ENTERED rather than stamped — nobody entered
 * anything here, because nobody was asked: the operator pressed send. So the
 * honest value is the day the send happened, DERIVED FROM THE SEND and stored
 * at UTC midnight like every other date in this app, rather than a business
 * date somebody chose.
 *
 * `viewerAsOf()` RATHER THAN `new Date()`, and this is a correction rather
 * than a flourish: the first version of this line read
 * `new Date().toISOString().slice(0, 10)`, which is the SERVER'S day.
 * `viewerDayCensus.test.ts` failed the build naming that exact expression,
 * and its header says why it is worth a census — west of UTC the server's day
 * rolls over in the afternoon, so for seven hours of every day an operator
 * sending a read at 5pm in Los Angeles would have it logged as TOMORROW on
 * their own lead, and the activity list they read it back from is sorted by
 * that column.
 *
 * It is the one date in this action, and `viewerAsOf` is the exact shape
 * needed: the reader's calendar day, as the UTC-midnight instant every dated
 * record here is stored at. It inherits that helper's UTC floor and never
 * throws, which matters because this action is also called from a database
 * test with no request around it.
 */
async function recordReadEmailed(params: {
  companyId: string;
  leadId: string;
  loggedByUserId: string;
  fileName: string | null;
  to: string;
  /** Appended to the summary when the send is not confirmed. Null on a
   *  confirmed send, where there is nothing to warn anybody about. */
  caveat: string | null;
}): Promise<void> {
  const sentOn = await viewerAsOf();
  // Names what was sent AND which file it was about: a lead can be sent more
  // than one read, and "we emailed them the read" on its own does not say
  // which set.
  const sentLine = `Emailed the free drawing-set read of ${params.fileName ?? "the drawing set they sent"} to ${params.to}.`;
  await prisma.salesActivity.create({
    data: {
      companyId: params.companyId,
      leadId: params.leadId,
      type: "EMAIL",
      occurredOn: sentOn,
      summary: params.caveat ? `${sentLine} ${params.caveat}` : sentLine,
      // Who pressed send is audit, not content — same as `createSalesActivity`
      // and `ContactInteraction`. Unlike the public intake above, there IS a
      // user here, so the column is filled.
      loggedByUserId: params.loggedByUserId,
      // followUpOn null: sending the read owes nothing by itself. The
      // operator logs a follow-up when they decide to chase it.
    },
  });
}

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
    // `mayHaveSent` is the provider having ACCEPTED the message and returned
    // no id to track it by — see `email.ts`, which sets it for exactly that
    // case and says "the provider ACCEPTED this. The mail has almost
    // certainly gone."
    //
    // SO THE ACTIVITY IS WRITTEN HERE TOO, AND IT WAS NOT. This branch
    // returned before reaching the activity write, so correspondence with a
    // prospect happened with no evidence record of it anywhere: the lead's
    // activity list said we had never written to them, and the send button
    // re-enabled itself. The operator's obvious next move — press it again —
    // sends a second copy of a cold first contact to a stranger, which is the
    // one failure this whole feature cannot afford.
    //
    // THE REPO HAS ALREADY DECIDED THIS, TWICE, and this is following that
    // precedent rather than making a fresh judgement.
    // `lib/actions/messages.ts` keeps its QUEUED handover and only annotates
    // it, because "recording that as FAILED tells a user their email didn't
    // send, they send it again, and the GC gets two";
    // `lib/notification-dispatch.ts` does the same and states the principle
    // both ways round — "evidence of an email that does not exist is worse
    // than none", and "recording that as failed invites a second copy". The
    // division is `mayHaveSent`: a provable non-send writes nothing, an
    // accepted-but-unconfirmed one writes the record and says what is unknown
    // about it.
    //
    // It is NOT reported as a clean send. `sent` stays false, the problem
    // sentence still goes back, and the row itself carries the caveat — so
    // the operator reading the lead a week later gets the same warning the
    // screen gave, which is the half a return value cannot deliver.
    if (send.mayHaveSent) {
      await recordReadEmailed({
        companyId: context.company.id,
        leadId,
        loggedByUserId: context.id,
        fileName: read.subject.fileName,
        to,
        caveat:
          "The provider accepted it but confirmed no message id, so this send cannot be tracked. Treat it as sent — do not send it again without checking with them first.",
      });
      revalidatePath(`/sales/${leadId}`);
      revalidatePath("/sales");
    }

    return {
      ok: true,
      value: {
        sent: false,
        subject,
        body,
        // "It did not go" and "it may already have gone" are different things
        // to tell somebody who is about to press send again at a prospect, so
        // the sentence says which.
        problem: send.mayHaveSent
          ? `${send.error}. It may already have reached them — check with them before sending it again.`
          : send.error,
      },
    };
  }

  // A CONFIRMED SEND, with an id to track it by — the only branch that calls
  // this a send. An EMAIL activity is an evidence record that we wrote to
  // this prospect, and writing one on a send that PROVABLY did not happen is
  // a false record of correspondence: the next person reading the lead would
  // see a contact that never took place. Every branch above either returns
  // before reaching here or, in the one case where the provider accepted the
  // mail, writes the record itself with the caveat attached.
  await recordReadEmailed({
    companyId: context.company.id,
    leadId,
    loggedByUserId: context.id,
    fileName: read.subject.fileName,
    to,
    caveat: null,
  });

  // The lead's own page shows its activity list; /sales derives the pipeline,
  // the follow-up queue and the last-contact column from these rows.
  revalidatePath(`/sales/${leadId}`);
  revalidatePath("/sales");

  return { ok: true, value: { sent: true, subject, body, problem: null } };
}
