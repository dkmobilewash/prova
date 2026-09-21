"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import {
  CONTACT_STATUSES,
  CONTACT_TYPES,
  LOCATION_TYPES,
  type ActionResult,
  InputError,
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  enumFromForm,
  isUniqueConstraintError,
  joinWithConjunction,
  nullableDecimalFromForm,
  optionalEnumFromForm,
  ownerRefusal,
  plural,
  runAction,
} from "./shared";
import { normalizeEin, normalizeWebsite } from "@/lib/company-profile";
import { can } from "@/lib/permissions";
import { numericReaders, PERCENT_BOUNDS } from "@/lib/numeric-input";
import { CONTRACTING_RELATIONSHIPS } from "@/lib/businessScope";

/** The job-function refusal for the company record, worded the way
 * `closeoutSubmissions.ts` words its own: the person reading it has done
 * nothing wrong and needs to know who can change it.
 *
 * RETURNED, not thrown — production redacts a thrown Server Action message
 * to a digest, so a thrown version of this sentence never arrives. */
const COMPLIANCE_ONLY =
  "The company record isn't part of your job function. The account owner sets who sees what, on the Team page.";

// `InputError` and `runAction` come from ./shared, and that is a fix rather
// than tidiness. Until 2026-09-21 this file declared its OWN `InputError`
// class and its own `runAction` that caught only that class — while the
// shared parsers it also calls (`enumFromForm`, `optionalEnumFromForm`)
// threw shared.ts's. Same name, two classes, `instanceof` false, so a
// refusal from those parsers left every action here as a throw and reached
// production as a digest. `/welcome`'s empty Save was the one a person
// actually hit. One class, one boundary, no way for the two to disagree.

/** One parser for every typed figure — see `lib/numeric-input.ts`. Raises
 * THIS module's InputError so the local `runAction` catch still sees it. */
const { optionalNumber } = numericReaders((message) => {
  throw new InputError(message);
});

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight, same rule as every other date in this app. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

/** A write refused by a foreign key (Prisma P2003, or P2014 for a required
 * relation). Reads `code` rather than using `instanceof`, which is FALSE at
 * runtime here — see `isUniqueConstraintError` in ./shared for the
 * measurement. */
function isForeignKeyViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P2003" || code === "P2014";
}

/**
 * Edits the company's OWN record — the first and only writer of it.
 *
 * `Company.name` was written once, by `requireCompanyContext` on first
 * sign-in, as `${name}'s Company`; `dbaName`, `ein`, `hqAddress*`, `phone`
 * and `website` have existed on the model with nothing writing them at all.
 * That generated string prints as the contractor on the WH-347 certified
 * payroll form, as the employer on a union trust-fund remittance report, in
 * the sidebar, and above the signature block a GC signs — and until this
 * action there was no way to change any of it.
 *
 * TWO GUARDS, IN THIS ORDER, and the order is the decision.
 *
 * `/settings` demands MANAGE_COMPLIANCE, and a page guard stops a page
 * rendering — it does nothing about the action behind it, which is a
 * separate endpoint with a stable id that answers whoever posts to it.
 * `lib/action-capability-guards.test.ts` derives that requirement from the
 * page's own guard and fails the build without it; it found this action the
 * moment it existed. So the capability is checked FIRST, because it is the
 * broader fact about the person (their job function is not this), and the
 * owner check second, because it is about this record specifically. A member
 * who holds MANAGE_COMPLIANCE gets the owner sentence, which is the true
 * reason they are being refused.
 *
 * OWNER-ONLY, via `ownerRefusal` rather than `assertOwner`. Both are in
 * shared.ts and the difference is not stylistic: this action's declared
 * return type PROMISES the caller a sentence it can render, and
 * `assertOwner` throws, which production redacts to a digest. The
 * owner-refusal census (`lib/ownerRefusalCensus.test.ts`) fails the build
 * for exactly that combination. The message names the consequence rather
 * than the rule, because "renaming this changes a federal form" is the
 * reason a member is being refused.
 *
 * Validation is deliberately narrow: a blank legal name is refused because
 * every one of those documents has to name somebody, and the EIN and
 * website are normalised on the way in (see lib/company-profile.ts for
 * which stored form and why). `phone` stays free text — extensions, a
 * second number and "ask for Dave" are all real, and a format rule here
 * would refuse a contractor's actual phone number for no gain. `hqState` is
 * upper-cased because a state code prints on a federal form; it is not
 * otherwise checked, since refusing a two-letter code nobody recognises is
 * worse than printing it.
 */
