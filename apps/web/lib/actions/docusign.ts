"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import {
  DocuSignApiError,
  createDocuSignEnvelope,
  readDocuSignConfig,
  voidDocuSignEnvelope as voidAtDocuSign,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { money } from "@/lib/money";
import { viewerTimeZone } from "@/lib/viewerToday";
import { documentUrlProblem } from "@/lib/document-uploads";
import { docuSignConnectUrl } from "@/lib/docusign/constants";
import { DOCUSIGN_WEBHOOK_ENV } from "@/lib/docusign/setup";
import {
  DocuSignNotConfiguredError,
  DocuSignNotConnectedError,
  DocuSignReconnectError,
  withDocuSign,
} from "@/lib/docusign/connection";
import { EnvelopeNotFoundError, syncDocuSignEnvelope } from "@/lib/docusign/sync";
import { normaliseTimeZone } from "@/lib/docusign/envelope-status";
import {
  base64Utf8,
  changeOrderHtml,
  contractSummaryHtml,
  contractSummarySnapshot,
  describeChangeOrderProposal,
  type ChangeOrderSnapshot,
} from "@/lib/docusign/documents";
import {
  buildEnvelopeDefinition,
  emailSubjectFor,
  readSigners,
  type EnvelopeDocument,
} from "@/lib/docusign/envelope-request";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * Send with DocuSign — the alternative to C Stream's own signing link, on the
 * job page's contract section, on each uploaded contract document, and on a
 * submitted change order. The built-in link stays the default; nothing here
 * touches SignatureRequest.
 *
 * WHAT THE BROWSER DECIDES: which thing to send (an id this company must
 * own, re-checked here) and who signs (names and emails, validated). NOT
 * the document: the contract summary and the change order are rebuilt here
 * from this company's rows, and an uploaded file is fetched from our own
 * blob store after the same provenance check every document recording runs.
 *
 * GUARDS, all RETURNED (production redacts a thrown Server Action message):
 *   1. VIEW_JOB_COSTS — the capability the job page's contract section is
 *      rendered behind; every document here states prices.
 *   2. Void is owner-only (`ownerRefusal`), like every destructive control.
 *   3. DocuSign set up on this install and connected for this company.
 *   4. The subject belongs to this company and is in a sendable state.
 *
 * SENT CORRESPONDENCE CLOSES, NEVER DELETES: there is a Void, and no delete.
 */

const NO_MONEY = "Contracts and change orders show prices, which aren't part of your job function. Ask the account owner.";
const NOT_YOUR_FUNCTION = "Integrations aren't part of your job function. Ask the account owner.";

/** The largest file DocuSign takes (25 MB, its documented per-file limit). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SENDABLE_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "doc", "docx", "rtf", "txt", "htm", "html"]);

function explain(error: unknown): string | null {
  if (
    error instanceof DocuSignNotConfiguredError ||
    error instanceof DocuSignNotConnectedError ||
    error instanceof DocuSignReconnectError ||
    error instanceof EnvelopeNotFoundError
  ) {
    return error.message;
  }
  if (error instanceof DocuSignApiError) {
    return `DocuSign refused it. ${error.message}`;
  }
  return null;
}

function extensionOf(name: string, url: string): string | null {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  if (fromName) return fromName.toLowerCase();
  try {
    const fromUrl = /\.([a-z0-9]{1,5})$/i.exec(new URL(url).pathname)?.[1];
    return fromUrl ? fromUrl.toLowerCase() : null;
  } catch {
    return null;
  }
}

type Prepared = {
  jobId: string;
  subject: "CONTRACT_SUMMARY" | "CONTRACT_DOCUMENT" | "CHANGE_ORDER";
  contractDocumentId: string | null;
  changeOrderId: string | null;
  document: EnvelopeDocument;
  title: string;
  snapshot: unknown;
};

/** Everything that is decided before DocuSign is called. Returns a refusal
 * sentence or what to send. */
