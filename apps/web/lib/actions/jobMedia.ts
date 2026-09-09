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
  isOurBlobStoreUrl,
  JOB_MEDIA_MAX_BYTES,
} from "@/lib/job-media";
import {
  displayTagName,
  normalizeTagName,
  parseTagInput,
  tagCapProblemMessage,
  tagNameProblem,
  tagNameProblemMessage,
} from "@/lib/job-media-tags";
import {
  actionFail as fail,
  actionOk as ok,
  isUniqueConstraintError,
  type ActionResult,
} from "./shared";

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

  // AND THAT THE STORE IS OURS, which the host check above cannot say
  // either: it proves "some Vercel blob store", and anyone can create one.
  // A caller who knows a job id could put `job-media/<jobId>/x.jpg` in
  // their OWN store and post that URL here — every check below would pass,
  // because they are all about the path, and the path is precisely what an
  // attacker with their own store chooses. The gallery would then render
  // an image they control inside this company's job.
  //
  // The store id is not a secret and needs no new setting: it is already
  // inside the credentials this app holds, and `blobStoreId` reads it out
  // the same two ways the SDK does. See lib/job-media.ts.
  if (!isOurBlobStoreUrl(blobUrl, process.env)) {
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

/* ------------------------------------------------------------------ *
 * Tags
 *
 * IN THIS FILE RATHER THAN A SIBLING `jobMediaTags.ts`, and the reason is
 * a build error rather than taste. `FIELD_ONLY` and `text()` are what a
 * sibling module would need, and a `"use server"` file may only export
 * async functions — "Only async functions are allowed to be exported in a
 * \"use server\" file", the exact sentence in
 * @next/swc-linux-x64-gnu@15.5.23 (crates/next-custom-transforms/src/
 * transforms/server_actions.rs). So exporting the constant to share it
 * breaks `pnpm build` while typechecking perfectly, and the alternative —
 * a second copy of the refusal sentence — is the drift LOCATION_TYPES
 * already paid for once.
 *
 * The vocabulary rules themselves are not here: they are pure, they are in
 * lib/job-media-tags.ts, and lib/job-media-tags.test.ts holds them still.
 * ------------------------------------------------------------------ */

/**
 * Puts one or more tags on a photo, creating any this company has not used
 * before.
 *
 * ONE TRANSACTION PER SUBMIT. "Find the tag or create it, then link it" is
 * two decisions taken against a table two people can be writing to at
 * once, and the window between them is exactly where a duplicate gets in.
 *
 * THE RACE, AND WHY THERE IS NO CATCH-AND-RETRY. Two people tagging "west
 * wall" on two photos in the same second both find nothing and both
 * insert. The reflex is to catch P2002 and re-read — but a failed
 * statement inside a Postgres transaction aborts the WHOLE transaction
 * ("current transaction is aborted, commands ignored until end of
 * transaction block"), so the re-read cannot happen where the catch is.
 * Retrying the whole transaction would work and is more moving parts than
 * this needs.
 *
 * So the conflict is handed to the database instead: `skipDuplicates`
 * compiles to ` ON CONFLICT DO NOTHING` — the literal the Postgres visitor
 * in the installed query engine emits, beside its `DoNothing` /
 * `on_conflict` AST nodes (@prisma/client@6.19.3,
 * .prisma/client/libquery_engine-debian-openssl-3.0.x.so.node) — and that
 * BLOCKS on the other transaction's uncommitted row rather than failing,
 * then skips it once that transaction commits.
 * The re-read that follows runs in READ COMMITTED, so it takes a fresh
 * snapshot and sees the row the other person just committed. Both people
 * end up with the same tag and neither gets a 500.
 *
 * The same mechanism covers the second collision, which is easier to hit
 * and easier to miss: two people putting the SAME tag on the SAME photo,
 * where the identity is the pair (`@@id([mediaId, tagId])`).
 */
export async function addJobMediaTags(mediaId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  // Parsed and judged before the database is touched at all: everything
  // here is decidable from the text, and a refusal that costs a query is
  // a query spent on nothing.
  const names = parseTagInput(text(formData, "tags"));
  if (names.length === 0) return fail(tagNameProblemMessage("empty"));
  for (const name of names) {
    const problem = tagNameProblem(name);
    if (problem) return fail(tagNameProblemMessage(problem));
  }

  const media = await prisma.jobMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, companyId: true, jobId: true },
  });
  // The row is re-proved to be this company's even though every screen
  // that renders the button already checked. A Server Action is its own
  // endpoint with a stable id; the page in front of it is not a guard.
  if (!media || media.companyId !== context.companyId) return fail("Photo not found");

  const companyId = context.companyId;
  const taggedByUserId = context.id;
  const wanted = names.map((name) => ({ name, normalizedName: normalizeTagName(name) }));
  const normalizedNames = wanted.map((entry) => entry.normalizedName);

  try {
    const capProblem = await prisma.$transaction(async (tx) => {
      const known = await tx.jobMediaTag.findMany({
        where: { companyId, normalizedName: { in: normalizedNames } },
        select: { id: true, normalizedName: true },
      });
      const assigned = await tx.jobMediaTagAssignment.findMany({
        where: { mediaId: media.id },
        select: { tagId: true },
      });

      // The cap is judged on what this submit would actually ADD. A tag
      // already on the photo is a no-op that the person cannot see is a
      // no-op — refusing a full photo for re-submitting a tag it already
      // wears would be a refusal with no action attached to it.
      const idByNormalized = new Map(known.map((tag) => [tag.normalizedName, tag.id]));
      const alreadyOnPhoto = new Set(assigned.map((assignment) => assignment.tagId));
      const adding = wanted.filter((entry) => {
        const id = idByNormalized.get(entry.normalizedName);
        return id === undefined || !alreadyOnPhoto.has(id);
      }).length;

      // Checked BEFORE anything is written, so a refusal leaves no
      // half-made vocabulary behind: a tag row created here and then not
      // attached would be a word in the company's list that no photo
      // wears and nobody typed on purpose.
      const problem = tagCapProblemMessage(assigned.length, adding);
      if (problem) return problem;

      // Sorted, and that is not cosmetic. A multi-row INSERT takes its row
      // locks in the order of its VALUES list, so two people submitting
      // "west wall, 3F" and "3F, west wall" in the same instant can each
      // hold the row the other is waiting for — a deadlock, which Postgres
      // resolves by killing one of them with an error this action does not
      // recognise and would hand back as a 500. Every writer inserting in
      // the same order removes that possibility rather than handling it.
      // Sorting here changes nothing a person sees: the display name is
      // carried per entry, and the chips are ordered by the read.
      const missing = wanted
        .filter((entry) => !idByNormalized.has(entry.normalizedName))
        .sort((a, b) => (a.normalizedName < b.normalizedName ? -1 : 1));
      let tagIds = known.map((tag) => tag.id);
      if (missing.length > 0) {
        await tx.jobMediaTag.createMany({
          data: missing.map((entry) => ({
            companyId,
            // Stored as typed, compared as folded. Both come from the one
            // module that computes them, never from a second spelling of
            // the same rule here.
            name: entry.name,
            normalizedName: entry.normalizedName,
          })),
          skipDuplicates: true,
        });
        // Re-read rather than trusting what was just written: on Postgres
        // `createMany` returns a COUNT, not rows, so the ids of anything
        // created here have to be fetched — and this read is also what
        // picks up a tag another person committed a moment ago, whose
        // insert the line above quietly skipped.
        const all = await tx.jobMediaTag.findMany({
          where: { companyId, normalizedName: { in: normalizedNames } },
          select: { id: true },
        });
        tagIds = all.map((tag) => tag.id);
      }

      // Sorted for the same reason as the insert above — this one is on
      // the join, where two people tagging the SAME photo with the same
      // two tags is the realistic collision.
      await tx.jobMediaTagAssignment.createMany({
        data: [...tagIds]
          .sort()
          .map((tagId) => ({ mediaId: media.id, tagId, taggedByUserId })),
        skipDuplicates: true,
      });
      return null;
    });

    if (capProblem) return fail(capProblem);
  } catch (error) {
    // Belt, not braces. `ON CONFLICT DO NOTHING` on both inserts should
    // make a unique violation unreachable here — but this is the one
    // action in this feature a crew runs from a phone, and the cost of
    // being wrong about that is a redacted 500 rather than a sentence.
    if (isUniqueConstraintError(error)) {
      return fail("Someone else was tagging this at the same moment — try that again");
    }
    throw error;
  }

  revalidatePath("/photos");
  revalidatePath(`/jobs/${media.jobId}`);
  return ok;
}