export async function updateCompanyProfile(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);

    const refusal = ownerRefusal(
      context,
      "Only the account owner can change the company record. The legal name and address here print on the WH-347 certified payroll form, on union remittance reports, and above the signature block a GC signs.",
    );
    if (refusal) return refusal;

    const name = required(formData, "name", "Legal company name");

    const ein = normalizeEin(text(formData, "ein"));
    if (!ein.ok) return fail(ein.error);

    const website = normalizeWebsite(text(formData, "website"));
    if (!website.ok) return fail(website.error);

    const dbaName = text(formData, "dbaName");
    const hqAddressLine1 = text(formData, "hqAddressLine1");
    const hqAddressLine2 = text(formData, "hqAddressLine2");
    const hqCity = text(formData, "hqCity");
    const hqState = text(formData, "hqState").toUpperCase();
    const hqZip = text(formData, "hqZip");
    const phone = text(formData, "phone");

    await prisma.company.update({
      where: { id: context.company.id },
      data: {
        name,
        dbaName: dbaName || null,
        ein: ein.value,
        hqAddressLine1: hqAddressLine1 || null,
        hqAddressLine2: hqAddressLine2 || null,
        hqCity: hqCity || null,
        hqState: hqState || null,
        hqZip: hqZip || null,
        phone: phone || null,
        website: website.value,
      },
    });

    // The three surfaces this record is READ on, named rather than left to
    // a single /settings revalidation: the remittance sheet and the WH-347
    // print it, and both are routes somebody may already have open.
    revalidatePath("/settings");
    revalidatePath("/union-compliance/remittance");
    revalidatePath("/jobs");
    return ok;
  });
}
/* THE THREE /team ACTIONS RETURN THEIR REFUSALS, and until 2026-09-12 all
   three threw them.

   Every guard in them is an EXPECTED outcome a person needs to read — the
   email is already invited, the person already has an account, someone else
   removed the member a second ago, you are not the owner — and production
   redacts a thrown Server Action message to a digest (CLAUDE.md, verified on
   a real production build). So the page showed nothing at all: the invite
   form appeared to do nothing on a duplicate email, and a failed removal left
   the teammate on the list with no explanation anywhere.
   `lib/actions/submittals.ts` is the reference for the shape; the
   `InputError`/`runAction`/`fail()` machinery comes from ./shared (see the
   note above `text()` for why this file no longer has its own copy).

   The owner check is `ownerRefusal`, not `assertOwner`: an action whose type
   promises `{ ok: false, error }` must not refuse by throwing, which is
   #166's rule and what `ownerRefusalCensus.test.ts` enforces. */
/** The three "standing terms with this GC" fields — shared by createContact
 * and updateContact (#218 added them to create; they previously only
 * existed on the update path). */
function standingTermsFromForm(formData: FormData) {
  // A percent, so 0-100 and never a fraction of one: this pre-fills
  // Job.retainagePercent, where 0.10 meaning ten percent used to store a
  // tenth of one percent all the way onto an invoice.
  const defaultRetainagePercent = optionalNumber(formData, "defaultRetainagePercent", {
    label: "Default retainage",
    ...PERCENT_BOUNDS,
    maxDecimals: 2,
  });
  const paymentTermsDays = optionalNumber(formData, "paymentTermsDays", {
    label: "Payment terms",
    integer: true,
    min: 0,
    max: 365,
    unit: " days",
  });
  const standardFormsUsed = text(formData, "standardFormsUsed");

  return {
    defaultRetainagePercent: defaultRetainagePercent?.value ?? null,
    paymentTermsDays: paymentTermsDays?.n ?? null,
    standardFormsUsed: standardFormsUsed || null,
  };
}

/** Invites a teammate by email. They join the OWNER's Company as a MEMBER
 * the next time they sign up with that email — see requireCompanyContext(). */
