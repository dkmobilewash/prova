"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { CERTIFICATION_KINDS, certificationTitle } from "@/lib/certifications";
import {
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  isUniqueConstraintError,
  type ActionResult,
} from "./shared";

/** Actions in this module RETURN their failures instead of throwing them.
 *
 * Next.js redacts the message of any error thrown from a Server Action in
 * a production build, so a plain-language guard degrades to an opaque
 * digest for a real user. The `ActionResult` type and its helpers live in
 * `./shared`; `lib/actions/submittals.ts` is the reference.
 */

/** Thrown by the parsers below, caught at each action's boundary. Anything
 * else that throws is a real bug and is rethrown. */
class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

/** Stored at UTC midnight so date comparisons are calendar-day
 * comparisons — same rule as RFIs, submittals, drawings and material
 * orders. */
function optionalDate(formData: FormData, key: string, label: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a valid date`);
  return date;
}

/** A link rather than an upload — a Server Action body is capped around
 * 1MB, and a photo of a card taken on a phone will exceed it. Only http(s)
 * is accepted: this string goes straight into an href, so a `javascript:`
 * or `data:` URL would be an injection vector. Same guard as drawings. */
function optionalLink(formData: FormData, key: string): string | null {
  const raw = text(formData, key);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputError("The link needs to be a full URL, starting with https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InputError("The link needs to start with https://");
  }
  return parsed.toString();
}

type Kind = (typeof CERTIFICATION_KINDS)[number];

function kindFromForm(formData: FormData): Kind {
  const raw = text(formData, "kind");
  if (!CERTIFICATION_KINDS.includes(raw as Kind)) {
    throw new InputError("Choose what kind of certification this is");
  }
  return raw as Kind;
}

/** OTHER carries its own name and is useless without one — "Other,
 * expiring in 12 days" tells a foreman nothing he can act on. Every other
 * kind ignores the field rather than storing a stray label that would
 * silently change what the row matches against. */
function otherLabelFor(kind: Kind, formData: FormData): string | null {
  if (kind !== "OTHER") return null;
  return required(formData, "otherLabel", "A name for this certification");
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/** Records a card, class or fit test against one person.
 *
 * A renewal is a NEW row, never an edit of the old one: the record of what
 * was valid on the day of an incident is the thing that gets read back
 * afterwards, and overwriting it destroys exactly that.
 */
export async function recordWorkerCertification(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const holderUserId = required(formData, "holderUserId", "Who holds it");
    const holder = await prisma.user.findUnique({ where: { id: holderUserId } });
    if (!holder || holder.companyId !== company.id) return fail("That person isn't on your team");

    const kind = kindFromForm(formData);
    const otherLabel = otherLabelFor(kind, formData);

    const issuedOn = optionalDate(formData, "issuedOn", "The issue date");
    const expiresOn = optionalDate(formData, "expiresOn", "The expiry date");
    if (issuedOn && expiresOn && expiresOn < issuedOn) {
      return fail("It can't expire before it was issued");
    }

    await prisma.workerCertification.create({
      data: {
        companyId: company.id,
        holderUserId: holder.id,
        kind,
        otherLabel,
        issuer: text(formData, "issuer") || null,
        referenceNumber: text(formData, "referenceNumber") || null,
        issuedOn,
        expiresOn,
        notes: text(formData, "notes") || null,
        documentUrl: optionalLink(formData, "documentUrl"),
        documentLabel: text(formData, "documentLabel") || null,
        recordedByUserId: user.id,
      },
    });

    revalidatePath("/certifications");
    return ok;
  });
}

/** Corrects a recorded card.
 *
 * Holder and kind are NOT editable, and that is deliberate: they are the
 * identity of the record, the same way an RFI's job and number are. Moving
 * a card to another person or relabelling what it is would silently
 * rewrite who was qualified on a past date, which is precisely what this
 * log is read for. Wrong on both counts, delete it and record it again.
 */
export async function updateWorkerCertification(
  certificationId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const existing = await prisma.workerCertification.findUnique({
      where: { id: certificationId },
    });
    if (!existing || existing.companyId !== company.id) return fail("Certification not found");

    const issuedOn = optionalDate(formData, "issuedOn", "The issue date");
    const expiresOn = optionalDate(formData, "expiresOn", "The expiry date");
    if (issuedOn && expiresOn && expiresOn < issuedOn) {
      return fail("It can't expire before it was issued");
    }

    await prisma.workerCertification.update({
      where: { id: existing.id },
      data: {
        // otherLabel travels with the kind, which is locked, so it is only
        // editable for the kind that has one.
        otherLabel:
          existing.kind === "OTHER"
            ? required(formData, "otherLabel", "A name for this certification")
            : existing.otherLabel,
        issuer: text(formData, "issuer") || null,
        referenceNumber: text(formData, "referenceNumber") || null,
        issuedOn,
        expiresOn,
        notes: text(formData, "notes") || null,
        documentUrl: optionalLink(formData, "documentUrl"),
        documentLabel: text(formData, "documentLabel") || null,
      },
    });

    revalidatePath("/certifications");
    return ok;
  });
}

export async function deleteWorkerCertification(certificationId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a certification record");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }

    const existing = await prisma.workerCertification.findUnique({
      where: { id: certificationId },
    });
    if (!existing || existing.companyId !== context.company.id) {
      return fail("Certification not found");
    }

    await prisma.workerCertification.delete({ where: { id: existing.id } });
    revalidatePath("/certifications");
    return ok;
  });
}

/** Declares that everyone on the team needs this.
 *
 * Without a requirement, a worker who has never held a card at all is
 * indistinguishable from one who does not need it — the roster can only
 * report on rows somebody entered. This is what turns an absence into a
 * finding.
 */
export async function addCertificationRequirement(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const kind = kindFromForm(formData);
    // NOT NULL with an empty-string default on this model, unlike
    // WorkerCertification's nullable one — see certifications.prisma. A
    // nullable column in the unique key would let two identical rows land,
    // because Postgres treats NULLs in a unique index as distinct.
    const otherLabel = kind === "OTHER" ? (otherLabelFor(kind, formData) ?? "") : "";

    try {
      await prisma.certificationRequirement.create({
        data: {
          companyId: company.id,
          kind,
          otherLabel,
          notes: text(formData, "notes") || null,
        },
      });
    } catch (err) {
      // @@unique([companyId, kind, otherLabel]). Requiring the same thing
      // twice would report the same gap twice against every worker.
      if (isUniqueConstraintError(err)) {
        return fail(`${certificationTitle(kind, otherLabel || null)} is already required`);
      }
      throw err;
    }

    revalidatePath("/certifications");
    return ok;
  });
}

export async function removeCertificationRequirement(requirementId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can change what the company requires");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }

    const existing = await prisma.certificationRequirement.findUnique({
      where: { id: requirementId },
    });
    if (!existing || existing.companyId !== context.company.id) {
      return fail("Requirement not found");
    }

    await prisma.certificationRequirement.delete({ where: { id: existing.id } });
    revalidatePath("/certifications");
    return ok;
  });
}
