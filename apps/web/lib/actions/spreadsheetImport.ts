"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  TOO_LARGE_MESSAGE,
  dateFromDay,
  importTooLarge,
  nameKey,
  planClientImport,
  planCrewImport,
  planJobImport,
} from "@/lib/spreadsheet-import";
import { looksLikeVcf, planVcfImport, vcfWriteCount } from "@/lib/vcf-import";
import { IMPORT_COLLIDED, IMPORT_TX_OPTIONS, isWriteConflict } from "@/lib/import-shared";
import { isUniqueConstraintError, ownerRefusal, type ActionResultWith } from "./shared";

/**
 * Confirming a spreadsheet import on /settings/import.
 *
 * The page previews with nothing written; these write exactly what the
 * preview showed as "will be created" — and they decide that again, here,
 * from the pasted text and a fresh read of what this company already has.
 * The browser's rows are never trusted, and neither is anything in the
 * upload that names a company: every read and every write is scoped to the
 * session's `companyId`.
 *
 * WHY THE READ IS INSIDE THE TRANSACTION, at SERIALIZABLE. Idempotency here
 * is a read-then-write: "skip what already exists, create the rest". Read
 * outside the transaction, a double-click or two tabs confirming at once
 * would both see nothing there and both create everything. Serializable
 * makes Postgres refuse the second of two overlapping imports rather than
 * let both commit (P2034), and it comes back as a sentence to confirm
 * again — which then finds everything already there and creates nothing.
 *
 * GUARDS, in this order, all RETURNED (production redacts a thrown Server
 * Action message):
 *   1. Owner only — the same guard as /settings/export, which this page
 *      mirrors. Bulk-writing a company's records is administration.
 *   2. The capability that owns what is being created — MANAGE_JOBS for
 *      clients and jobs, MANAGE_FIELD for crew. An owner holds every
 *      capability today, so this cannot refuse anyone who passed (1); it is
 *      here so the import still answers to the capability of what it writes
 *      the day the owner check is loosened, rather than quietly becoming a
 *      way around it.
 */

export type ImportSummary = {
  created: number;
  alreadyThere: number;
  skipped: number;
  /** Clients a jobs import created along the way. */
  clientsCreated?: number;
  message: string;
};

type ImportResult = ActionResultWith<ImportSummary>;

// Shared with the Jobber import (lib/actions/jobber.ts); see lib/import-shared.ts.
const TX_OPTIONS = IMPORT_TX_OPTIONS;
const COLLIDED = IMPORT_COLLIDED;

/** A returned refusal, narrowed to the failure branch so it fits the
 * with-payload result these actions promise. */
function fail(error: string): Extract<ImportResult, { ok: false }> {
  return { ok: false, error };
}

function textFrom(formData: FormData): string | ImportResult {
  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) return fail("Paste your spreadsheet, or choose a file, before confirming.");
  if (importTooLarge(text)) return fail(TOO_LARGE_MESSAGE);
  return text;
}

