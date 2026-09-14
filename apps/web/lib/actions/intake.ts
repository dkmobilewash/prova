"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { classifyDocument } from "@/lib/intake/classify";
import { isIntakeKind, soleJobForHint, type FilableKind } from "@/lib/intake/review";
import {
  INTAKE_MAX_FILE_BYTES,
  displayFileName,
  isAllowedIntakeType,
  isIntakeBlobUrl,
} from "@/lib/intake/upload";
// The store-ownership check is generic to every blob this app records, and
// it already lives here with the account of what it cost to be missing. A
// second copy under lib/intake would be a second thing to keep right.
import { isBlobStorageUrl, isOurBlobStoreUrl } from "@/lib/job-media";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Document intake: recording what was dropped in, and filing it once a
 * person has said what it is.
 *
 * THE FILE ITSELF NEVER PASSES THROUGH HERE. The browser uploads straight
 * to the blob store via `app/api/intake/upload/route.ts`; these actions
 * carry only the resulting URL and metadata. A Server Action body is capped
 * at exactly 1MB and a scanned submittal is not — see issue #27 and that
 * route's header.
 *
 * Returned failures rather than thrown ones, matching
 * `lib/actions/submittals.ts`: production redacts a thrown Server Action
 * message to a digest, so a thrown guard sentence never reaches the person
 * it was written for.
 *
 * NOTHING HERE CREATES A SUBMITTAL, AN RFI OR A COMPLIANCE DOCUMENT.
 * "Filing" writes the accepted kind and job onto the intake row. Routing
 * each kind into its destination model is a separate change with per-model
 * identity rules — a submittal number comes from a counter, an RFI's fields
 * lock on creation — and guessing at them from a filename is how a tray of
 * paperwork turns into a log of wrong records. The UI says "filed as" for
 * the same reason.
 */

/** Every surface that reaches these records is gated on MANAGE_JOBS, the
 * capability that already covers the correspondence around a job — RFIs,
 * submittals, drawings, closeout — which is what this tray is full of.
 * Repeated on each action because a guarded page in front of an open action
 * guards nothing: an action is its own endpoint and answers whoever posts
 * to it. */
const JOBS_ONLY =
  "Document intake isn't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * The job a hint names, or null.
 *
 * MATCHED, NEVER CREATED, and never partially matched. The classifier's
 * `jobHint` is evidence from a filename; the only safe thing to do with it
 * is look for a job of that name in THIS company and drop it otherwise. A
 * `contains` match here would file a document about "Riverside Phase 2"
 * onto "Riverside", which is a wrong filing that looks like a right one.
 *
 * The hint is stored either way — see `jobHint` on the model. A hint that
 * matched nothing is the useful case: the table can say what was suggested
 * instead of showing an empty job cell that reads as "found nothing".
 */
/**
 * The job a filename hint points at, pre-filled into the row's picker.
 *
 * WAS AN EXACT `equals` UNTIL 2026-09-14, AND SO NEVER MATCHED ANYTHING.
 * Job names are long ("Riverside Medical Office Building"); the hint a
 * classifier reads out of `Riverside COI 2027.pdf` is "Riverside", because
 * that is what an office types. Equality left `jobId` null on every row —
 * and the table then printed "Looks like Riverside, which is not a job here"
 * immediately above a dropdown containing that job. Found by uploading three
 * real files, which is the only way it could have been.
 *
 * `soleJobForHint` refuses an ambiguous hint rather than guessing: two jobs
 * both starting "Riverside" mean the filename does not say which, and
 * pre-filling one for a person to rubber-stamp is worse than leaving it
 * blank. Nothing is filed by this either way — it only decides what the
 * picker starts on, and a person still confirms every row.
 */
async function jobFromHint(hint: string | null, companyId: string): Promise<string | null> {
  if (!hint) return null;
  const jobs = await prisma.job.findMany({ where: { companyId }, select: { id: true, name: true } });
  return soleJobForHint(jobs, hint)?.id ?? null;
}

