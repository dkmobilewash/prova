"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Prisma, prisma } from "@prova/db";
import {
  CONTACT_STATUSES,
  CONTACT_TYPES,
  LOCATION_TYPES,
  TRADE_SCOPES,
  type ActionResult,
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  enumFromForm,
  isUniqueConstraintError,
  nullableDecimalFromForm,
  optionalEnumFromForm,
} from "./shared";

/** Thrown by the form parsers below, caught at each action's boundary and
 * converted to a returned failure — same shape as submittals.ts, the
 * reference implementation for this pattern. */
class InputError extends Error {}

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

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/** Invites a teammate by email. They join the OWNER's Company as a MEMBER
 * the next time they sign up with that email — see requireCompanyContext(). */
export async function inviteTeamMember(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw new Error("Email is required");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error("Someone with that email already has an account");
  }

  try {
    await prisma.invite.create({ data: { companyId: company.id, email } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("That email has already been invited (here or elsewhere)");
    }
    throw error;
  }

  revalidatePath("/team");
}

/** Cancels a pending invite (e.g. to fix a typo). */
export async function cancelInvite(inviteId: string) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.companyId !== company.id) {
    throw new Error("Invite not found");
  }

  await prisma.invite.delete({ where: { id: inviteId } });

  revalidatePath("/team");
}

/** Removes a MEMBER from the company. Owners can't be removed this way. */
export async function removeTeamMember(memberUserId: string) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const member = await prisma.user.findUnique({ where: { id: memberUserId } });
  if (!member || member.companyId !== company.id) {
    throw new Error("Team member not found");
  }
  if (member.role === "OWNER") {
    throw new Error("Owners can't be removed");
  }

  await prisma.user.delete({ where: { id: memberUserId } });

  revalidatePath("/team");
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

    await prisma.contact.create({
      data: {
        companyId: company.id,
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        status,
        accountType,
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

    if (
      contact._count.jobs > 0 ||
      contact._count.bidInvitations > 0 ||
      contact._count.interactions > 0 ||
      contact._count.people > 0
    ) {
      return fail(
        `${contact.name} has ${contact._count.jobs} job(s), ${contact._count.bidInvitations} bid invitation(s), ${contact._count.interactions} logged interaction(s), and ${contact._count.people} people on file, so its record stays. Only a contact with no history can be deleted.`,
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
    const defaultRetainagePercent = nullableDecimalFromForm(formData, "defaultRetainagePercent");
    const paymentTermsDaysRaw = text(formData, "paymentTermsDays");
    const standardFormsUsed = text(formData, "standardFormsUsed");
    const msaExpirationDate = optionalDate(formData, "msaExpirationDate");
    const prequalificationExpiresAt = optionalDate(formData, "prequalificationExpiresAt");

    if (paymentTermsDaysRaw && Number.isNaN(Number(paymentTermsDaysRaw))) {
      return fail('"paymentTermsDays" must be a number');
    }

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        status,
        accountType,
        defaultRetainagePercent,
        paymentTermsDays: paymentTermsDaysRaw ? Number(paymentTermsDaysRaw) : null,
        standardFormsUsed: standardFormsUsed || null,
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

/**
 * assertOwner converted into a RETURNED failure.
 *
 * The actions below return `ActionResult`, and a thrown guard message is
 * redacted to a digest in production — so the sentence explaining what
 * happened never reaches the person it was written for. `deleteContact`
 * above does this conversion inline; it is named here because four
 * actions need it.
 */
/**
 * The capability `/settings` itself is guarded by, asserted again in each
 * action below.
 *
 * Redundant TODAY, on purpose. Every action here also calls `assertOwner`,
 * and an OWNER holds every capability by construction — so no principal
 * currently exists who is refused by the page and admitted by the endpoint.
 * It is here because a page guard is not an action guard (a Server Action
 * is its own endpoint and answers whoever posts to it), and because the
 * moment `UserRole` gains a third value the owner check stops covering for
 * a missing capability check. lib/action-capability-guards.test.ts walks
 * the app for exactly this and would otherwise have four new entries on its
 * debt list, which that file says may only ever shrink.
 */
const COMPANY_RECORDS_ONLY =
  "Company records aren't part of your job function. The account owner sets who sees what, on the Team page.";

function ownerFailure(context: { role: string }, message: string): ActionResult | null {
  try {
    assertOwner(context, message);
    return null;
  } catch (err) {
    return fail(err instanceof Error ? err.message : message);
  }
}

/**
 * The company's own identity: the name a GC reads, plus the legal and
 * contact details every prequalification packet asks for.
 *
 * Until this existed there was NO WRITE TO `Company` ANYWHERE in the app.
 * The name is generated once at first sign-in as `"${name}'s Company"` or
 * `"My Company"` (lib/auth.ts) and was then permanent — so a real
 * subcontractor was stuck being "Dave's Company" in the nav rail, on the
 * client portal, and inside the signed-contract snapshot. Everything from
 * `dbaName` down had been in the schema since it was added with no code
 * that could ever set it.
 *
 * A BLANK NAME IS REFUSED, NOT DEFAULTED. Falling back to anything — the
 * old name, the owner's name, "My Company" — means the field a GC reads on
 * a subcontract can be changed by a mechanism the person editing it never
 * saw happen. A refusal with a sentence is the only version where what is
 * on the contract is always what somebody typed on purpose.
 *
 * Renaming does NOT reach back into a signed contract. `SignatureRequest.
 * snapshot` is a JSON copy taken at the moment of signing, written in
 * exactly one place (`signRequest` in lib/actions/billing.ts, which
 * refuses once status is SIGNED) and read in exactly one place
 * (app/esign/[token]/page.tsx, on the SIGNED branch). Nothing here — and
 * nothing anywhere — recomputes it. company.test.ts pins that.
 */
export async function updateCompanyProfile(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPANY_RECORDS_ONLY);
    const denied = ownerFailure(
      context,
      "Only the account owner can change the company profile — this name is what a GC sees on your contracts.",
    );
    if (denied) return denied;

    const name = text(formData, "name");
    if (!name) {
      return fail(
        "Company name is required — it prints on your contracts and in the client portal, so it can't be blank. Type the name you want a GC to see.",
      );
    }

    await prisma.company.update({
      where: { id: context.company.id },
      data: {
        name,
        dbaName: text(formData, "dbaName") || null,
        ein: text(formData, "ein") || null,
        hqAddressLine1: text(formData, "hqAddressLine1") || null,
        hqAddressLine2: text(formData, "hqAddressLine2") || null,
        hqCity: text(formData, "hqCity") || null,
        hqState: text(formData, "hqState") || null,
        hqZip: text(formData, "hqZip") || null,
        phone: text(formData, "phone") || null,
        website: text(formData, "website") || null,
      },
    });

    revalidatePath("/settings");
    // The name is in the nav rail and the mobile drawer, which live in the
    // (app) layout — so every cached page still holds the old one until the
    // layout itself is invalidated. Rare enough (an owner renaming their
    // company) that the cost of purging is irrelevant next to the rail
    // disagreeing with the settings page.
    revalidatePath("/", "layout");
    return ok;
  });
}

/**
 * Which of the five WWCCA trade families this company self-performs.
 *
 * `CompanyTradeScope` shipped as a model, a migration and a unique index on
 * 24 Aug and had ZERO references in the web app until this — FEATURE-AUDIT
 * sheet 01 called it Built for that whole time. Same shape as the licence
 * and union rows before them.
 *
 * `isPrimary` means one scope, so setting one clears the rest inside the
 * same transaction. A flag that several rows can hold at once says nothing,
 * and "primary" is not something that can be derived from the others.
 */
export async function addCompanyTradeScope(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPANY_RECORDS_ONLY);
    const denied = ownerFailure(
      context,
      "Only the account owner can change which trades this company self-performs.",
    );
    if (denied) return denied;

    const tradeScope = enumFromForm(formData, "tradeScope", TRADE_SCOPES);
    const isPrimary = formData.get("isPrimary") === "on";
    const activeSince = optionalDate(formData, "activeSince");

    try {
      await prisma.$transaction(async (tx) => {
        if (isPrimary) await clearOtherPrimaries(tx, context.company.id, null);
        await tx.companyTradeScope.create({
          data: { companyId: context.company.id, tradeScope, isPrimary, activeSince },
        });
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail("That trade scope is already on this company's list.");
      }
      throw err;
    }

    revalidatePath("/settings");
    return ok;
  });
}

