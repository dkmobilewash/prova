"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { LOCATION_TYPES, assertOwner, enumFromForm, nullableDecimalFromForm } from "./shared";

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

/** Direct edit of a contact's details. */
export async function updateContact(contactId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const defaultRetainagePercent = nullableDecimalFromForm(formData, "defaultRetainagePercent");
  const paymentTermsDaysRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const standardFormsUsed = String(formData.get("standardFormsUsed") ?? "").trim();

  if (!name) {
    throw new Error("Name is required");
  }
  if (paymentTermsDaysRaw && Number.isNaN(Number(paymentTermsDaysRaw))) {
    throw new Error('"paymentTermsDays" must be a number');
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      name,
      email: email || null,
      phone: phone || null,
      address: address || null,
      defaultRetainagePercent,
      paymentTermsDays: paymentTermsDaysRaw ? Number(paymentTermsDaysRaw) : null,
      standardFormsUsed: standardFormsUsed || null,
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
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