/**
 * One uploaded file becomes one row in the tray, with a proposal attached.
 *
 * Called once per file by the drop zone, after the bytes have landed. Every
 * claim in the form data is verified here rather than trusted: this is an
 * endpoint, and the browser that called it is not the only thing that can.
 */
export async function recordIntakeDocument(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);
  const companyId = context.companyId;

  const blobUrl = text(formData, "blobUrl");
  const contentType = text(formData, "contentType");
  // THE PERSON'S OWN FILENAME, not the store-path sanitiser's version of it.
  //
  // This called `intakeFileName` until 2026-09-14, which is the pathname
  // sanitiser — it turns every run of non-`[A-Za-z0-9._-]` into a hyphen. The
  // schema says outright that this column is "what the person's own file was
  // called, BEFORE the store's random suffix and BEFORE the sanitising",
  // because it is what somebody recognises the row by, and the table was
  // showing `Nevada-contractor-s-license-C-4.pdf` instead.
  //
  // WORSE THAN COSMETIC, AND THIS IS WHY IT MATTERS: the same sanitised
  // string was fed to the CLASSIFIER, whose patterns are written against real
  // filenames. `contractors?(?:'s)?\s+licen[sc]e` needs an apostrophe and a
  // space; after sanitising there are neither, so a file that classifies as a
  // compliance document with HIGH confidence on its real name came back
  // MEDIUM ("contains 'license' — not conclusive") through the upload path.
  // The sanitiser was quietly degrading accuracy on the only path that runs.
  //
  // `intakeFileName` still guards the STORE PATH, where it belongs — the
  // client builds that with `intakeUploadPathname`, and the route refuses a
  // pathname that is not this company's. Nothing here reaches a filesystem.
  const fileName = displayFileName(text(formData, "fileName"));
  if (!blobUrl) return fail("The upload did not complete — try again");

  // Three checks on the URL, and each one answers a question the previous
  // cannot. (1) is it a blob-store URL at all — parsed, not pattern-matched,
  // so a userinfo prefix like `https://x.blob.vercel-storage.com@evil.test/`
  // cannot talk past it.
  if (!isBlobStorageUrl(blobUrl)) {
    return fail("That file did not come from this app's storage");
  }
  // (2) is it OUR store. Anyone can create a blob store, and the path is
  // exactly the part somebody with their own store gets to choose — so
  // without this, a caller could put `document-intake/<companyId>/x.pdf` in
  // a store of their own and have this screen link to it.
  if (!isOurBlobStoreUrl(blobUrl, process.env)) {
    return fail("That file did not come from this app's storage");
  }
  // (3) is it THIS COMPANY'S file. One store serves every tenant, so a URL
  // from it is not evidence of whose it is. See lib/intake/upload.ts.
  if (!isIntakeBlobUrl(blobUrl, companyId)) {
    return fail("That file was not uploaded to this company's intake");
  }

  if (!isAllowedIntakeType(contentType)) {
    return fail("That is not a file type this app can take in");
  }

  const byteSize = Number(text(formData, "byteSize"));
  if (!Number.isInteger(byteSize) || byteSize <= 0) {
    return fail("The upload did not complete — try again");
  }
  // Re-checked even though the store already refused anything over the
  // signed ceiling, for the reason every other check here is repeated: the
  // store enforced the cap on the transfer, this enforces it on the row.
  if (byteSize > INTAKE_MAX_FILE_BYTES) return fail("That file is too large");

  // The classifier is somebody else's module and is called exactly once per
  // file, here. It must not throw — a classifier that does would take the
  // upload down with it — but this does not rely on that promise: a failure
  // becomes an UNKNOWN row that waits for a person, which is the same place
  // an unreadable document ends up anyway.
  let proposal;
  try {
    proposal = classifyDocument({
      filename: fileName,
      mimeType: contentType,
      sizeBytes: byteSize,
      textPreview: formData.get("textPreview") ? String(formData.get("textPreview")) : null,
    });
  } catch (err) {
    console.error("[intake] classifier threw", err);
    proposal = {
      kind: "UNKNOWN" as const,
      confidence: "LOW" as const,
      reason: "Nothing could be read from this file, so it is waiting for you.",
      jobHint: null,
      revisionHint: null,
    };
  }

  // A kind this build does not know is treated as UNKNOWN rather than
  // written to a column whose enum would refuse it. Prisma would throw, the
  // message would be redacted in production, and the person would be left
  // with a file in the store and no row pointing at it.
  const proposedKind = isIntakeKind(proposal.kind) ? proposal.kind : "UNKNOWN";
  const proposedConfidence =
    proposal.confidence === "HIGH" || proposal.confidence === "MEDIUM" ? proposal.confidence : "LOW";

  await prisma.documentIntake.create({
    data: {
      companyId,
      jobId: await jobFromHint(proposal.jobHint, companyId),
      jobHint: proposal.jobHint,
      blobUrl,
      fileName,
      contentType,
      byteSize,
      proposedKind,
      proposedConfidence,
      proposedReason: proposal.reason || "No reason was given.",
      revisionHint: proposal.revisionHint,
      uploadedByUserId: context.id,
    },
  });

  revalidatePath("/intake");
  return ok;
}