export async function inviteTeamMember(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  const refusal = ownerRefusal(user, "Only the account owner can invite a teammate");
  if (refusal) return refusal;

  return runAction(async () => {
    const email = required(formData, "email", "Email").toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return fail("Someone with that email already has an account");
    }

    try {
      await prisma.invite.create({ data: { companyId: company.id, email } });
    } catch (error) {
      /* isUniqueConstraintError, not `instanceof
         Prisma.PrismaClientKnownRequestError`: that instanceof is FALSE at
         runtime under this bundling (CLAUDE.md, measured 2026-08-28), so the
         guard written here never fired and a second invite to the same
         address 500'd instead of saying so. */
      if (isUniqueConstraintError(error)) {
        return fail("That email has already been invited (here or elsewhere)");
      }
      throw error;
    }

    revalidatePath("/team");
    return ok;
  });
}

/** Cancels a pending invite (e.g. to fix a typo). */
export async function cancelInvite(inviteId: string): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  const refusal = ownerRefusal(user, "Only the account owner can cancel an invite");
  if (refusal) return refusal;

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.companyId !== company.id) {
    return fail("That invite is no longer there — someone may have cancelled it already.");
  }

  await prisma.invite.delete({ where: { id: inviteId } });

  revalidatePath("/team");
  return ok;
}

/** Removes a MEMBER from the company. Owners can't be removed this way. */
export async function removeTeamMember(memberUserId: string): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  const refusal = ownerRefusal(user, "Only the account owner can remove a teammate");
  if (refusal) return refusal;

  const member = await prisma.user.findUnique({ where: { id: memberUserId } });
  if (!member || member.companyId !== company.id) {
    return fail("That teammate is no longer on this company.");
  }
  if (member.role === "OWNER") {
    return fail("Owners can't be removed here — change the role first.");
  }

  try {
    await prisma.user.delete({ where: { id: memberUserId } });
  } catch (error) {
    /* A teammate with work recorded against them cannot be deleted at all:
       TimeEntry.employeeUser, DispatchSlip.employeeUser and the certification
       holder are REQUIRED relations, which Prisma defaults to RESTRICT. That
       refusal comes from the database, and before this it reached the person
       as a redacted digest on a page that then looked broken. Checked by
       `code` rather than `instanceof`, for the reason isUniqueConstraintError
       documents. */
    if (isForeignKeyViolation(error)) {
      return fail(
        "This teammate has work recorded against them — hours, a dispatch slip or a " +
          "certification — so their account can't be deleted. Clear their job function instead " +
          "to take away access while keeping the record.",
      );
    }
    throw error;
  }

  revalidatePath("/team");
  return ok;
}

/** Adds a new GC/developer/vendor contact directly — not tied to opening a
 * job, so a lead can be recorded the moment a conversation starts, not just
 * once they've actually given us work. Defaults to PROSPECT: a contact
 * created this way has no history yet by definition. */
export async function createContact(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const name = required(formData, "name", "Name");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const address = text(formData, "address");
    const status = optionalEnumFromForm(formData, "status", CONTACT_STATUSES) ?? "PROSPECT";
    const accountType = optionalEnumFromForm(formData, "accountType", CONTACT_TYPES);
    // #218: retainage/payment-terms/forms-used are standing GC terms often
    // already known before the first job — reachable at creation now, not
    // edit-only. MSA expiration and prequalification expiry stay edit-only
    // (see ContactEditForm.tsx): those record a document's expiration date,
    // and a brand new contact typically has no such document yet.
    const standingTerms = standingTermsFromForm(formData);

    await prisma.contact.create({
      data: {
        companyId: company.id,
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        status,
        accountType,
        ...standingTerms,
      },
    });

    revalidatePath("/contacts");
    return ok;
  });
}

/** Deletes a contact with no history. A contact that has jobs or bid
 * invitations stays — same reasoning as deleteSubmittal refusing to delete
 * a sent package: there's real correspondence/work on record, and deleting
 * the contact would strand it with nothing to point at. */
