import { prisma } from "@prova/db";
import {
  downloadDocuSignDocument,
  getDocuSignEnvelope,
  type DocuSignApiTarget,
} from "@prova/integrations";
import { issueContractDocumentVersion } from "@/lib/billing/contract-document-version";
import { withDocuSign, type DocuSignDeps } from "./connection";
import { calendarDayInZone, planEnvelopeUpdate, type TrackedStatus } from "./envelope-status";

/**
 * Bring one envelope row up to date with DocuSign. The one path every
 * status change takes — the Connect webhook, the Refresh button, and the
 * read-back after a Void all call this, so there is exactly one place that
 * decides what an envelope's status is.
 *
 * TENANT SCOPE. The row is read `where { id, companyId }` and every write is
 * `updateMany where { id, companyId, … }`, so a caller holding another
 * company's envelope id changes nothing. The DocuSign call uses THAT
 * company's own token.
 *
 * NOTHING FROM A WEBHOOK BODY IS USED HERE. The status and every date are
 * read from DocuSign's API (GET envelope), so a forged or replayed message
 * can at most cause one extra read of the truth.
 *
 * ON COMPLETION, the signed copy (DocuSign's `combined`, certificate
 * excluded) and the certificate of completion are downloaded and stored in
 * our blob store under the job's contracts folder. For the contract
 * (CONTRACT_SUMMARY, CONTRACT_DOCUMENT) the signed copy is ALSO recorded as
 * a new ContractDocument version carrying `executedSignedDate` — the same
 * executed-subcontract evidence `markJobContracted` already accepts — with
 * the version number from the job's counter in the same transaction, like
 * every other ContractDocument write. That date is the calendar day of
 * DocuSign's completedDateTime in the sender's zone: recorded, not guessed.
 *
 * IDEMPOTENT. A duplicate delivery finds nothing to change and writes
 * nothing. Completion storage is claimed with `updateMany where
 * signedDocumentUrl IS NULL`; a second, concurrent completion loses that
 * claim, rolls back its ContractDocument insert, and deletes the files it
 * had uploaded, so one envelope records one executed version.
 */

export type StoreFile = (pathname: string, bytes: Uint8Array, contentType: string) => Promise<{ url: string }>;
export type DeleteFile = (url: string) => Promise<void>;

export type SyncDeps = DocuSignDeps & { storeFile?: StoreFile; deleteFile?: DeleteFile };

export type SyncOutcome = {
  status: TrackedStatus;
  changed: boolean;
  /** True when this call stored the signed copy. */
  storedSignedCopy: boolean;
};

const ENVELOPE_SELECT = {
  id: true,
  companyId: true,
  jobId: true,
  subject: true,
  envelopeId: true,
  documentName: true,
  status: true,
  sentAt: true,
  deliveredAt: true,
  completedAt: true,
  declinedAt: true,
  voidedAt: true,
  voidedReason: true,
  senderTimeZone: true,
  signedDocumentUrl: true,
  sentByUserId: true,
} as const;

async function defaultStoreFile(pathname: string, bytes: Uint8Array, contentType: string) {
  const { put } = await import("@vercel/blob");
  // Same options every other document upload gets (lib/blob.ts): public so
  // a GC can open the link, random suffix so the URL is unguessable.
  const result = await put(pathname, Buffer.from(bytes), { access: "public", addRandomSuffix: true, contentType });
  return { url: result.url };
}

async function defaultDeleteFile(url: string) {
  const { deleteDocument } = await import("@/lib/blob");
  await deleteDocument(url);
}

class CompletionAlreadyStored extends Error {}

export class EnvelopeNotFoundError extends Error {
  constructor() {
    super("That envelope isn't on this account.");
    this.name = "EnvelopeNotFoundError";
  }
}

function safeFileStem(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^A-Za-z0-9 _-]+/g, " ").trim().slice(0, 80) || "document";
}

