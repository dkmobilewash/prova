/**
 * How a job's subcontract got executed — and the parsing of the one date
 * that has to be entered rather than stamped.
 *
 * THE PROBLEM THIS EXISTS FOR. Everything billable is gated on a job being
 * CONTRACTED (createInvoice, submitPayApplication, change orders, the
 * pay-application section rendering at all), and the only way in was a
 * SIGNED SignatureRequest — the GC e-signing inside Prova. That is
 * backwards for a specialty-trade sub: the GC issues the subcontract, the
 * GC signs it, and it arrives already executed on paper or through the
 * GC's own portal. A sub who waits for their GC to sign up for their
 * software never bills anybody.
 *
 * So there are two routes, and this file is where "which one" is answered.
 *
 * NEITHER ROUTE IS STORED AS A FLAG. The route is derived, every time,
 * from the two evidence records that already exist: a SIGNED
 * SignatureRequest for the e-sign route, and a ContractDocument carrying
 * an `executedSignedDate` for the off-platform route. CLAUDE.md's rule is
 * that derived state is never stored, and a `contractRoute` column is the
 * textbook way to end up with a job whose flag says e-signed and whose
 * records say otherwise.
 *
 * Pure: no database, no session, no React. lib/contract-execution.test.ts
 * is where the behaviour is pinned.
 */

/** The evidence the off-platform route leaves behind. Field-for-field a
 * ContractDocument row, narrowed to what a reader needs. */
export interface ExecutedSubcontractEvidence {
  versionNumber: number;
  fileName: string;
  fileUrl: string;
  /** ENTERED: the date the GC signed. Never the moment of the click. */
  executedSignedDate: Date;
  /** STAMPED: when Prova was told. The audit companion, not the signing date. */
  recordedAt: Date;
  /** Who asserted it. Null only for a row whose user has since been removed. */
  recordedByName: string | null;
}

/** The evidence the e-sign route leaves behind. */
export interface ESignEvidence {
  signerName: string | null;
  signedAt: Date | null;
}

export type ContractExecution =
  | { route: "NONE" }
  | { route: "ESIGN"; esign: ESignEvidence }
  | { route: "OFF_PLATFORM"; document: ExecutedSubcontractEvidence }
  /** Both happened. Rare but entirely possible — a GC who e-signs in Prova
   * can still send a countersigned paper copy — and a reader is owed both
   * rather than whichever one the code happened to check first. */
  | { route: "BOTH"; esign: ESignEvidence; document: ExecutedSubcontractEvidence };

/**
 * Reduce the two record sets to one answer.
 *
 * `documents` is every ContractDocument on the job; the executed one is
 * the EARLIEST version carrying a signing date, because that is the
 * original agreement — a later executed amendment is not the thing that
 * made this job billable.
 */
export interface ContractDocumentInput {
  versionNumber: number;
  fileName?: string;
  fileUrl?: string;
  /** Null on an ordinary upload — most rows are. */
  executedSignedDate: Date | null;
  recordedAt?: Date;
  recordedByName?: string | null;
}

export function contractExecutionFor(
  esign: ESignEvidence | null | undefined,
  documents: readonly ContractDocumentInput[],
): ContractExecution {
  const executed = documents
    .filter((doc): doc is typeof doc & { executedSignedDate: Date } => doc.executedSignedDate != null)
    .sort((a, b) => a.versionNumber - b.versionNumber)[0];

  const document: ExecutedSubcontractEvidence | null = executed
    ? {
        versionNumber: executed.versionNumber,
        fileName: executed.fileName ?? "",
        fileUrl: executed.fileUrl ?? "",
        executedSignedDate: executed.executedSignedDate,
        recordedAt: executed.recordedAt ?? executed.executedSignedDate,
        recordedByName: executed.recordedByName ?? null,
      }
    : null;

  if (esign && document) return { route: "BOTH", esign, document };
  if (esign) return { route: "ESIGN", esign };
  if (document) return { route: "OFF_PLATFORM", document };
  return { route: "NONE" };
}

/** True when there is enough evidence to let this job become CONTRACTED. */
export function contractIsExecuted(execution: ContractExecution): boolean {
  return execution.route !== "NONE";
}

/**
 * The refusal `markJobContracted` returns when neither route has happened.
 *
 * Names BOTH routes. The old sentence named only the e-signature, which is
 * how a sub reads "we can't use this product" out of a message that was
 * only ever meant to say "not yet".
 */
export const CONTRACT_NOT_EXECUTED_REFUSAL =
  "This job has no executed contract yet. Either send the GC a signing link and wait for them " +
  "to sign it in Prova, or — if they already sent you the executed subcontract — record it " +
  "under Contract signature: upload the signed file and enter the date the GC signed.";

/** Rendered at UTC, like every other stored date in this app. */
export function formatUtcDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One line saying which route this job took, for a reader who must never
 * be left unable to tell an e-signature from somebody's assertion. */
export function describeContractExecution(execution: ContractExecution): string {
  switch (execution.route) {
    case "NONE":
      return "Not executed yet.";
    case "ESIGN":
      return `E-signed in Prova by ${execution.esign.signerName ?? "the client"}${
        execution.esign.signedAt ? ` on ${formatUtcDate(execution.esign.signedAt)}` : ""
      }.`;
    case "OFF_PLATFORM":
      return (
        `Executed off-platform — the GC signed on ${formatUtcDate(execution.document.executedSignedDate)}. ` +
        `Recorded in Prova by ${execution.document.recordedByName ?? "a teammate"} on ` +
        `${formatUtcDate(execution.document.recordedAt)}.`
      );
    case "BOTH":
      return (
        `E-signed in Prova by ${execution.esign.signerName ?? "the client"}${
          execution.esign.signedAt ? ` on ${formatUtcDate(execution.esign.signedAt)}` : ""
        }, and an executed subcontract signed by the GC on ` +
        `${formatUtcDate(execution.document.executedSignedDate)} is also on file.`
      );
  }
}

export type SignedDateParse =
  | { ok: true; value: Date }
  | { ok: false; error: string };

/**
 * Parse the entered signing date.
 *
 * Stored at UTC midnight, so a comparison between two of these is a
 * calendar-day comparison and never an hours-apart one.
 *
 * Refuses a future date. Not pedantry: a signing date is what a lien
 * deadline, a retainage clock and a pay-app period get counted from, and
 * "2027" typed for "2026" is the single most common way that goes wrong.
 * `now` is a parameter so the test can pin the boundary instead of
 * depending on the day it runs.
 */
export function parseExecutedSignedDate(raw: string, now: Date): SignedDateParse {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter the date the GC signed the subcontract." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ok: false, error: "The signing date needs to be a real date." };
  }
  const value = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) {
    return { ok: false, error: "The signing date needs to be a real date." };
  }
  // Round-trip check: `2026-02-31` parses in JS and silently becomes March.
  if (value.toISOString().slice(0, 10) !== trimmed) {
    return { ok: false, error: "The signing date needs to be a real date." };
  }
  const todayUtc = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (value.getTime() > todayUtc.getTime()) {
    return {
      ok: false,
      error: "The signing date can't be in the future — enter the date the GC actually signed.",
    };
  }
  return { ok: true, value };
}
