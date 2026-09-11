import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Showing a site photo to the GC, and — the half that matters — not showing
 * the others.
 *
 * `.dbtest.ts` AND NOT A UNIT TEST, because every claim this feature makes
 * is a claim about a `where` clause, and a pure test structurally cannot see
 * one. That is the same reason `retainage-query.dbtest.ts` exists, and the
 * stakes here are higher than a wrong number: the thing on the other side of
 * this filter is a general contractor, and the photos it withholds are the
 * backcharge evidence, the unsafe condition documented defensively, and the
 * crew's own mistake before it was put right (see media.prisma).
 *
 * Four things nothing else in this repo can check:
 *
 *  - THE OPT-IN. `sharedWithClientAt: { not: null }` is the entire boundary
 *    between internal and published. Typecheck, lint and build are all
 *    perfectly happy with it inverted, missing, or applied to the wrong
 *    query.
 *  - THE JOB SCOPE. The portal reads one job. A shared photo on another job
 *    of the same company must not appear, and no amount of reading the code
 *    proves that as well as putting one there.
 *  - THE PROJECTION. `PortalJobPhoto` deliberately cannot carry tags or a
 *    photographer's name. The assertions below check the SERIALISED result
 *    for those strings rather than checking the type, because the type is
 *    what a future edit changes on its way to breaking this.
 *  - THE FALSY-BOOLEAN TRAP. `shared: false` means "only photos the client
 *    cannot see". Written the obvious way it is silently dropped and the
 *    gallery shows everything, which looks exactly like a working page.
 *
 * Run against a SCRATCH database — it creates and deletes companies:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 */

/** The signed-in person, swapped per case. Same shape
 * `requireCompanyContext` returns — the `User` row with `company` included,
 * so `companyId`, `id`, `role` and `jobFunction` all come off it. */
const context = {
  id: "",
  companyId: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
  company: { id: "" },
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setJobMediaClientSharing } = await import("./actions/jobMedia");
const {
  countJobMedia,
  countSharedJobMediaByJob,
  loadJobMedia,
  loadSharedJobMediaForClient,
} = await import("./job-media-query");

const at = (iso: string) => new Date(`${iso}Z`);

let companyId = "";
let ownerUserId = "";
let contactId = "";
let jobId = "";
/** A second job of the SAME company, belonging to a DIFFERENT contact. The
 * cross-job leak this feature could have. */
let otherJobId = "";
/** A whole second tenant, for the cross-company case. */
let otherCompanyId = "";
let otherCompanyMediaId = "";

/** The photos on `jobId`. Named by what each one is for. */
let sharedId = "";
let internalId = "";
/** Shared, but on `otherJobId` — must never reach `jobId`'s portal page. */
let sharedOnOtherJobId = "";

const TAG_NAME = "backcharge";
const PHOTOGRAPHER = "Marisol Vega";

function media(
  name: string,
  job: string,
  capturedAt: string,
  caption: string | null,
  contentType = "image/jpeg",
) {
  return prisma.jobMedia.create({
    data: {
      companyId,
      jobId: job,
      blobUrl: `https://public.blob.vercel-storage.com/job-media/${job}/${name}.jpg`,
      contentType,
      byteSize: 1024,
      caption,
      capturedAt: at(capturedAt),
      capturedByUserId: ownerUserId,
    },
  });
}

function asOwner() {
  context.id = ownerUserId;
  context.companyId = companyId;
  context.company = { id: companyId };
  context.role = "OWNER";
  context.jobFunction = null;
}

