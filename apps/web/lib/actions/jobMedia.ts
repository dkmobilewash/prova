"use server";

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  isAllowedJobMediaType,
  isBlobStorageUrl,
  isJobMediaBlobUrl,
  JOB_MEDIA_MAX_BYTES,
} from "@/lib/job-media";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Site capture: recording, captioning and removing the photos a crew takes
 * on a job.
 *
 * THE FILE ITSELF NEVER PASSES THROUGH HERE. The browser uploads directly
 * to the blob store via `app/api/job-media/upload/route.ts`; these actions
 * carry only the resulting URL and metadata. That is not a style choice —
 * a Server Action body is capped at 1MB and a phone photo is not (#27).
 * If you are tempted to add a `FormData`-with-a-`File` action to this
 * module, read that route's header first.
 *
 * Returned failures rather than thrown ones, matching
 * `lib/actions/submittals.ts`: production redacts a thrown Server Action
 * message to a digest, so a thrown guard sentence never reaches the person
 * it was written for.
 */

/** Every surface that reaches these records is gated on MANAGE_FIELD — the
 * capability the field crew holds, which is the whole point of a feature
 * used on site. Repeated on each action because a guarded page in front of
 * an open action guards nothing: an action is its own endpoint. */
const FIELD_ONLY =
  "Site photos aren't part of your job function. The account owner sets who sees what, on the Team page.";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Records a file the browser has already finished uploading.
 *
 * Everything in `blobUrl`/`contentType`/`byteSize` comes back from the
 * blob store via the client, so all of it is re-checked here. The upload
 * token already constrained type and size when it was minted, but this
 * action is a separate endpoint and is not entitled to assume the caller
 * went through that route at all.
 */
export async function recordJobMedia(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, companyId: true },
  });
  if (!job || job.companyId !== context.companyId) return fail("Job not found");

  const blobUrl = text(formData, "blobUrl");
  const contentType = text(formData, "contentType");
  if (!blobUrl) return fail("The upload did not complete — try again");

  // The store is ours, so its hostname is a fact we can require. Without
  // this, the action records whatever URL a caller posts — and this is a
  // Server Action, i.e. an endpoint anyone with a session can post to
  // directly, not just the form. The gallery would then render an
  // attacker-chosen image inside the tenant's own job, and every viewer's
  // browser would fetch it from the attacker's host.
  //
  // Parsed rather than regex-matched so that the check is on the HOST and
  // cannot be talked past by something that merely contains the right text
  // (`https://evil.test/?x=blob.vercel-storage.com`, a userinfo prefix like
  // `https://public.blob.vercel-storage.com@evil.test/`, and so on).
  if (!isBlobStorageUrl(blobUrl)) {
    return fail("That file did not come from this app's storage");
  }

  // AND THAT IT IS THIS JOB'S FILE, which the host check above cannot say.
  // One store serves every tenant, so a URL from it is not evidence of
  // whose it is. Without this, a signed-in user of company A could post
  // company B's photo URL here, get a row they legitimately own — their
  // companyId, their job — and then delete it, at which point
  // `deleteJobMedia` hands that URL to `del()` and B's file is gone. Every
  // row-level companyId check in this file passes throughout, because the
  // row really is theirs; the thing that was never theirs is the FILE.
  //
  // `job` was proved to belong to `context.companyId` above, so a blob
  // sitting under this job's own prefix cannot be another company's. See
  // lib/job-media.ts for the pathname rule itself and the two other places
  // that enforce it.
  if (!isJobMediaBlobUrl(blobUrl, job.id)) {
    return fail("That file was not uploaded to this job");
  }

  if (!isAllowedJobMediaType(contentType)) {
    return fail("Upload a JPEG, PNG, WEBP or HEIC image");
  }

  const byteSize = Number(text(formData, "byteSize"));
  if (!Number.isInteger(byteSize) || byteSize <= 0) return fail("The upload did not complete — try again");
  if (byteSize > JOB_MEDIA_MAX_BYTES) return fail("That file is too large");

  // Entered, not stamped: a crew uploading Friday's photos on Monday must
  // not have them filed as Monday's. The client sends the file's own
  // lastModified where the browser exposes one, falling back to now.
  const capturedAtRaw = text(formData, "capturedAt");
  const capturedAt = capturedAtRaw ? new Date(capturedAtRaw) : new Date();
  if (Number.isNaN(capturedAt.getTime())) return fail("That capture time is not valid");

  const caption = text(formData, "caption");

  await prisma.jobMedia.create({
    data: {
      companyId: context.companyId,
      jobId: job.id,
      blobUrl,
      contentType,
      byteSize,
      caption: caption || null,
      capturedAt,
      capturedByUserId: context.id,
    },
  });

  revalidatePath("/photos");
  revalidatePath(`/jobs/${job.id}`);
  return ok;
}