/**
 * Takes one tag off one photo.
 *
 * THE ASSIGNMENT ONLY. The tag itself survives, and that distinction is
 * the entire reason there is a vocabulary table: "west wall" is on 200
 * photos, and taking it off this one must not take it off the other 199 or
 * empty it out of the autocomplete. Deleting the tag is a separate,
 * deliberate act — `deleteJobMediaTag` — and it says how many photos it
 * will come off before it does it.
 *
 * `deleteMany` rather than `delete`, so a second click on a chip that has
 * already gone is a no-op instead of a thrown "record not found". The
 * caller asked for the tag to be off the photo; if it is already off, that
 * is the outcome they wanted.
 */
export async function removeJobMediaTag(mediaId: string, tagId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const media = await prisma.jobMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, companyId: true, jobId: true },
  });
  if (!media || media.companyId !== context.companyId) return fail("Photo not found");

  // Scoped by the photo, which has just been proved to be this company's.
  // An assignment is only reachable through a photo, so a `tagId` from
  // another company matches nothing here rather than deleting anything.
  await prisma.jobMediaTagAssignment.deleteMany({ where: { mediaId: media.id, tagId } });

  revalidatePath("/photos");
  revalidatePath(`/jobs/${media.jobId}`);
  return ok;
}

/**
 * Fixes a tag's name everywhere at once.
 *
 * This is most of why the vocabulary table exists. "wset wall" on forty
 * photos is one row to correct here and forty photos to re-tag if tags
 * were a string column — which is to say, in practice, never corrected.
 *
 * A COLLISION IS A RETURNED FAILURE, NOT A MERGE. Renaming "west wal" to
 * "west wall" when "west wall" already exists could plausibly merge the
 * two, and deliberately does not: a merge moves every assignment off one
 * tag and deletes it, which is destructive, irreversible, and nothing the
 * person asked for — they asked to fix a spelling. They are told the name
 * is taken and can take the other tag off these photos themselves.
 */