describe("client sharing for site photos", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Sharing Drywall Co" } });
    companyId = company.id;

    const owner = await prisma.user.create({
      data: {
        companyId,
        clerkId: `share-owner-${Date.now()}`,
        email: `share-owner-${Date.now()}@example.test`,
        name: PHOTOGRAPHER,
        role: "OWNER",
      },
    });
    ownerUserId = owner.id;

    const gc = await prisma.contact.create({
      data: { companyId, name: "Turner GC", portalToken: `tok-share-${Date.now()}` },
    });
    contactId = gc.id;
    const otherGc = await prisma.contact.create({
      data: { companyId, name: "Skanska GC", portalToken: `tok-other-${Date.now()}` },
    });

    const job = await prisma.job.create({
      data: { companyId, contactId, name: "Riverside Tower", status: "IN_PROGRESS" },
    });
    jobId = job.id;
    const otherJob = await prisma.job.create({
      data: { companyId, contactId: otherGc.id, name: "Harbor Point", status: "IN_PROGRESS" },
    });
    otherJobId = otherJob.id;

    const shared = await media("shared", jobId, "2026-09-05T14:00:00.000", "West wall, after patch");
    sharedId = shared.id;
    const internal = await media("internal", jobId, "2026-09-06T09:00:00.000", "Their electrician's damage");
    internalId = internal.id;
    const elsewhere = await media("elsewhere", otherJobId, "2026-09-05T15:00:00.000", "Harbor slab");
    sharedOnOtherJobId = elsewhere.id;

    // A tag on the photo that WILL be shared. The portal must not show the
    // word "backcharge" to the party it is about, and the only way to be
    // sure is to put it on the photo the GC can see.
    const tag = await prisma.jobMediaTag.create({
      data: { companyId, name: TAG_NAME, normalizedName: TAG_NAME },
    });
    await prisma.jobMediaTagAssignment.create({
      data: { mediaId: sharedId, tagId: tag.id, taggedByUserId: ownerUserId },
    });

    const otherCompany = await prisma.company.create({ data: { name: "Somebody Else Inc" } });
    otherCompanyId = otherCompany.id;
    const otherContact = await prisma.contact.create({
      data: { companyId: otherCompanyId, name: "Their GC" },
    });
    const theirJob = await prisma.job.create({
      data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Not yours" },
    });
    const theirs = await prisma.jobMedia.create({
      data: {
        companyId: otherCompanyId,
        jobId: theirJob.id,
        blobUrl: `https://public.blob.vercel-storage.com/job-media/${theirJob.id}/theirs.jpg`,
        contentType: "image/jpeg",
        byteSize: 2048,
        capturedAt: at("2026-09-04T10:00:00.000"),
      },
    });
    otherCompanyMediaId = theirs.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      const jobs = await prisma.job.findMany({ where: { companyId: id }, select: { id: true } });
      const jobIds = jobs.map((j) => j.id);
      const rows = await prisma.jobMedia.findMany({
        where: { jobId: { in: jobIds } },
        select: { id: true },
      });
      await prisma.jobMediaTagAssignment.deleteMany({
        where: { mediaId: { in: rows.map((r) => r.id) } },
      });
      await prisma.jobMedia.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.jobMediaTag.deleteMany({ where: { companyId: id } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    asOwner();
    // Every case starts from the same visibility, whatever the last one did
    // to it, so no test depends on the order the file happens to run in.
    await prisma.jobMedia.update({
      where: { id: sharedId },
      data: { sharedWithClientAt: at("2026-09-07T12:00:00.000"), sharedWithClientByUserId: ownerUserId },
    });
    await prisma.jobMedia.update({
      where: { id: internalId },
      data: { sharedWithClientAt: null, sharedWithClientByUserId: null },
    });
    await prisma.jobMedia.update({
      where: { id: sharedOnOtherJobId },
      data: { sharedWithClientAt: at("2026-09-07T12:00:00.000"), sharedWithClientByUserId: ownerUserId },
    });
  });

  /* ---------------------------------------------------------------- *
   * The action
   * ---------------------------------------------------------------- */

  it("records WHO shared it and WHEN, not just that it happened", async () => {
    const before = new Date();
    expect(await setJobMediaClientSharing(internalId, true)).toEqual({ ok: true });

    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: internalId } });
    expect(row.sharedWithClientAt).not.toBeNull();
    expect((row.sharedWithClientAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row.sharedWithClientByUserId).toBe(ownerUserId);
  });

  it("does not move the timestamp when an already-shared photo is shared again", async () => {
    // The idempotence claim in the action's own comment, and the only place
    // it can be checked. The column answers "when did the client first see
    // this" — a second click on a button that already did its job must not
    // rewrite the answer, because that is the sentence somebody reads back
    // in an argument about what was disclosed and when.
    const before = await prisma.jobMedia.findUniqueOrThrow({ where: { id: sharedId } });
    expect(await setJobMediaClientSharing(sharedId, true)).toEqual({ ok: true });
    const after = await prisma.jobMedia.findUniqueOrThrow({ where: { id: sharedId } });

    expect(after.sharedWithClientAt).toEqual(before.sharedWithClientAt);
    expect(after.sharedWithClientByUserId).toBe(before.sharedWithClientByUserId);
  });

  it("clears BOTH columns when a photo is withdrawn", async () => {
    // Not just the date. A left-behind `sharedWithClientByUserId` would be a
    // second, quieter record of the disclosure that the column answering
    // "can the client see this" says nothing about — two fields disagreeing
    // about one fact, which is the shape this schema refuses everywhere else.
    expect(await setJobMediaClientSharing(sharedId, false)).toEqual({ ok: true });

    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: sharedId } });
    expect(row.sharedWithClientAt).toBeNull();
    expect(row.sharedWithClientByUserId).toBeNull();
  });

  it("is a no-op, not an error, when withdrawing something already private", async () => {
    expect(await setJobMediaClientSharing(internalId, false)).toEqual({ ok: true });
    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: internalId } });
    expect(row.sharedWithClientAt).toBeNull();
  });

  it("refuses another company's photo, and leaves it exactly as it was", async () => {
    // A Server Action is its own endpoint with a stable id; the page in
    // front of it guards nothing. The id here is a real, valid cuid of a
    // real row — it is simply not this tenant's, which is the only case
    // worth testing and the one a unit test cannot construct.
    const result = await setJobMediaClientSharing(otherCompanyMediaId, true);
    expect(result).toEqual({ ok: false, error: "Photo not found" });

    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: otherCompanyMediaId } });
    expect(row.sharedWithClientAt).toBeNull();
    expect(row.sharedWithClientByUserId).toBeNull();
  });

  it("refuses somebody whose job function does not include MANAGE_FIELD", async () => {
    // ACCOUNTING holds MANAGE_BILLING, VIEW_COMPANY_FINANCIALS and
    // VIEW_JOB_COSTS, and nothing to do with the field. Publishing a photo
    // to the GC is not their call.
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";

    const result = await setJobMediaClientSharing(internalId, true);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/part of your job function/);

    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: internalId } });
    expect(row.sharedWithClientAt).toBeNull();
  });

  it("lets a FIELD member through — the control the refusal above needs", async () => {
    // Without this, an action that refused everybody would satisfy the case
    // above perfectly. FIELD is the crew on site and holds MANAGE_FIELD.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";

    expect(await setJobMediaClientSharing(internalId, true)).toEqual({ ok: true });
    const row = await prisma.jobMedia.findUniqueOrThrow({ where: { id: internalId } });
    expect(row.sharedWithClientAt).not.toBeNull();
    expect(row.sharedWithClientByUserId).toBe(ownerUserId);
  });

  /* ---------------------------------------------------------------- *
   * The portal read — the query the GC's browser reaches
   * ---------------------------------------------------------------- */

  it("shows the client the shared photo and NOT the internal one", async () => {
    const photos = await loadSharedJobMediaForClient(
      { jobId, companyId, take: 60 },
      "America/Los_Angeles",
    );

    expect(photos.map((p) => p.id)).toEqual([sharedId]);
    expect(photos[0].caption).toBe("West wall, after patch");
    // Stated as an explicit absence as well, because "the list has one item"
    // and "the list does not contain the withheld item" fail differently:
    // an off-by-one filter can satisfy the first while leaking.
    expect(photos.map((p) => p.id)).not.toContain(internalId);
  });

  it("stops showing a photo the moment it is withdrawn", async () => {
    await setJobMediaClientSharing(sharedId, false);
    const photos = await loadSharedJobMediaForClient(
      { jobId, companyId, take: 60 },
      "America/Los_Angeles",
    );
    expect(photos).toEqual([]);
  });

  it("never reaches across jobs, even for a photo that IS shared", async () => {
    // Same company, same tenant, genuinely shared — and belonging to a
    // different GC. The portal's own guard proves the CONTACT owns the job;
    // this proves the query cannot then wander outside it.
    const photos = await loadSharedJobMediaForClient(
      { jobId, companyId, take: 60 },
      "America/Los_Angeles",
    );
    expect(photos.map((p) => p.id)).not.toContain(sharedOnOtherJobId);

    // And the other job's portal page sees its own, so the clause is
    // filtering rather than simply excluding everything.
    const theirs = await loadSharedJobMediaForClient(
      { jobId: otherJobId, companyId, take: 60 },
      "America/Los_Angeles",
    );
    expect(theirs.map((p) => p.id)).toEqual([sharedOnOtherJobId]);
  });

  it("carries no tag and no photographer's name anywhere in what it returns", async () => {
    // The three exclusions, checked on the SERIALISED result rather than on
    // the type. `PortalJobPhoto` not having a `tags` field is what stops
    // this today; this is what fails on the day somebody widens the type or
    // the select, which is the day it matters.
    //
    // IT HAS NOW FAILED TWICE, ON PURPOSE, WHICH IS THE POINT OF IT.
    // Video and voice notes added `kind`, because the portal has to know
    // whether to render a picture, a player or a recording. Annotations
    // added `marks`, because an arrow drawn to show the GC where the damage
    // is, is worthless if the GC cannot see it. Both times this assertion
    // went red naming the extra key; both times the list was widened by
    // exactly one field rather than relaxed into something that would not
    // notice the next one.
    //
    // What has NOT changed either time is what the test is for: no tags, no
    // photographer. `marks` carries geometry and words and nothing about
    // who drew them — asserted separately, on the marks themselves, in
    // job-media-annotations.dbtest.ts.
    //
    // `contentType` is now SELECTED but deliberately absent below: it is
    // fetched only so `kind` can be derived from it, and the raw type never
    // reaches the GC. If it ever appears in these keys, the mapping stopped
    // mapping.
    const photos = await loadSharedJobMediaForClient(
      { jobId, companyId, take: 60 },
      "America/Los_Angeles",
    );
    const serialised = JSON.stringify(photos);

    expect(serialised).not.toContain(TAG_NAME);
    expect(serialised).not.toContain(PHOTOGRAPHER);
    expect(Object.keys(photos[0]).sort()).toEqual([
      "blobUrl",
      "caption",
      "capturedAtLabel",
      "id",
      "kind",
      "marks",
    ]);
    // And the widening carries what it was widened for: a real value the
    // portal can branch on, derived from the stored content type.
    expect(photos[0].kind).toBe("photo");
  });

  // WHAT THE GC ACTUALLY GETS HANDED when the capture is not a photo.
  // The portal branches on `kind` to choose between an image, a `<video>`
  // and an `<audio>`, and that branch is only as good as the value behind
  // it — which is derived from a stored string, so only a real row proves
  // it. Rendered output is not checked here (this repo has no precedent
  // for rendering a page in a test); what is checked is that the portal
  // read carries the right answer to the component.
  it("tells the portal a shared video is a video, and a voice note a voice note", async () => {
    const clip = await media(
      "walkthrough",
      jobId,
      "2026-09-07T08:00:00.000",
      "Level 2 riser before close-up",
      "video/quicktime",
    );
    const note = await media(
      "narration",
      jobId,
      "2026-09-07T08:05:00.000",
      "What is behind this wall",
      "audio/mp4",
    );
    // Cleaned up in a `finally`, because this suite's fixtures are three
    // rows created once and only their VISIBILITY is reset between cases —
    // so a row left behind here changes the counts and the ordering every
    // later test asserts. Its own beforeEach promises no case depends on
    // the order the file runs in, and rows that outlive their test are how
    // that promise quietly stops being true.
    try {
      await setJobMediaClientSharing(clip.id, true);
      await setJobMediaClientSharing(note.id, true);

      const photos = await loadSharedJobMediaForClient(
        { jobId, companyId, take: 60 },
        "America/Los_Angeles",
      );
      const byId = new Map(photos.map((p) => [p.id, p]));
      expect(byId.get(clip.id)?.kind).toBe("video");
      expect(byId.get(note.id)?.kind).toBe("audio");
      // The photo already in the fixture must not have been reclassified by
      // any of this — the derivation is per row, not per gallery.
      expect(byId.get(sharedId)?.kind).toBe("photo");
    } finally {
      await prisma.jobMedia.deleteMany({ where: { id: { in: [clip.id, note.id] } } });
    }
  });

  // A video is still OPT-IN, and this is the case worth having rather than
  // assuming: the sharing filter is a `where` on a timestamp and knows
  // nothing about kinds, so nothing about adding video should change it —
  // but "should" is what this suite exists to stop anyone relying on.
  it("keeps an unshared video out of the portal exactly like an unshared photo", async () => {
    const clip = await media(
      "unshared-clip",
      jobId,
      "2026-09-07T09:00:00.000",
      "Our own mistake, before we fixed it",
      "video/mp4",
    );

    try {
      const photos = await loadSharedJobMediaForClient(
        { jobId, companyId, take: 60 },
        "America/Los_Angeles",
      );
      expect(photos.map((p) => p.id)).not.toContain(clip.id);
      expect(JSON.stringify(photos)).not.toContain("unshared-clip");
    } finally {
      await prisma.jobMedia.delete({ where: { id: clip.id } });
    }
  });

  it("orders by when the picture was TAKEN, newest first", async () => {
    await setJobMediaClientSharing(internalId, true);
    const photos = await loadSharedJobMediaForClient(
      { jobId, companyId, take: 60 },
      "America/Los_Angeles",
    );
    // internal was captured 2026-09-06, shared 2026-09-05.
    expect(photos.map((p) => p.id)).toEqual([internalId, sharedId]);
  });

  it("counts shared photos per job, and omits a job with none", async () => {
    const counts = await countSharedJobMediaByJob([jobId, otherJobId]);
    expect(counts.get(jobId)).toBe(1);
    expect(counts.get(otherJobId)).toBe(1);

    await setJobMediaClientSharing(sharedId, false);
    const after = await countSharedJobMediaByJob([jobId, otherJobId]);
    // Absent rather than zero — the portal list renders the line only when
    // there is a number, so absence has to mean "nothing to see".
    expect(after.has(jobId)).toBe(false);
    expect(after.get(otherJobId)).toBe(1);
  });

  it("asks nothing at all for an empty job list", async () => {
    expect(await countSharedJobMediaByJob([])).toEqual(new Map());
  });

  /* ---------------------------------------------------------------- *
   * The gallery filter on /photos
   * ---------------------------------------------------------------- */

  it("filters the internal gallery both ways, and `false` is not dropped", async () => {
    // THE FALSY-BOOLEAN TRAP, executed. `shared: false` composed the obvious
    // way — `...(filter.shared ? … : {})` — disappears, and the "Not shared"
    // chip then renders the entire gallery while looking perfectly correct.
    // The assertion that catches it is that the two halves are DIFFERENT and
    // that the negative one excludes the shared photo.
    const zone = "America/Los_Angeles";
    const yes = await loadJobMedia({ companyId, jobId, shared: true }, zone);
    const no = await loadJobMedia({ companyId, jobId, shared: false }, zone);
    const all = await loadJobMedia({ companyId, jobId }, zone);

    expect(yes.map((m) => m.id)).toEqual([sharedId]);
    expect(no.map((m) => m.id)).toEqual([internalId]);
    expect(all.map((m) => m.id).sort()).toEqual([sharedId, internalId].sort());
  });

  it("counts the same population the list shows, on every value of the filter", async () => {
    // The count feeds "showing the 60 most recent of N", and it is a
    // separate query. A filter added to the list and forgotten on the count
    // produces a page that states a number which is not about the photos
    // underneath it — and looks entirely healthy doing it.
    const [yes, no, all] = await Promise.all([
      countJobMedia({ companyId, jobId, shared: true }),
      countJobMedia({ companyId, jobId, shared: false }),
      countJobMedia({ companyId, jobId }),
    ]);

    expect(yes).toBe(1);
    expect(no).toBe(1);
    // The partition property, which is the durable form of it: whatever the
    // fixture grows into, the two halves must add up to the whole.
    expect(yes + no).toBe(all);
  });

  it("composes the visibility filter with the tag filter rather than replacing it", async () => {
    // "The backcharge photos we have shown this GC" is the compound
    // question the chips exist to answer, and AND is the only reading of it
    // that is not dangerous — a filter that quietly became OR would put the
    // internal photo in a list somebody is reading as the shared set.
    const tag = await prisma.jobMediaTag.findFirstOrThrow({ where: { companyId, name: TAG_NAME } });
    const zone = "America/Los_Angeles";

    expect(
      (await loadJobMedia({ companyId, jobId, tagId: tag.id, shared: true }, zone)).map((m) => m.id),
    ).toEqual([sharedId]);
    // Same tag, opposite visibility: the tag is only on the shared photo, so
    // this must be empty. Under an OR it would return both.
    expect(await loadJobMedia({ companyId, jobId, tagId: tag.id, shared: false }, zone)).toEqual([]);
    expect(await countJobMedia({ companyId, jobId, tagId: tag.id, shared: false })).toBe(0);
  });

  it("gives the card a label to render only when the client can see the photo", async () => {
    // What `JobMediaCard` branches on for its badge and its two buttons. A
    // label present on an unshared photo would put "Client can see this"
    // over a photo the client cannot see, which is the one failure this
    // whole safeguard cannot survive.
    const zone = "America/Los_Angeles";
    const rows = await loadJobMedia({ companyId, jobId }, zone);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(internalId)?.sharedWithClientLabel).toBeNull();
    expect(byId.get(sharedId)?.sharedWithClientLabel).toBe("Sep 7, 2026, 5:00 AM");
  });
});