/**
 * The caption and the capture time. Nothing else.
 *
 * The FILE and the JOB are the identity of the record and are not editable
 * — a photo filed against the wrong job is deleted and re-uploaded, not
 * quietly moved, because the whole value of site capture is that it is
 * evidence of a particular place.
 *
 * `capturedAt` IS editable, and that is a deliberate departure from the
 * evidence-record rule that locks identity fields. It is here because the
 * value is not entered by a person in the first place — it is read off the
 * device's clock, which is set by its owner and is routinely wrong. The
 * gallery flags a capture time that cannot be right
 * (`jobMediaClockWarning`), and a warning with no remedy is worse than no
 * warning: deleting and re-uploading does not help, because the same wrong
 * clock produces the same wrong time. So the rule this actually follows is
 * the other one — dates that matter are ENTERED, not stamped — with the
 * device's guess as the default rather than the last word.
 */
export async function updateJobMediaDetails(
  mediaId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const media = await prisma.jobMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, companyId: true, jobId: true, capturedAt: true },
  });
  if (!media || media.companyId !== context.companyId) return fail("Photo not found");

  // Blank means "leave it alone" rather than "clear it": the column is not
  // nullable, and a photo with no time at all is worse than one with an
  // approximate time.
  const capturedAtRaw = text(formData, "capturedAt");
  let capturedAt = media.capturedAt;
  if (capturedAtRaw) {
    // Expected to be a full ISO instant. A `datetime-local` input produces
    // zoneless wall-clock text ("2026-09-07T15:00"), which `new Date` here
    // would resolve against the SERVER's zone and silently shift by hours —
    // so JobMediaCard converts it to an instant in the browser, against the
    // calendar the person is actually standing on, before it is sent.
    // Zoneless text still parses rather than erroring; it is simply the
    // server's reading of it, which is why the conversion is on the client
    // and this comment exists to stop someone moving it back.
    const parsed = new Date(capturedAtRaw);
    if (Number.isNaN(parsed.getTime())) return fail("That capture time is not valid");
    capturedAt = parsed;
  }

  await prisma.jobMedia.update({
    where: { id: media.id },
    data: { caption: text(formData, "caption") || null, capturedAt },
  });

  revalidatePath("/photos");
  revalidatePath(`/jobs/${media.jobId}`);
  return ok;
}

/**
 * Deletes the row AND the file.
 *
 * The blob goes first, deliberately. These URLs are public-but-unguessable
 * (see lib/blob.ts), so a row deleted without its file leaves the photo
 * readable forever by anyone who already holds the link — including
 * someone removed from the team. If the store's delete fails the row stays
 * and the person can try again; the other order gives them no way to,
 * because the URL needed to find the file would already be gone.
 *
 * `del` is idempotent on a blob that no longer exists, so a retry after a
 * partial failure still completes.
 *
 * DELETED BY URL, and there is no second column holding the pathname to
 * delete by instead. `del` takes "Blob url (or pathname)"
 * (@vercel/blob@2.8.0 dist/index.d.ts:75, :78), so either would work — but
 * a stored `blobPathname` was a second copy of what the URL's own path
 * already says, written on every row and read by nothing. It is gone.
 *
 * WHAT MAKES THIS SAFE is that `recordJobMedia` refused any URL whose path
 * was not under this company's job (`isJobMediaBlobUrl`), so the only URLs
 * that can reach this line name files this company uploaded. That check
 * did not exist when this comment was first written, and this delete is
 * exactly where its absence was paid for.
 */
export async function deleteJobMedia(mediaId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const media = await prisma.jobMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, companyId: true, jobId: true, blobUrl: true },
  });
  if (!media || media.companyId !== context.companyId) return fail("Photo not found");

  try {
    await del(media.blobUrl);
  } catch {
    return fail("Could not remove the file from storage — nothing was deleted, try again");
  }

  await prisma.jobMedia.delete({ where: { id: media.id } });

  revalidatePath("/photos");
  revalidatePath(`/jobs/${media.jobId}`);
  return ok;
}
