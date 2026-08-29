"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
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
 * comparisons — same rule as RFIs, submittals and material orders. */
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

/** Where the set actually lives — Procore, Box, the GC's portal. Stored as
 * a link rather than an upload: a drawing set is tens of megabytes and a
 * Server Action body is capped around 1MB, so an upload here would fail
 * for every real set while passing for a test file. Only http(s) is
 * accepted; a `javascript:` or `data:` URL rendered as a link would be an
 * injection vector, since this string is put straight into an href. */
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

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

async function findSet(setId: string, companyId: string) {
  const set = await prisma.drawingSet.findUnique({
    where: { id: setId },
    include: { revisions: true },
  });
  if (!set || set.companyId !== companyId) return null;
  return set;
}

export async function createDrawingSet(formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const jobId = required(formData, "jobId", "Job");
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const name = required(formData, "name", "Set name");

    try {
      await prisma.drawingSet.create({
        data: {
          companyId: company.id,
          jobId,
          name,
          description: text(formData, "description") || null,
        },
      });
    } catch (err) {
      // @@unique([jobId, name]). Two sets called "Architectural" on one job
      // would make "which is current" unanswerable, which is the one
      // question this page exists to answer.
      if (isUniqueConstraintError(err)) {
        return fail(`This job already has a set called "${name}"`);
      }
      throw err;
    }

    revalidatePath("/drawings");
    return ok;
  });
}

export async function updateDrawingSet(setId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const set = await findSet(setId, company.id);
    if (!set) return fail("Drawing set not found");

    const name = required(formData, "name", "Set name");

    try {
      await prisma.drawingSet.update({
        where: { id: set.id },
        data: { name, description: text(formData, "description") || null },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return fail(`This job already has a set called "${name}"`);
      }
      throw err;
    }

    revalidatePath("/drawings");
    return ok;
  });
}

export async function deleteDrawingSet(setId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a drawing set");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const set = await findSet(setId, context.company.id);
    if (!set) return fail("Drawing set not found");

    // Once issues are recorded against a set, the record of which revision
    // governed on which date is the point of it — that is what gets read
    // back when someone asks why the crew built what they built.
    if (set.revisions.length > 0) {
      return fail(
        "This set has issued revisions recorded against it, so its record stays. Remove the revisions first if it was logged in error.",
      );
    }

    await prisma.drawingSet.delete({ where: { id: set.id } });
    revalidatePath("/drawings");
    return ok;
  });
}

/** Records an issue of a set. `receivedOn` is optional on purpose: the
 * state worth seeing is exactly the one where a revision has been issued
 * and has NOT reached us. */
export async function recordDrawingRevision(setId: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const set = await findSet(setId, company.id);
    if (!set) return fail("Drawing set not found");

    const label = required(formData, "label", "Revision label");
    const issuedOn = requiredDate(formData, "issuedOn", "Date issued");
    const receivedOn = optionalDate(formData, "receivedOn");
    if (receivedOn && receivedOn < issuedOn) {
      return fail("It can't have reached us before it was issued");
    }

    try {
      await prisma.drawingRevision.create({
        data: {
          setId: set.id,
          label,
          issuedOn,
          receivedOn,
          description: text(formData, "description") || null,
          fileUrl: optionalLink(formData, "fileUrl"),
          fileName: text(formData, "fileName") || null,
          recordedByUserId: user.id,
        },
      });
    } catch (err) {
      // @@unique([setId, label]). One label pointing at two different
      // issues of the same set is the drawing-log equivalent of a reissued
      // submittal number — the whole job refers to it by that label.
      if (isUniqueConstraintError(err)) {
        return fail(`"${label}" is already recorded against this set`);
      }
      throw err;
    }

    revalidatePath("/drawings");
    return ok;
  });
}

/** Corrects a recorded issue, and is how "it arrived" gets recorded. */
export async function updateDrawingRevision(revisionId: string, formData: FormData): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const revision = await prisma.drawingRevision.findUnique({
      where: { id: revisionId },
      include: { set: { select: { companyId: true } } },
    });
    if (!revision || revision.set.companyId !== company.id) return fail("Revision not found");

    // The issue date is the architect's, printed on the title block, and
    // it is what "current" is derived from — it is not ours to move. The
    // received date is ours and stays correctable.
    const receivedOn = optionalDate(formData, "receivedOn");
    if (receivedOn && receivedOn < revision.issuedOn) {
      return fail(
        `That's before ${isoDay(revision.issuedOn)}, the date it was issued — it can't have reached us first`,
      );
    }

    await prisma.drawingRevision.update({
      where: { id: revision.id },
      data: {
        receivedOn,
        description: text(formData, "description") || null,
        fileUrl: optionalLink(formData, "fileUrl"),
        fileName: text(formData, "fileName") || null,
      },
    });

    revalidatePath("/drawings");
    return ok;
  });
}

export async function deleteDrawingRevision(revisionId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a drawing revision");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }
    const revision = await prisma.drawingRevision.findUnique({
      where: { id: revisionId },
      include: { set: { select: { companyId: true } } },
    });
    if (!revision || revision.set.companyId !== context.company.id) return fail("Revision not found");

    await prisma.drawingRevision.delete({ where: { id: revision.id } });
    revalidatePath("/drawings");
    return ok;
  });
}