async function prepare(companyId: string, formData: FormData): Promise<{ error: string } | Prepared> {
  const subject = String(formData.get("subject") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");

  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      id: true,
      name: true,
      status: true,
      scope: true,
      company: { select: { name: true } },
      contact: { select: { name: true } },
    },
  });
  if (!job) return { error: "Job not found." };

  if (subject === "CONTRACT_SUMMARY") {
    // Same rule as createSignatureRequest: this signs the estimate that
    // becomes the contract, not something re-signed afterwards.
    if (job.status !== "ESTIMATE") return { error: "This job is already contracted." };
    const lineItems = await prisma.jobLineItem.findMany({
      where: { jobId: job.id, isDeleted: false },
      orderBy: { createdAt: "asc" },
      select: { description: true, quantity: true, unit: true, unitPrice: true },
    });
    if (lineItems.length === 0) return { error: "Add at least one line item before sending the contract." };
    const snapshot = contractSummarySnapshot({
      companyName: job.company.name,
      jobName: job.name,
      clientName: job.contact.name,
      scope: job.scope,
      lineItems,
    });
    return {
      jobId: job.id,
      subject,
      contractDocumentId: null,
      changeOrderId: null,
      title: `${job.name} — contract`,
      snapshot,
      document: { base64: base64Utf8(contractSummaryHtml(snapshot)), name: `${job.name} — contract`, fileExtension: "html", anchored: true },
    };
  }

  if (subject === "CONTRACT_DOCUMENT") {
    const doc = await prisma.contractDocument.findFirst({
      where: { id: subjectId, jobId: job.id },
      select: { id: true, fileUrl: true, fileName: true, versionNumber: true, executedSignedDate: true },
    });
    if (!doc) return { error: "That contract document isn't on this job." };
    if (doc.executedSignedDate) return { error: "This version is already the executed contract — there is nothing left to sign." };
    // The same provenance check every document recording runs: our own
    // store, under THIS job's contracts folder. A row is only ever written
    // with such a URL, but this is where the bytes are fetched from.
    const problem = documentUrlProblem(doc.fileUrl, "contract-document", job.id, process.env);
    if (problem) return { error: problem };
    const extension = extensionOf(doc.fileName, doc.fileUrl);
    if (!extension || !SENDABLE_EXTENSIONS.has(extension)) {
      return { error: "DocuSign can't take this kind of file. Upload the agreement as a PDF and send that version." };
    }
    const response = await fetch(doc.fileUrl);
    if (!response.ok) return { error: "Couldn't read the stored file to send it. Reload the page and try again." };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: "This file is over DocuSign's 25 MB limit." };
    return {
      jobId: job.id,
      subject,
      contractDocumentId: doc.id,
      changeOrderId: null,
      title: `${job.name} — ${doc.fileName}`,
      snapshot: null,
      document: { base64: Buffer.from(bytes).toString("base64"), name: doc.fileName, fileExtension: extension, anchored: false },
    };
  }

  if (subject === "CHANGE_ORDER") {
    const co = await prisma.changeOrder.findFirst({
      where: { id: subjectId, jobId: job.id },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        status: true,
        submittedOn: true,
        proposals: {
          select: { changeType: true, lineItemId: true, description: true, quantity: true, unit: true, unitPrice: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!co) return { error: "That change order isn't on this job." };
    if (co.status !== "SUBMITTED") {
      return { error: "Only a submitted change order goes to the GC for signature. Submit it first." };
    }
    const targets = await prisma.jobLineItem.findMany({
      where: { jobId: job.id },
      select: { id: true, description: true, quantity: true, unitPrice: true, isDeleted: true },
    });
    const targetsById = new Map(targets.map((item) => [item.id, item]));
    // Imported here rather than at the top: lib/change-order builds a
    // Prisma.Decimal constant when it loads, and only this branch needs it.
    const { changeOrderValueDelta } = await import("@/lib/change-order");
    const delta = Number(changeOrderValueDelta(co.proposals, targetsById));
    const snapshot: ChangeOrderSnapshot = {
      companyName: job.company.name,
      jobName: job.name,
      clientName: job.contact.name,
      number: co.number,
      title: co.title,
      description: co.description,
      submittedOn: co.submittedOn ? co.submittedOn.toISOString().slice(0, 10) : null,
      valueDelta: `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`,
      proposals: co.proposals.map((proposal) =>
        describeChangeOrderProposal(proposal, proposal.lineItemId ? targetsById.get(proposal.lineItemId) ?? null : null),
      ),
    };
    return {
      jobId: job.id,
      subject,
      contractDocumentId: null,
      changeOrderId: co.id,
      title: `${job.name} — change order #${co.number}`,
      snapshot,
      document: {
        base64: base64Utf8(changeOrderHtml(snapshot)),
        name: `Change order #${co.number} — ${co.title}`,
        fileExtension: "html",
        anchored: true,
      },
    };
  }

  return { error: "Pick what to send." };
}

export async function sendWithDocuSign(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NO_MONEY);
  const companyId = context.company.id;

  const config = readDocuSignConfig();
  if (!config) return actionFail(new DocuSignNotConfiguredError().message);

  const signers = readSigners(formData);
  if (!signers.ok) return actionFail(signers.error);

  const prepared = await prepare(companyId, formData);
  if ("error" in prepared) return actionFail(prepared.error);

  // One live envelope per thing. A second would put two different signing
  // requests for the same contract in the GC's inbox; void the first.
  const live = await prisma.docuSignEnvelope.findFirst({
    where: {
      companyId,
      jobId: prepared.jobId,
      subject: prepared.subject,
      contractDocumentId: prepared.contractDocumentId,
      changeOrderId: prepared.changeOrderId,
      status: { in: ["SENT", "DELIVERED"] },
    },
    select: { id: true },
  });
  if (live) return actionFail("This is already out for signature through DocuSign. Void that envelope before sending another.");

  const connectUrl = process.env[DOCUSIGN_WEBHOOK_ENV]?.trim() ? docuSignConnectUrl(config.redirectUri) : null;
  const emailSubject = emailSubjectFor(prepared.title);
  const definition = buildEnvelopeDefinition({
    emailSubject,
    emailBlurb: `Sent from C Stream by ${context.name ?? context.email}.`,
    document: prepared.document,
    signers: signers.value,
    connectUrl,
  });
  const senderTimeZone = normaliseTimeZone(await viewerTimeZone());

  let created;
  let accountId: string;
  try {
    ({ created, accountId } = await withDocuSign(companyId, async (target) => ({
      created: await createDocuSignEnvelope(target, definition),
      accountId: target.accountId,
    })));
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }

  // DocuSign has sent it. From here the row MUST be written: an envelope in
  // a GC's inbox that C Stream has no record of is correspondence nobody
  // can void from here. If this write fails the id is logged so it can be
  // voided in DocuSign by hand.
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.docuSignEnvelope.create({
        data: {
          companyId,
          jobId: prepared.jobId,
          subject: prepared.subject,
          contractDocumentId: prepared.contractDocumentId,
          changeOrderId: prepared.changeOrderId,
          envelopeId: created.envelopeId,
          docusignAccountId: accountId,
          documentName: prepared.document.name,
          emailSubject,
          recipients: signers.value,
          sentSnapshot: prepared.snapshot === null ? undefined : (prepared.snapshot as object),
          status: "SENT",
          // DocuSign's own time for the send when it gave one; the create
          // response's statusDateTime is that moment.
          sentAt: created.statusDateTime ? new Date(created.statusDateTime) : now,
          senderTimeZone,
          sentByUserId: context.id,
        },
      });
      const connection = await tx.integrationConnection.findUnique({
        where: { companyId_provider: { companyId, provider: "DOCUSIGN" } },
        select: { id: true },
      });
      if (connection) {
        await tx.integrationSyncLog.create({
          data: {
            connectionId: connection.id,
            direction: "PUSH",
            status: "SUCCESS",
            message: `Sent "${prepared.document.name}" for signature to ${signers.value.map((s) => s.email).join(", ")}.`,
            occurredAt: now,
          },
        });
      }
    });
  } catch (error) {
    console.error("[docusign] envelope sent but not recorded — void it in DocuSign by hand", {
      envelopeId: created.envelopeId,
      name: (error as Error)?.name,
    });
    throw error;
  }

  revalidatePath(`/jobs/${prepared.jobId}`);
  return actionOk;
}