/** Inline edit of one trade scope row. The scope itself can be corrected —
 * picking the wrong one from a list of five is exactly the mistake this
 * needs to be able to undo — so the unique constraint applies here too. */
export async function updateCompanyTradeScope(
  tradeScopeId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPANY_RECORDS_ONLY);
    const denied = ownerFailure(
      context,
      "Only the account owner can change which trades this company self-performs.",
    );
    if (denied) return denied;

    const existing = await prisma.companyTradeScope.findUnique({ where: { id: tradeScopeId } });
    if (!existing || existing.companyId !== context.company.id) {
      return fail("Trade scope not found");
    }

    const tradeScope = enumFromForm(formData, "tradeScope", TRADE_SCOPES);
    const isPrimary = formData.get("isPrimary") === "on";
    const activeSince = optionalDate(formData, "activeSince");

    try {
      await prisma.$transaction(async (tx) => {
        if (isPrimary) await clearOtherPrimaries(tx, context.company.id, tradeScopeId);
        await tx.companyTradeScope.update({
          where: { id: tradeScopeId },
          data: { tradeScope, isPrimary, activeSince },
        });
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail("That trade scope is already on this company's list.");
      }
      throw err;
    }

    revalidatePath("/settings");
    return ok;
  });
}

/** Removes a trade scope. Nothing points at a CompanyTradeScope row — it is
 * a tag on the company, not a parent of any record — so this is a plain
 * delete with no orphan to strand. */
export async function removeCompanyTradeScope(tradeScopeId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    if (!can(context, "MANAGE_COMPLIANCE")) return fail(COMPANY_RECORDS_ONLY);
    const denied = ownerFailure(
      context,
      "Only the account owner can remove a trade scope from this company.",
    );
    if (denied) return denied;

    const existing = await prisma.companyTradeScope.findUnique({ where: { id: tradeScopeId } });
    if (!existing || existing.companyId !== context.company.id) {
      return fail("Trade scope not found");
    }

    await prisma.companyTradeScope.delete({ where: { id: tradeScopeId } });

    revalidatePath("/settings");
    return ok;
  });
}

/** Clears `isPrimary` on every OTHER scope this company holds. Read-then-
 * write rather than `updateMany` so it is one explicit statement per row
 * that actually changes — there are at most five. */
async function clearOtherPrimaries(
  tx: {
    companyTradeScope: {
      findMany: (args: { where: Record<string, unknown> }) => PromiseLike<{ id: string }[]>;
      update: (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => PromiseLike<unknown>;
    };
  },
  companyId: string,
  exceptId: string | null,
) {
  const primaries = await tx.companyTradeScope.findMany({
    where: { companyId, isPrimary: true },
  });
  for (const row of primaries) {
    if (row.id === exceptId) continue;
    await tx.companyTradeScope.update({ where: { id: row.id }, data: { isPrimary: false } });
  }
}