export async function renameJobMediaTag(tagId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const raw = text(formData, "name");
  const problem = tagNameProblem(raw);
  if (problem) return fail(tagNameProblemMessage(problem));

  const name = displayTagName(raw);
  const normalizedName = normalizeTagName(raw);

  const tag = await prisma.jobMediaTag.findUnique({
    where: { id: tagId },
    select: { id: true, companyId: true, normalizedName: true },
  });
  if (!tag || tag.companyId !== context.companyId) return fail("Tag not found");

  // A pure re-casing — "west wall" to "West Wall" — normalises to what is
  // already stored, so it is not a collision with itself. Checking only
  // when the folded name actually CHANGES is what makes fixing capitals
  // possible at all.
  if (normalizedName !== tag.normalizedName) {
    const clash = await prisma.jobMediaTag.findFirst({
      where: { companyId: context.companyId, normalizedName },
      select: { name: true },
    });
    if (clash) {
      return fail(
        `You already have a tag called "${clash.name}", and two tags cannot share a name. ` +
          `Take this one off the photos it is on instead, or pick a different name.`,
      );
    }
  }

  try {
    await prisma.jobMediaTag.update({ where: { id: tag.id }, data: { name, normalizedName } });
  } catch (error) {
    // The check above and this write are two statements, and somebody else
    // can create that name in between. `instanceof
    // Prisma.PrismaClientKnownRequestError` is FALSE at runtime in this app
    // — the guard would silently never fire and the person would get a 500
    // instead of this sentence — so the `code` is what is read. See
    // isUniqueConstraintError in lib/actions/shared.ts.
    if (isUniqueConstraintError(error)) {
      return fail(`Someone else just created a tag called "${name}". Reload and try again.`);
    }
    throw error;
  }

  revalidatePath("/photos");
  // Every job page shows these chips, and a rename changes all of them.
  // The `"page"` argument is required for a dynamic route: without it Next
  // warns "a dynamic page path was passed to revalidatePath, but the type
  // parameter is missing. This has no effect by default" and does nothing
  // (next@15.5.23 dist/server/web/spec-extension/revalidate.js:67-71).
  revalidatePath("/jobs/[id]", "page");
  return ok;
}