export async function syncDocuSignEnvelope(companyId: string, rowId: string, deps: SyncDeps = {}): Promise<SyncOutcome> {
  const row = await prisma.docuSignEnvelope.findFirst({ where: { id: rowId, companyId }, select: ENVELOPE_SELECT });
  if (!row) throw new EnvelopeNotFoundError();

  return withDocuSign(
    companyId,
    async (target) => {
      const remote = await getDocuSignEnvelope(target, row.envelopeId, deps.fetchImpl);
      const update = planEnvelopeUpdate(row, remote);
      let status = row.status as TrackedStatus;
      if (update) {
        await prisma.docuSignEnvelope.updateMany({ where: { id: row.id, companyId }, data: update });
        status = update.status ?? status;
      }
      const completedAt = update?.completedAt ?? row.completedAt;

      let storedSignedCopy = false;
      if (status === "COMPLETED" && !row.signedDocumentUrl && completedAt) {
        storedSignedCopy = await storeCompletion(target, { ...row, completedAt }, deps);
      }
      return { status, changed: Boolean(update), storedSignedCopy };
    },
    deps,
  );
}

async function storeCompletion(
  target: DocuSignApiTarget,
  row: {
    id: string;
    companyId: string;
    jobId: string;
    subject: string;
    envelopeId: string;
    documentName: string;
    senderTimeZone: string;
    sentByUserId: string | null;
    completedAt: Date;
  },
  deps: SyncDeps,
): Promise<boolean> {
  const storeFile = deps.storeFile ?? defaultStoreFile;
  const deleteFile = deps.deleteFile ?? defaultDeleteFile;

  const [signed, certificate] = await Promise.all([
    downloadDocuSignDocument(target, row.envelopeId, "combined", deps.fetchImpl),
    downloadDocuSignDocument(target, row.envelopeId, "certificate", deps.fetchImpl),
  ]);

  // Under contracts/<jobId>/ — the folder `documentUrlProblem` accepts for
  // this job's contract documents, so the executed version recorded below
  // is indistinguishable from an uploaded one to every check downstream,
  // including `deleteContractDocument`'s blob delete.
  const stem = safeFileStem(row.documentName);
  const signedFile = await storeFile(`contracts/${row.jobId}/${stem}-signed-docusign.pdf`, signed, "application/pdf");
  let certificateFile: { url: string };
  try {
    certificateFile = await storeFile(`contracts/${row.jobId}/${stem}-docusign-certificate.pdf`, certificate, "application/pdf");
  } catch (error) {
    await deleteFile(signedFile.url);
    throw error;
  }

  const recordsContract = row.subject === "CONTRACT_SUMMARY" || row.subject === "CONTRACT_DOCUMENT";
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.docuSignEnvelope.updateMany({
        where: { id: row.id, companyId: row.companyId, signedDocumentUrl: null },
        data: { signedDocumentUrl: signedFile.url, certificateUrl: certificateFile.url },
      });
      if (claimed.count !== 1) throw new CompletionAlreadyStored();

      if (recordsContract) {
        const version = await tx.contractDocument.create({
          data: {
            jobId: row.jobId,
            versionNumber: await issueContractDocumentVersion(tx, row.jobId),
            fileUrl: signedFile.url,
            fileName: `${stem} — signed through DocuSign.pdf`,
            note:
              `Signed through DocuSign (envelope ${row.envelopeId}); DocuSign recorded completion at ` +
              `${row.completedAt.toISOString()}. The certificate of completion is kept with the envelope.`,
            executedSignedDate: calendarDayInZone(row.completedAt, row.senderTimeZone),
            uploadedByUserId: row.sentByUserId,
          },
          select: { id: true },
        });
        await tx.docuSignEnvelope.updateMany({
          where: { id: row.id, companyId: row.companyId },
          data: { signedContractDocumentId: version.id },
        });
      }
    });
  } catch (error) {
    // Either another delivery stored it first, or the write failed: in both
    // cases the files this call uploaded belong to nothing.
    await deleteFile(signedFile.url);
    await deleteFile(certificateFile.url);
    if (error instanceof CompletionAlreadyStored) return false;
    throw error;
  }
  return true;
}
