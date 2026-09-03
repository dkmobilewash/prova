"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import {
  CONTACT_STATUSES,
  CONTACT_TYPES,
  LOCATION_TYPES,
  type ActionResult,
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  enumFromForm,
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