/**
 * Removes a tag from the company's vocabulary, and with it every
 * assignment.
 *
 * The assignments go by CASCADE rather than by a delete here — the FK is
 * `onDelete: Cascade` on both sides of the join (media-tags.prisma), so
 * one statement removes the word and every place it was used. There is no
 * "orphaned assignment" state to clean up afterwards, which is the whole
 * reason that relation is Cascade while most of this schema is RESTRICT: a
 * row saying two records are connected is not itself a record worth
 * refusing a delete over.
 *
 * WHICH MAKES THIS THE ONE DESTRUCTIVE ACTION IN THIS FEATURE. Deleting a
 * tag with 200 photos on it silently changes 200 photos. The count is on
 * the button in the UI for that reason; the two-step is not decoration.
 */
export async function deleteJobMediaTag(tagId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const tag = await prisma.jobMediaTag.findUnique({
    where: { id: tagId },
    select: { id: true, companyId: true },
  });
  if (!tag || tag.companyId !== context.companyId) return fail("Tag not found");

  await prisma.jobMediaTag.delete({ where: { id: tag.id } });

  revalidatePath("/photos");
  revalidatePath("/jobs/[id]", "page");
  return ok;
}

/**
 * Show a photo to the job's client, or stop showing it.
 *
 * WHAT THIS DECIDES. `/portal/[token]` is the GC's view of their own jobs,
 * reached by an unguessable link rather than an account. It shows only
 * photos whose `sharedWithClientAt` is set, so until somebody calls this,
 * a photo is internal. That default is the feature: the same gallery holds
 * the shot of another trade's damage kept for a backcharge, the unsafe
 * condition documented defensively, and the crew's own mistake before it
 * was put right. None of those are things a sub publishes to the GC by
 * accident.
 *
 * MANAGE_FIELD, THE SAME AS EVERY OTHER PHOTO ACTION, and that is a
 * deliberate choice rather than an oversight. The tempting alternative is
 * MANAGE_JOBS — "correspondence with the GC" — which reads like it keeps
 * the crew from publishing something rash. It does not: `FIELD` holds
 * BOTH capabilities (lib/permissions.ts), so the only functions the
 * stricter gate would exclude are PAYROLL_COMPLIANCE and ACCOUNTING, who
 * have no reason to be in here anyway. It would have been a guard that
 * reads as protection and protects nobody, which is a shape this codebase
 * has paid for. The real safeguard is that sharing is off by default,
 * one photo at a time, and visible at a glance on the card.
 *
 * WHO AND WHEN ARE RECORDED because this is a disclosure. Unsharing
 * clears both rather than keeping a "was shared" flag: the column answers
 * "can the client see this", and a photo that has been withdrawn cannot.
 * The audit value is in the CHANGELOG of the row's life, which this
 * schema does not keep for photos and should not start keeping for one
 * field — if that history is ever needed it wants its own table, not a
 * second meaning bolted onto this one.
 */
export async function setJobMediaClientSharing(
  mediaId: string,
  shared: boolean,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_FIELD")) return fail(FIELD_ONLY);

  const media = await prisma.jobMedia.findUnique({
    where: { id: mediaId },
    select: { id: true, companyId: true, jobId: true, sharedWithClientAt: true },
  });
  if (!media || media.companyId !== context.companyId) return fail("Photo not found");

  // Idempotent in both directions: sharing an already-shared photo keeps
  // the ORIGINAL timestamp rather than moving it forward, because the
  // question the column answers is when the client first saw it, and a
  // second click on a button that already did its job must not rewrite
  // that. Unsharing something already private is a no-op.
  if (shared && media.sharedWithClientAt) return ok;
  if (!shared && !media.sharedWithClientAt) return ok;

  await prisma.jobMedia.update({
    where: { id: media.id },
    data: shared
      ? { sharedWithClientAt: new Date(), sharedWithClientByUserId: context.id }
      : { sharedWithClientAt: null, sharedWithClientByUserId: null },
  });

  revalidatePath("/photos");
  revalidatePath(`/jobs/${media.jobId}`);
  return ok;
}