export async function deleteContact(contactId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a contact");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }

    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: { _count: { select: { jobs: true, bidInvitations: true, interactions: true, people: true } } },
    });
    if (!contact || contact.companyId !== context.company.id) return fail("Contact not found");

    // #76: this used to name every count, including the zero ones —
    // "0 job(s) and 3 bid invitation(s)". List only what's actually there.
    const reasons = [
      contact._count.jobs > 0 ? plural(contact._count.jobs, "job", "jobs") : null,
      contact._count.bidInvitations > 0
        ? plural(contact._count.bidInvitations, "bid invitation", "bid invitations")
        : null,
      contact._count.interactions > 0
        ? plural(contact._count.interactions, "logged interaction", "logged interactions")
        : null,
      contact._count.people > 0 ? plural(contact._count.people, "person", "people") : null,
    ].filter((reason): reason is string => reason !== null);

    if (reasons.length > 0) {
      // #218: this used to be `reasons.join(", ")` — comma-only, no "and",
      // unlike deleteSalesLead's equivalent refusal. joinWithConjunction is
      // the shared style both now use.
      return fail(
        `${contact.name} has ${joinWithConjunction(reasons)} on file, so its record stays. Only a contact with no history can be deleted.`,
      );
    }

    await prisma.contact.delete({ where: { id: contactId } });
    revalidatePath("/contacts");
    return ok;
  });
}

/** Direct edit of a contact's details. */
export async function updateContact(contactId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.companyId !== company.id) return fail("Contact not found");

    const name = required(formData, "name", "Name");
    const email = text(formData, "email");
    const phone = text(formData, "phone");
    const address = text(formData, "address");
    const status = optionalEnumFromForm(formData, "status", CONTACT_STATUSES) ?? contact.status;
    const accountType = optionalEnumFromForm(formData, "accountType", CONTACT_TYPES);
    const standingTerms = standingTermsFromForm(formData);
    const msaExpirationDate = optionalDate(formData, "msaExpirationDate");
    const prequalificationExpiresAt = optionalDate(formData, "prequalificationExpiresAt");

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        status,
        accountType,
        ...standingTerms,
        msaExpirationDate,
        prequalificationExpiresAt,
      },
    });

    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/contacts");
    return ok;
  });
}

/** Adds a company location (HQ / branch yard / warehouse). */
export async function createCompanyLocation(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const locationType = enumFromForm(formData, "locationType", LOCATION_TYPES);
  const name = String(formData.get("name") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const addressLine2 = String(formData.get("addressLine2") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const zip = String(formData.get("zip") ?? "").trim();
  const primaryContactName = String(formData.get("primaryContactName") ?? "").trim();
  const primaryContactPhone = String(formData.get("primaryContactPhone") ?? "").trim();

  if (!addressLine1 || !city || !state || !zip) {
    throw new Error("Address, city, state, and zip are required");
  }

  await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      locationType,
      name: name || null,
      addressLine1,
      addressLine2: addressLine2 || null,
      city,
      state,
      zip,
      primaryContactName: primaryContactName || null,
      primaryContactPhone: primaryContactPhone || null,
    },
  });

  revalidatePath("/settings");
}

/** Deletes a company location. Any job pointing at it keeps existing via
 * ON DELETE SET NULL (schema-level), not blocked or cascaded here. */
export async function deleteCompanyLocation(locationId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const location = await prisma.companyLocation.findUnique({ where: { id: locationId } });
  if (!location || location.companyId !== company.id) {
    throw new Error("Location not found");
  }

  await prisma.companyLocation.delete({ where: { id: locationId } });

  revalidatePath("/settings");
}

/** "Is this a yes/no field" parser for the two boolean onboarding answers.
 * A radio group posts the literal strings "true"/"false" — see
 * BusinessScopeFields.tsx — never a checkbox, because a checkbox's absent
 * value and its "unanswered" state are the same wire format and this
 * question needs to tell "no" apart from "not answered yet". */
function requiredBoolean(formData: FormData, key: string, label: string): boolean {
  const raw = text(formData, key);
  if (raw !== "true" && raw !== "false") {
    throw new InputError(`${label} needs a yes or no`);
  }
  return raw === "true";
}

/**
 * The three onboarding questions (issue: onboarding questions) — set once
 * right after signup and editable afterward from Settings, same action
 * either way, matching this codebase's one-`*Fields`-component-for-both
 * rule (`BusinessScopeFields.tsx` is that shared component).
 *
 * See lib/businessScope.ts for what these answers mean and drive; this
 * action only validates and writes them. All three are REQUIRED here —
 * this is the "Save" path, reached by submitting the form with a full set
 * of answers. Leaving the questions unanswered goes through
 * `skipBusinessScopeQuestions` below instead, which is a different action
 * on purpose: this one is not the place a partial answer quietly becomes
 * three nulls.
 *
 * TWO GUARDS, IN THIS ORDER — the same order and the same reason
 * `updateCompanyProfile` gives above. `/settings` (the only page that can
 * reach this action; the onboarding prompt is mounted in the shared layout,
 * not a page, and reaches no capability-guarded door) demands
 * MANAGE_COMPLIANCE, so that is checked first, because it is the broader
 * fact about the person. OWNER-ONLY second: these answers decide what the
 * WHOLE COMPANY's nav shows, not just the caller's own screen, so letting a
 * member set them would be one person choosing the menu for everyone on
 * the team. `ownerRefusal`, not `assertOwner` — this action's declared type
 * promises a readable `{ ok: false, error }`, and production redacts a
 * thrown message to a digest.
 */
