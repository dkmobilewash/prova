"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { assertOwner } from "./shared";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new Error(`${label} is required`);
  return value;
}

/** Every date in this module is stored at UTC midnight so that comparisons
 * between them are comparisons between calendar days, not instants. */
function utcMidnight(date: Date) {
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Dates are stored at UTC midnight and rendered in UTC, same rule as the
 * safety log and daily field reports. */
function optionalDate(formData: FormData, key: string): Date | null {
  const raw = text(formData, key);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Date is not valid");
  return date;
}

async function assertJob(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) throw new Error("Job not found");
  return job;
}

async function assertRfi(rfiId: string, companyId: string) {
  const rfi = await prisma.rfi.findUnique({ where: { id: rfiId } });
  if (!rfi || rfi.companyId !== companyId) throw new Error("RFI not found");
  return rfi;
}

/** Issues the next RFI number for a job.
 *
 * Reads nothing from Rfi on purpose — see SafetyCaseCounter. A number taken
 * from `max(number) + 1` is freed again when the highest RFI is deleted, so
 * the next one reissues it, and a GC referencing "RFI 12" would then be
 * pointing at two different questions. Takes a transaction client so the
 * increment and the insert are one step; two people raising an RFI on the
 * same job at the same moment would otherwise both read the same value.
 */
async function issueRfiNumber(tx: Prisma.TransactionClient, jobId: string) {
  const counter = await tx.rfiCounter.upsert({
    where: { jobId },
    create: { jobId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

export async function createRfi(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const jobId = required(formData, "jobId", "Job");
  await assertJob(jobId, company.id);

  const subject = required(formData, "subject", "Subject");
  const question = required(formData, "question", "Question");
  const drawingReference = text(formData, "drawingReference");
  const specSection = text(formData, "specSection");
  const dueBy = optionalDate(formData, "dueBy");

  // The sent date is entered, not stamped. Stamping it `now` made the first
  // real use of this feature impossible: entering the RFIs you already sent
  // over the last three weeks would record them all as sent today, and the
  // response-time evidence — the entire point of the log — would be fiction.
  // Blank means it hasn't gone out yet, which is what a draft is.
  const sentOn = optionalDate(formData, "sentOn");

  await prisma.$transaction(async (tx) => {
    await tx.rfi.create({
      data: {
        companyId: company.id,
        jobId,
        number: await issueRfiNumber(tx, jobId),
        subject,
        question,
        drawingReference: drawingReference || null,
        specSection: specSection || null,
        dueBy,
        status: sentOn ? "SENT" : "DRAFT",
        sentOn,
        askedByUserId: user.id,
      },
    });
  });

  revalidatePath("/rfis");
}

export async function updateRfi(rfiId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const rfi = await assertRfi(rfiId, company.id);

  const sentOn = optionalDate(formData, "sentOn");

  // Once an RFI has been sent it can never become a draft again.
  //
  // This is not tidiness. `deleteRfi` allows deleting drafts only, so
  // without this guard the delete rule is bypassable entirely through the
  // normal UI: edit a sent RFI, clear the date, save — it is now a draft —
  // delete it. That destroys correspondence the GC also holds and leaves a
  // permanent hole in the numbering. The weaker version of the same bug
  // loses the original send date, which is the evidence the log exists for.
  if (rfi.sentOn && !sentOn) {
    throw new Error("This RFI has already been sent, so it can't go back to being a draft");
  }
  if (sentOn && rfi.answeredOn && sentOn > rfi.answeredOn) {
    throw new Error("The sent date can't be after the date the answer came back");
  }

  // Job and number are the identity of a sent RFI — a GC has them in
  // writing. Neither is editable here; a wrong job means a new RFI.
  await prisma.rfi.update({
    where: { id: rfi.id },
    data: {
      subject: required(formData, "subject", "Subject"),
      question: required(formData, "question", "Question"),
      drawingReference: text(formData, "drawingReference") || null,
      specSection: text(formData, "specSection") || null,
      dueBy: optionalDate(formData, "dueBy"),
      sentOn,
      // Editing an RFI must never change where it sits in the workflow.
      // Deriving status purely from the dates put a withdrawn (CLOSED,
      // never answered) RFI back on the open list the moment someone
      // fixed a typo in its subject. A draft that has just been given a
      // sent date is the one real transition, and it is the only one.
      status: rfi.status === "DRAFT" && sentOn ? "SENT" : rfi.status,
    },
  });

  revalidatePath("/rfis");
}

/** Stamps the sent date. Separate from create because the date it left our
 * hands is the fact the log exists to hold. */
export async function markRfiSent(rfiId: string) {
  const { company } = await requireCompanyContext();
  const rfi = await assertRfi(rfiId, company.id);
  if (rfi.status !== "DRAFT") throw new Error("This RFI has already been sent");

  await prisma.rfi.update({
    where: { id: rfi.id },
    // UTC midnight, like every other date here. Storing the wall-clock
    // instant instead made a same-day answer impossible: the answer date
    // normalises to midnight, so it compared as EARLIER than a send
    // stamped at 14:30, and the guard rejected it with a message blaming
    // the user for data that was correct.
    data: { status: "SENT", sentOn: utcMidnight(new Date()) },
  });
  revalidatePath("/rfis");
}

export async function answerRfi(rfiId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const rfi = await assertRfi(rfiId, company.id);
  if (rfi.status === "DRAFT") throw new Error("Send this RFI before recording an answer");

  const answeredAt = optionalDate(formData, "answeredOn") ?? utcMidnight(new Date());

  // An answer that arrived before the question was asked discredits the
  // whole log — and a log that can hold one is worth nothing in a dispute.
  if (rfi.sentOn && answeredAt < rfi.sentOn) {
    throw new Error("The answer can't have come back before the RFI was sent");
  }

  await prisma.rfi.update({
    where: { id: rfi.id },
    data: {
      answer: required(formData, "answer", "Answer"),
      // The date the answer came back, not the date it was typed in — an
      // answer entered a week late must not read as a week-late response.
      answeredOn: answeredAt,
      status: "ANSWERED",
      costImpact: formData.get("costImpact") === "on",
      scheduleImpact: formData.get("scheduleImpact") === "on",
    },
  });

  revalidatePath("/rfis");
}

export async function setRfiClosed(rfiId: string, closed: boolean) {
  const { company } = await requireCompanyContext();
  const rfi = await assertRfi(rfiId, company.id);
  if (closed && rfi.status === "DRAFT") throw new Error("An unsent RFI can be deleted, not closed");

  await prisma.rfi.update({
    where: { id: rfi.id },
    data: { status: closed ? "CLOSED" : rfi.answeredOn ? "ANSWERED" : "SENT" },
  });
  revalidatePath("/rfis");
}

export async function deleteRfi(rfiId: string) {
  const context = await requireCompanyContext();
  assertOwner(context, "Only the account owner can delete an RFI draft");
  const rfi = await assertRfi(rfiId, context.company.id);

  // Deleting a sent RFI destroys correspondence the GC also holds. Close
  // it instead — the number stays retired either way, but the record of
  // having asked survives.
  if (rfi.status !== "DRAFT") {
    throw new Error("Only an unsent draft can be deleted. Close this RFI instead.");
  }

  await prisma.rfi.delete({ where: { id: rfi.id } });
  revalidatePath("/rfis");
}