function sentence(created: number, one: string, many: string, alreadyThere: number, skipped: number): string {
  const parts = [`Added ${created} ${created === 1 ? one : many}.`];
  if (alreadyThere > 0) parts.push(`${alreadyThere} ${alreadyThere === 1 ? "was" : "were"} already here and left alone.`);
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? "row was" : "rows were"} skipped — see the problems listed.`);
  if (created === 0) parts[0] = `Nothing new to add — every ${one} in that file is already here.`;
  return parts.join(" ");
}

/** Clients -> Contact. */
export async function importClients(formData: FormData): Promise<ImportResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import clients.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_JOBS")) {
    return fail("Adding clients isn't part of your job function. Ask the account owner.");
  }
  const text = textFrom(formData);
  if (typeof text !== "string") return text;
  const companyId = context.company.id;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findMany({ where: { companyId }, select: { name: true } });
      const plan = planClientImport(
        text,
        existing.map((contact) => contact.name),
      );
      if (plan.create.length > 0) {
        await tx.contact.createMany({
          data: plan.create.map((row) => ({
            companyId,
            name: row.name,
            accountType: row.accountType,
            email: row.email,
            phone: row.phone,
            address: row.address,
          })),
        });
      }
      return {
        created: plan.create.length,
        alreadyThere: plan.existing.length,
        skipped: plan.problems.length,
        message: sentence(plan.create.length, "client", "clients", plan.existing.length, plan.problems.length),
      };
    }, TX_OPTIONS);

    revalidatePath("/settings/import");
    revalidatePath("/contacts");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(COLLIDED);
    throw err;
  }
}

/**
 * A phone's contacts export (.vcf) -> Contact + ContactPerson.
 *
 * The same machinery as importClients — owner + MANAGE_JOBS, raw text
 * re-planned inside a Serializable transaction against a fresh read — with
 * the two-level shape a vCard actually holds: a card with a company
 * creates or matches that company's Contact and attaches the person to it
 * as a ContactPerson (crm.prisma: the GC is the Contact, the people there
 * are ContactPerson rows); a card without one becomes a Contact named
 * after the person, exactly as the clients spreadsheet would. See
 * lib/vcf-import.ts for the mapping and its refusals.
 */
export async function importVcfContacts(formData: FormData): Promise<ImportResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import contacts.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_JOBS")) {
    return fail("Adding clients isn't part of your job function. Ask the account owner.");
  }
  const text = textFrom(formData);
  if (typeof text !== "string") return text;
  if (!looksLikeVcf(text)) {
    return fail("That doesn't look like a contacts (.vcf) export. Choose the file your phone exported, or paste a spreadsheet instead.");
  }
  const companyId = context.company.id;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      // Oldest first, same reason as importJobs: where two contacts share a
      // name, people attach to the original.
      const contacts = await tx.contact.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      const people = await tx.contactPerson.findMany({
        where: { companyId },
        select: { name: true, contact: { select: { name: true } } },
      });
      const plan = planVcfImport(
        text,
        contacts.map((contact) => contact.name),
        people.map((person) => ({ contactName: person.contact.name, name: person.name })),
      );

      const contactIdByName = new Map<string, string>();
      for (const contact of contacts) {
        const key = nameKey(contact.name);
        if (!contactIdByName.has(key)) contactIdByName.set(key, contact.id);
      }

      if (plan.createContacts.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: plan.createContacts.map((row) => ({
            companyId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            // No accountType: a phone export doesn't say GC or vendor, and
            // guessing would be wrong more often than blank. Set on
            // /contacts later.
          })),
          select: { id: true, name: true },
        });
        for (const contact of created) contactIdByName.set(nameKey(contact.name), contact.id);
      }

      const peopleRows = [
        ...plan.createContacts.flatMap((contact) =>
          contact.people.map((person) => ({ contactName: contact.name, person })),
        ),
        ...plan.attachPeople.map((person) => ({ contactName: person.contactName, person })),
      ];
      if (peopleRows.length > 0) {
        await tx.contactPerson.createMany({
          data: peopleRows.map(({ contactName, person }) => {
            const contactId = contactIdByName.get(nameKey(contactName));
            if (!contactId) throw new Error(`No contact resolved for card ${person.card}`);
            return {
              companyId,
              contactId,
              name: person.name,
              title: person.title,
              email: person.email,
              phone: person.phone,
            };
          }),
        });
      }

      const createdContacts = plan.createContacts.length;
      const createdPeople = peopleRows.length;
      const parts = [
        createdContacts === 0 && createdPeople === 0
          ? "Nothing new to add — everyone in that file is already here."
          : `Added ${createdContacts} ${createdContacts === 1 ? "contact" : "contacts"}${
              createdPeople > 0
                ? ` and ${createdPeople} ${createdPeople === 1 ? "person" : "people"} at them`
                : ""
            }.`,
      ];
      if (plan.existing.length > 0) {
        parts.push(
          `${plan.existing.length} ${plan.existing.length === 1 ? "was" : "were"} already here and left alone.`,
        );
      }
      if (plan.problems.length > 0) {
        parts.push(
          `${plan.problems.length} ${plan.problems.length === 1 ? "card was" : "cards were"} skipped — see the problems listed.`,
        );
      }
      return {
        created: vcfWriteCount(plan),
        alreadyThere: plan.existing.length,
        skipped: plan.problems.length,
        message: parts.join(" "),
      };
    }, TX_OPTIONS);

    revalidatePath("/settings/import");
    revalidatePath("/contacts");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(COLLIDED);
    throw err;
  }
}

/** Jobs -> Job, creating any client the file names that isn't here yet. */
export async function importJobs(formData: FormData): Promise<ImportResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import jobs.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_JOBS")) {
    return fail("Adding jobs isn't part of your job function. Ask the account owner.");
  }
  const text = textFrom(formData);
  if (typeof text !== "string") return text;
  const companyId = context.company.id;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      // Oldest first, so where a company already has two contacts with one
      // name (createJob minted one per job until it stopped), the import
      // attaches to the original rather than to whichever came back first.
      const contacts = await tx.contact.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      const jobs = await tx.job.findMany({
        where: { companyId },
        select: { name: true, contact: { select: { name: true } } },
      });
      const plan = planJobImport(
        text,
        contacts.map((contact) => contact.name),
        jobs.map((job) => ({ name: job.name, clientName: job.contact.name })),
      );

      const contactIdByName = new Map<string, string>();
      for (const contact of contacts) {
        const key = nameKey(contact.name);
        if (!contactIdByName.has(key)) contactIdByName.set(key, contact.id);
      }

      if (plan.newClients.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: plan.newClients.map((name) => ({ companyId, name })),
          select: { id: true, name: true },
        });
        for (const contact of created) contactIdByName.set(nameKey(contact.name), contact.id);
      }

      if (plan.create.length > 0) {
        await tx.job.createMany({
          data: plan.create.map((row) => {
            const contactId = contactIdByName.get(nameKey(row.clientName));
            if (!contactId) throw new Error(`No contact resolved for line ${row.line}`);
            return {
              companyId,
              contactId,
              name: row.name,
              scope: row.scope,
              // Always. See the note at the top of lib/spreadsheet-import.ts:
              // contracting is markJobContracted's decision, with evidence.
              status: "ESTIMATE" as const,
              startDate: row.startDate ? dateFromDay(row.startDate) : null,
              endDate: row.endDate ? dateFromDay(row.endDate) : null,
            };
          }),
        });
      }

      const base = sentence(plan.create.length, "job", "jobs", plan.existing.length, plan.problems.length);
      const clients = plan.newClients.length;
      return {
        created: plan.create.length,
        alreadyThere: plan.existing.length,
        skipped: plan.problems.length,
        clientsCreated: clients,
        message:
          clients > 0 ? `${base} ${clients} new ${clients === 1 ? "client was" : "clients were"} added for them.` : base,
      };
    }, TX_OPTIONS);

    revalidatePath("/settings/import");
    revalidatePath("/dashboard");
    revalidatePath("/contacts");
    revalidatePath("/schedule");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(COLLIDED);
    throw err;
  }
}

/** Crew -> CrewMember. */
export async function importCrew(formData: FormData): Promise<ImportResult> {
  const context = await requireCompanyContext();
  const refusal = ownerRefusal(context, "Only the account owner can import crew.");
  if (refusal) return refusal;
  if (!can(context, "MANAGE_FIELD")) {
    return fail("Adding crew isn't part of your job function. Ask the account owner.");
  }
  const text = textFrom(formData);
  if (typeof text !== "string") return text;
  const companyId = context.company.id;

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const existing = await tx.crewMember.findMany({
        where: { companyId },
        select: { legalFirstName: true, legalMiddleName: true, legalLastName: true, employeeNumber: true },
      });
      const plan = planCrewImport(text, existing);
      if (plan.create.length > 0) {
        await tx.crewMember.createMany({
          data: plan.create.map((row) => ({
            companyId,
            legalFirstName: row.legalFirstName,
            legalMiddleName: row.legalMiddleName,
            legalLastName: row.legalLastName,
            employeeNumber: row.employeeNumber,
            identifyingNumberLast4: row.identifyingNumberLast4,
            phone: row.phone,
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            city: row.city,
            state: row.state,
            zip: row.zip,
            hiredOn: row.hiredOn ? dateFromDay(row.hiredOn) : null,
          })),
        });
      }
      return {
        created: plan.create.length,
        alreadyThere: plan.existing.length,
        skipped: plan.problems.length,
        message: sentence(plan.create.length, "crew member", "crew members", plan.existing.length, plan.problems.length),
      };
    }, TX_OPTIONS);

    revalidatePath("/settings/import");
    revalidatePath("/schedule");
    return { ok: true, value: summary };
  } catch (err) {
    if (isWriteConflict(err)) return fail(COLLIDED);
    if (isUniqueConstraintError(err)) {
      return fail(
        "One of those employee numbers was given to someone else on your crew list while this was saving, so nothing was saved. Check the preview and confirm again.",
      );
    }
    throw err;
  }
}