export async function saveBusinessScope(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);

    const refusal = ownerRefusal(
      context,
      "Only the account owner can set this — it decides what the whole team's menu shows.",
    );
    if (refusal) return refusal;

    // Said in the person's terms BEFORE the parsers get a turn. The radios
    // are `required`, so a browser refuses an empty Save on its own — but a
    // dispatched submit, an old tab, or a hand-built request reaches here
    // with a group unanswered, and what the parsers would say about that is
    // `"contractingRelationship" must be one of: …`, a sentence addressed to
    // the form rather than to the person filling it in. This is the one
    // that was the raw digest on /welcome (lib/businessScope-save.test.ts).
    const unanswered = (["contractingRelationship", "doesPublicWork", "filesMonthlyPayApps"] as const).filter(
      (key) => !text(formData, key),
    );
    if (unanswered.length > 0) {
      return fail("Answer all three questions to save, or choose Skip for now and come back to this in Settings.");
    }

    const contractingRelationship = enumFromForm(
      formData,
      "contractingRelationship",
      CONTRACTING_RELATIONSHIPS,
    );
    const doesPublicWork = requiredBoolean(formData, "doesPublicWork", "Public / prevailing-wage work");
    const filesMonthlyPayApps = requiredBoolean(
      formData,
      "filesMonthlyPayApps",
      "The monthly pay-application question",
    );

    await prisma.company.update({
      where: { id: context.company.id },
      data: {
        contractingRelationship,
        doesPublicWork,
        filesMonthlyPayApps,
        businessScopeAskedAt: new Date(),
      },
    });

    revalidatePath("/settings");
    return ok;
  });
}

/**
 * "Skip" on the onboarding prompt. Records that the prompt was shown and
 * answered — one way or another — so it never asks again, WITHOUT setting
 * any of the three answers. Per `hasNoScopeAnswers` in lib/businessScope.ts
 * that combination means "show everything," which is the explicit rule
 * this feature is built on: skipping must never hide anything.
 *
 * Same two guards as saveBusinessScope, for the same reason, even though
 * today only the onboarding prompt calls this and that prompt is mounted
 * in the shared layout rather than behind any one guarded page: a stable
 * endpoint answers whoever posts to it, guarded page or not, and a
 * non-owner posting to it directly should be refused for the SAME reason
 * saveBusinessScope refuses one, not a different one. In normal use this
 * should never fire — a non-owner never sees the prompt at all
 * (app/(app)/layout.tsx only mounts it for the account owner).
 */
export async function skipBusinessScopeQuestions(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);

  const refusal = ownerRefusal(
    context,
    "Only the account owner can dismiss this — ask them, or open Settings once they have.",
  );
  if (refusal) return refusal;

  await prisma.company.update({
    where: { id: context.company.id },
    data: { businessScopeAskedAt: new Date() },
  });

  revalidatePath("/settings");
  return ok;
}

/**
 * "Not sure — show me everything again," from Settings. Nulls all three
 * answers and deliberately leaves `businessScopeAskedAt` alone: the prompt
 * already ran once, so it must not come back, but the nav goes straight
 * back to showing every group — the same state as a company that never
 * answered at all, because `hasNoScopeAnswers` cannot tell the two apart
 * and is not supposed to.
 *
 * Same two guards as saveBusinessScope, in the same order, for the same
 * reason — this is the other half of the same Settings form.
 */
export async function clearBusinessScope(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPLIANCE_ONLY);

  const refusal = ownerRefusal(context, "Only the account owner can change this.");
  if (refusal) return refusal;

  await prisma.company.update({
    where: { id: context.company.id },
    data: {
      contractingRelationship: null,
      doesPublicWork: null,
      filesMonthlyPayApps: null,
    },
  });

  revalidatePath("/settings");
  return ok;
}