/** Ask DocuSign where an envelope stands now. The same read the webhook
 * does, for an install without automatic updates or an impatient person. */
export async function refreshDocuSignEnvelope(envelopeRowId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NO_MONEY);
  const companyId = context.company.id;

  const row = await prisma.docuSignEnvelope.findFirst({ where: { id: envelopeRowId, companyId }, select: { id: true, jobId: true } });
  if (!row) return actionFail(new EnvelopeNotFoundError().message);

  try {
    await syncDocuSignEnvelope(companyId, row.id);
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }
  revalidatePath(`/jobs/${row.jobId}`);
  return actionOk;
}

/**
 * Void at DocuSign — which is how sent correspondence closes. The row stays;
 * its status and date are then read back from DocuSign rather than
 * assumed. If that read-back fails, the row says VOIDED with DocuSign's date
 * left blank (unknown) until the next Refresh — never this server's clock.
 */
export async function voidSentEnvelope(envelopeRowId: string, reason: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NO_MONEY);
  const refusal = ownerRefusal(context, "Only the account owner can void an envelope.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const voidedReason = reason.trim();
  if (!voidedReason) return actionFail("Say why it is being voided — DocuSign shows the signer this reason.");
  if (voidedReason.length > 200) return actionFail("Keep the reason under 200 characters.");

  const row = await prisma.docuSignEnvelope.findFirst({
    where: { id: envelopeRowId, companyId },
    select: { id: true, jobId: true, envelopeId: true, status: true },
  });
  if (!row) return actionFail(new EnvelopeNotFoundError().message);
  if (row.status !== "SENT" && row.status !== "DELIVERED") {
    return actionFail("Only an envelope still waiting on signatures can be voided.");
  }

  try {
    await withDocuSign(companyId, (target) => voidAtDocuSign(target, row.envelopeId, voidedReason));
  } catch (error) {
    const sentence = explain(error);
    if (sentence) return actionFail(sentence);
    throw error;
  }

  try {
    await syncDocuSignEnvelope(companyId, row.id);
  } catch (error) {
    console.warn("[docusign] voided, but the read-back failed; recording the void without a date", { name: (error as Error)?.name });
    await prisma.docuSignEnvelope.updateMany({
      where: { id: row.id, companyId, status: { in: ["SENT", "DELIVERED"] } },
      data: { status: "VOIDED", voidedReason },
    });
  }

  revalidatePath(`/jobs/${row.jobId}`);
  return actionOk;
}

/**
 * Forget the credential. Every envelope already sent stays — it is
 * correspondence — and DocuSign keeps delivering them to the signers; only
 * C Stream's ability to send, void and read status stops until someone
 * reconnects.
 */
export async function disconnectDocuSign(): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(NOT_YOUR_FUNCTION);
  const refusal = ownerRefusal(context, "Only the account owner can disconnect an integration.");
  if (refusal) return refusal;
  const companyId = context.company.id;

  const existing = await prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "DOCUSIGN" } },
    select: { id: true },
  });
  if (!existing) return actionFail("DocuSign is not connected.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        status: "NOT_CONNECTED",
        disconnectedAt: now,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        scopes: [],
      },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: existing.id,
        direction: "PUSH",
        status: "SUCCESS",
        message: "Disconnected from DocuSign. Envelopes already sent stay on their jobs.",
        occurredAt: now,
      },
    });
  });

  revalidatePath("/settings/integrations");
  return actionOk;
}