export type IntakeConfirmation = {
  id: string;
  /** What the person says it is — the dropdown's value, which is theirs to
   * change and is therefore validated here rather than trusted. */
  kind: string;
  /** The job they picked, or "" for none. Optional on purpose: a COI or a
   * W-9 belongs to the company, not to a job. */
  jobId: string;
};

/**
 * Files N rows in ONE transaction.
 *
 * WHY ONE TRANSACTION rather than N awaited updates. "Confirm all" is the
 * button this screen exists for and it can carry sixty rows. Sixty separate
 * updates can half-succeed — a dropped connection at row 34 leaves the tray
 * in a state nobody asked for, and the person's only evidence of which half
 * landed is scrolling the table. Either they all file or none do.
 *
 * EVERY ROW IS RE-READ AND RE-CHECKED, not taken from the payload. The ids
 * come from a browser; the payload says which rows to change and nothing
 * about whose they are.
 */
export async function confirmIntakeRows(
  confirmations: IntakeConfirmation[],
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);
  const companyId = context.companyId;

  if (!Array.isArray(confirmations) || confirmations.length === 0) {
    return fail("Nothing was selected to file");
  }

  // Narrowed as it is validated, rather than validated here and read as a
  // bare `string` at the write below. `acceptedKind` is a Prisma enum column
  // and `isIntakeKind` is a type guard, so carrying the NARROWED value
  // forward is what makes the update typecheck — casting at the write would
  // typecheck just as well and would be the moment this stopped being
  // checked at all.
  const checked: { id: string; kind: FilableKind; jobId: string }[] = [];
  for (const entry of confirmations) {
    if (!entry || typeof entry.id !== "string" || !entry.id) {
      return fail("Something in that list was not a document");
    }
    if (!isIntakeKind(entry.kind)) {
      return fail("Pick where each document should be filed");
    }
    // THE ONE RULE THIS SCREEN PROMISES ON ITS FACE: an UNKNOWN never
    // files. It is not a destination, it is the absence of one, and a row
    // that files as "couldn't place it" is a row that has left the tray
    // without anybody having decided anything.
    if (entry.kind === "UNKNOWN") {
      return fail("Choose a destination for the ones we couldn't place — they can't file as unknown");
    }
    checked.push({
      id: entry.id,
      kind: entry.kind,
      jobId: typeof entry.jobId === "string" ? entry.jobId : "",
    });
  }

  const ids = checked.map((c) => c.id);
  const rows = await prisma.documentIntake.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, status: true },
  });
  if (rows.length !== new Set(ids).size) {
    return fail("Some of those documents are no longer in the tray — reload the page");
  }
  const alreadyGone = rows.filter((row) => row.status !== "PROPOSED");
  if (alreadyGone.length > 0) {
    return fail(
      `${alreadyGone.length === 1 ? "One of those documents has" : `${alreadyGone.length} of those documents have`} already been dealt with — reload the page`,
    );
  }

  // Job ids are checked in one query rather than per row: the same job is
  // usually chosen for most of a drop, and this is a list of everything the
  // payload named that this company actually owns.
  const wantedJobIds = [...new Set(checked.map((c) => c.jobId).filter(Boolean))];
  if (wantedJobIds.length > 0) {
    const jobs = await prisma.job.findMany({
      where: { id: { in: wantedJobIds }, companyId },
      select: { id: true },
    });
    if (jobs.length !== wantedJobIds.length) return fail("Job not found");
  }

  // ONE STATEMENT PER DISTINCT DESTINATION, not one per row. "Confirm all"
  // is the most-clicked button in this feature and the drop it follows is
  // sized in the dozens, so a `for` loop of individual updates was up to
  // TRAY_LIMIT statements inside one interactive transaction — which can
  // exceed Prisma's default timeout and then THROWS, and production redacts
  // a thrown Server Action message to a digest. The button would have
  // failed with nothing on screen at all.
  //
  // Rows are grouped by what they are being filed AS, because that is the
  // only thing the write varies by. Eighty documents across eight kinds is
  // eight statements, not eighty.
  const byDestination = new Map<string, { kind: FilableKind; jobId: string | null; ids: string[] }>();
  for (const entry of checked) {
    const jobId = entry.jobId || null;
    const key = `${entry.kind}::${jobId ?? ""}`;
    const group = byDestination.get(key);
    if (group) group.ids.push(entry.id);
    else byDestination.set(key, { kind: entry.kind, jobId, ids: [entry.id] });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const group of byDestination.values()) {
          await tx.documentIntake.updateMany({
            where: { id: { in: group.ids }, companyId },
            data: { acceptedKind: group.kind, jobId: group.jobId, status: "FILED" },
          });
        }
      },
      // Generous rather than default: the grouping above makes a timeout
      // unlikely, and a partial file is worse than a slow one.
      { timeout: 20_000, maxWait: 10_000 },
    );
  } catch {
    // A returned sentence, never a throw — CLAUDE.md: production redacts a
    // thrown message and the form would render nothing. Nothing was filed:
    // the transaction is all or nothing, so the tray is unchanged and the
    // person can simply press it again.
    return fail("Filing those documents took too long and nothing was filed. Please try again.");
  }

  revalidatePath("/intake");
  return ok;
}

/**
 * "This does not belong here."
 *
 * The row STAYS, with a status, rather than being deleted — so the same
 * file dropped again next month is not proposed a second time as though it
 * were new, and so the tray's own history is readable. The blob stays too:
 * nothing here has been shown to anybody, and a dismissed row is the one
 * most likely to have been dismissed by mistake.
 *
 * NOT owner-only, unlike the deletes elsewhere in this app. Nothing is
 * destroyed and nothing leaves the company; MANAGE_JOBS — the capability
 * that put the document in front of them — is the right gate.
 */
export async function dismissIntakeRow(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

  const row = await prisma.documentIntake.findUnique({
    where: { id },
    select: { id: true, companyId: true, status: true },
  });
  if (!row || row.companyId !== context.companyId) return fail("That document is not in your tray");
  if (row.status !== "PROPOSED") return fail("That document has already been dealt with");

  await prisma.documentIntake.update({ where: { id: row.id }, data: { status: "DISMISSED" } });
  revalidatePath("/intake");
  return ok;
}
