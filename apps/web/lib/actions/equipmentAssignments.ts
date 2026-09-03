"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";
import { findOverlap, type AssignmentData } from "@/components/equipmentDeployment";

/** Where equipment went, and when it came back.
 *
 * Actions here RETURN their failures. Production redacts a thrown Server
 * Action message, and every guard below is a sentence a dispatcher needs to
 * read — "that lift was already on Maple that week" is useless as a digest.
 */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Stored at UTC midnight so comparisons are calendar-day comparisons. */
function optionalDate(formData: FormData, key: string, label: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new InputError(`${label} is not a valid date`);
  return date;
}

function requiredDate(formData: FormData, key: string, label: string): Date {
  const date = optionalDate(formData, key, label);
  if (!date) throw new InputError(`${label} is required`);
  return date;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

function revalidateAll() {
  revalidatePath("/equipment");
  revalidatePath("/deployment");
}

/** Reads one piece's whole history in the shape the pure overlap check
 * wants. Inside a transaction when the caller passes one, so the read and
 * the write that depends on it can't be split by a second dispatcher. */
async function historyFor(
  tx: { equipmentAssignment: { findMany: (args: unknown) => Promise<unknown[]> } },
  equipmentId: string,
): Promise<AssignmentData[]> {
  const rows = (await tx.equipmentAssignment.findMany({
    where: { equipmentId },
    include: { equipment: { select: { name: true } }, job: { select: { name: true } } },
  })) as Array<{
    id: string;
    equipmentId: string;
    jobId: string;
    sentOutOn: Date;
    returnedOn: Date | null;
    notes: string | null;
    equipment: { name: string };
    job: { name: string };
  }>;

  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    equipmentName: r.equipment.name,
    jobId: r.jobId,
    jobName: r.job.name,
    sentOutOn: iso(r.sentOutOn),
    returnedOn: r.returnedOn ? iso(r.returnedOn) : null,
    notes: r.notes,
  }));
}

function overlapMessage(clash: AssignmentData): string {
  return clash.returnedOn === null
    ? `${clash.equipmentName} is already out on ${clash.jobName} from ${clash.sentOutOn} and hasn't been brought back. Record its return first.`
    : `${clash.equipmentName} was already on ${clash.jobName} from ${clash.sentOutOn} to ${clash.returnedOn}. One piece can't be in two places at once — fix whichever of the two is wrong.`;
}

/** Sends a piece of equipment out to a job. */
export async function assignEquipment(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    const equipmentId = text(formData, "equipmentId");
    const jobId = text(formData, "jobId");
    if (!equipmentId) throw new InputError("Pick a piece of equipment");
    if (!jobId) throw new InputError("Pick a job");

    const sentOutOn = requiredDate(formData, "sentOutOn", "Sent out on");
    const returnedOn = optionalDate(formData, "returnedOn", "Returned on");
    if (returnedOn && returnedOn < sentOutOn) {
      throw new InputError("It can't come back before it went out");
    }

    const [equipment, job] = await Promise.all([
      prisma.equipment.findUnique({ where: { id: equipmentId } }),
      prisma.job.findUnique({ where: { id: jobId } }),
    ]);
    if (!equipment || equipment.companyId !== company.id) return fail("Equipment not found");
    if (!job || job.companyId !== company.id) return fail("Job not found");

    // The overlap read and the insert share a transaction on purpose: two
    // dispatchers sending the same lift to two jobs at the same moment
    // would each read a clean history and both write. There is no unique
    // constraint that can express "no overlapping ranges" — Postgres would
    // need an exclusion constraint and Prisma can't declare one — so the
    // transaction is the only thing standing between us and a record that
    // says a machine was in two places.
    try {
      await prisma.$transaction(async (tx) => {
        const history = await historyFor(tx as never, equipmentId);
        const clash = findOverlap(history, {
          sentOutOn: iso(sentOutOn),
          returnedOn: returnedOn ? iso(returnedOn) : null,
        });
        if (clash) throw new InputError(overlapMessage(clash));

        await tx.equipmentAssignment.create({
          data: {
            companyId: company.id,
            equipmentId,
            jobId,
            sentOutOn,
            returnedOn,
            notes: text(formData, "notes") || null,
            recordedByUserId: user.id,
          },
        });
      });
    } catch (err) {
      if (err instanceof InputError) return fail(err.message);
      throw err;
    }

    revalidateAll();
    return ok;
  });
}

/** Brings a piece back to the yard. */
export async function returnEquipment(
  assignmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const assignment = await prisma.equipmentAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.companyId !== company.id) return fail("Assignment not found");

    const returnedOn = requiredDate(formData, "returnedOn", "Returned on");
    if (returnedOn < assignment.sentOutOn) {
      throw new InputError("It can't come back before it went out");
    }

    await prisma.equipmentAssignment.update({
      where: { id: assignmentId },
      data: { returnedOn },
    });

    revalidateAll();
    return ok;
  });
}

/** Corrects a stay. Dates included: unlike sent correspondence, this is a
 * note about where a machine was, and the common repair is fixing a date
 * somebody guessed at. The overlap rule still applies — a correction that
 * puts the piece in two places is the same error as a new record that
 * does. */
export async function updateEquipmentAssignment(
  assignmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { company } = await requireCompanyContext();
  return runAction(async () => {
    const existing = await prisma.equipmentAssignment.findUnique({ where: { id: assignmentId } });
    if (!existing || existing.companyId !== company.id) return fail("Assignment not found");

    const jobId = text(formData, "jobId") || existing.jobId;
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== company.id) return fail("Job not found");

    const sentOutOn = requiredDate(formData, "sentOutOn", "Sent out on");
    const returnedOn = optionalDate(formData, "returnedOn", "Returned on");
    if (returnedOn && returnedOn < sentOutOn) {
      throw new InputError("It can't come back before it went out");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const history = await historyFor(tx as never, existing.equipmentId);
        const clash = findOverlap(history, {
          sentOutOn: iso(sentOutOn),
          returnedOn: returnedOn ? iso(returnedOn) : null,
          ignoreId: assignmentId,
        });
        if (clash) throw new InputError(overlapMessage(clash));

        await tx.equipmentAssignment.update({
          where: { id: assignmentId },
          data: { jobId, sentOutOn, returnedOn, notes: text(formData, "notes") || null },
        });
      });
    } catch (err) {
      if (err instanceof InputError) return fail(err.message);
      throw err;
    }

    revalidateAll();
    return ok;
  });
}

/** Removes a stay. Owner-only: deleting one silently changes where the app
 * thinks a machine is, and what every utilisation figure over it says. */
export async function deleteEquipmentAssignment(assignmentId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can remove an equipment assignment");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }

    const assignment = await prisma.equipmentAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.companyId !== context.company.id) {
      return fail("Assignment not found");
    }

    await prisma.equipmentAssignment.delete({ where: { id: assignmentId } });
    revalidateAll();
    return ok;
  });
}
