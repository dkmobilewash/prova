"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { INTERACTION_TYPES, actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

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

function requiredEnum<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
  label: string,
): T[number] {
  const raw = text(formData, key);
  if (!allowed.includes(raw as T[number])) throw new InputError(`Pick ${label}`);
  return raw as T[number];
}

/** Stored at UTC midnight, same rule as every other date in this app. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError("Date is not valid");
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key);
  if (!date) throw new InputError(`${label} is required`);
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

async function findInteraction(interactionId: string, companyId: string) {
  const interaction = await prisma.contactInteraction.findUnique({ where: { id: interactionId } });
  if (!interaction || interaction.companyId !== companyId) return null;
  return interaction;
}

async function findContactPerson(personId: string, companyId: string) {
  const person = await prisma.contactPerson.findUnique({ where: { id: personId } });
  if (!person || person.companyId !== companyId) return null;
  return person;
}

/** Validates an optional "who this was with" against the contact this
 * interaction is being logged/edited on -- a person from a different
 * account can't be picked here even if they exist in this company. */
async function readContactPersonField(formData: FormData, companyId: string, contactId: string) {
  const contactPersonId = text(formData, "contactPersonId") || null;
  if (!contactPersonId) return null;
  const person = await findContactPerson(contactPersonId, companyId);
  if (!person || person.contactId !== contactId) {
    throw new InputError("Contact person not found");
  }
  return contactPersonId;
}

/** Validates an optional follow-up assignee belongs to this company, and
 * that a set follow-up date isn't before the interaction it follows from. */
async function readFollowUpFields(formData: FormData, companyId: string, occurredOn: Date) {
  const followUpOn = optionalDate(formData, "followUpOn");
  const followUpAssignedToUserId = text(formData, "followUpAssignedToUserId") || null;

  if (followUpAssignedToUserId) {
    const assignee = await prisma.user.findUnique({ where: { id: followUpAssignedToUserId } });
    if (!assignee || assignee.companyId !== companyId) {
      throw new InputError("Follow-up assignee not found");
    }
  }
  if (followUpOn && followUpOn < occurredOn) {
    throw new InputError("The follow-up date can't be before the interaction date");
  }

  return { followUpOn, followUpAssignedToUserId };
}

/** Logs a touchpoint with a contact -- a call, email, site visit, or plain
 * note. Not gated to the account owner: any team member who talks to a GC
 * can log it, same reasoning as bid invitations on this same page. */
export async function createContactInteraction(contactId: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.companyId !== company.id) return fail("Contact not found");

    const type = requiredEnum(formData, "type", INTERACTION_TYPES, "what kind of interaction this was");
    const occurredOn = requiredDate(formData, "occurredOn", "Date");
    const summary = required(formData, "summary", "Summary");
    const { followUpOn, followUpAssignedToUserId } = await readFollowUpFields(formData, company.id, occurredOn);
    const contactPersonId = await readContactPersonField(formData, company.id, contactId);

    await prisma.contactInteraction.create({
      data: {
        companyId: company.id,
        contactId,
        type,
        occurredOn,
        summary,
        followUpOn,
        followUpAssignedToUserId,
        contactPersonId,
        loggedByUserId: user.id,
      },
    });

    revalidatePath(`/contacts/${contactId}`);
    return ok;
  });
}

/** Corrects a logged interaction -- fixing a typo or a wrong date. Who
 * logged it stays as it was; that's an audit fact, not an editable field. */
export async function updateContactInteraction(interactionId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const interaction = await findInteraction(interactionId, company.id);
    if (!interaction) return fail("Interaction not found");

    const type = requiredEnum(formData, "type", INTERACTION_TYPES, "what kind of interaction this was");
    const occurredOn = requiredDate(formData, "occurredOn", "Date");
    const summary = required(formData, "summary", "Summary");
    const { followUpOn, followUpAssignedToUserId } = await readFollowUpFields(formData, company.id, occurredOn);
    const contactPersonId = await readContactPersonField(formData, company.id, interaction.contactId);

    await prisma.contactInteraction.update({
      where: { id: interactionId },
      data: { type, occurredOn, summary, followUpOn, followUpAssignedToUserId, contactPersonId },
    });

    revalidatePath(`/contacts/${interaction.contactId}`);
    return ok;
  });
}

export async function deleteContactInteraction(interactionId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const interaction = await findInteraction(interactionId, company.id);
    if (!interaction) return fail("Interaction not found");

    await prisma.contactInteraction.delete({ where: { id: interactionId } });

    revalidatePath(`/contacts/${interaction.contactId}`);
    return ok;
  });
}

/** Adds a named person at a Contact's company (e.g. their PM or estimator).
 * Not gated to the account owner -- same reasoning as interactions: anyone
 * on the team who deals with a GC can keep the list of who's who current. */
export async function createContactPerson(contactId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.companyId !== company.id) return fail("Contact not found");

    const name = required(formData, "name", "Name");
    const title = text(formData, "title");
    const email = text(formData, "email");
    const phone = text(formData, "phone");

    await prisma.contactPerson.create({
      data: {
        companyId: company.id,
        contactId,
        name,
        title: title || null,
        email: email || null,
        phone: phone || null,
      },
    });

    revalidatePath(`/contacts/${contactId}`);
    return ok;
  });
}

export async function updateContactPerson(personId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const person = await findContactPerson(personId, company.id);
    if (!person) return fail("Contact person not found");

    const name = required(formData, "name", "Name");
    const title = text(formData, "title");
    const email = text(formData, "email");
    const phone = text(formData, "phone");

    await prisma.contactPerson.update({
      where: { id: personId },
      data: { name, title: title || null, email: email || null, phone: phone || null },
    });

    revalidatePath(`/contacts/${person.contactId}`);
    return ok;
  });
}

/** Deleting a person never blocks on their interaction history -- see the
 * onDelete: SetNull on ContactInteraction.contactPersonId in crm.prisma.
 * Those rows stay, just no longer attributed to a specific person. */
export async function deleteContactPerson(personId: string): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const person = await findContactPerson(personId, company.id);
    if (!person) return fail("Contact person not found");

    await prisma.contactPerson.delete({ where: { id: personId } });

    revalidatePath(`/contacts/${person.contactId}`);
    return ok;
  });
}
