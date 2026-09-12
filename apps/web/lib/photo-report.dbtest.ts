import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * What the printed site photo report is allowed to contain, and who is
 * allowed to print one.
 *
 * `.dbtest.ts` AND NOT A UNIT TEST, because every claim this document makes
 * is a claim about a `where` clause and a `select`, and a pure test
 * structurally cannot see either. `lib/photo-report.test.ts` covers the
 * rules that ARE decidable without a database — the selection vocabulary,
 * the ordering, the grouping, the href — and stops at the point where the
 * answer comes out of Postgres.
 *
 * The stakes are the portal's, one step worse. A photo the portal shows by
 * mistake is withdrawn by clicking "stop sharing"; a photograph printed
 * into a PDF and emailed to a general contractor is not withdrawable at
 * all. So the four things checked here are the four that cannot be checked
 * anywhere else:
 *
 *  - THE DEFAULT SELECTION. Absent parameter means the captures the client
 *    has already been shown. The document is where the sub's own framing of
 *    the job — the backcharge evidence, the crew's own mistake — must not
 *    turn up by accident.
 *  - THE FALSY-BOOLEAN TRAP. `shared: false` means "only what the client
 *    CANNOT see". Composed the obvious way it is silently dropped and the
 *    report prints everything while looking entirely correct.
 *  - THE PROJECTION. `JobPhotoReportCapture` deliberately cannot carry a
 *    tag, a photographer or a coordinate. Asserted on the SERIALISED result
 *    rather than on the type, because the type is what a future edit
 *    changes on its way to breaking this.
 *  - THE CAPABILITY. MEMBER + a job function, never `role: "OWNER"` — an
 *    owner holds every capability regardless, so a refusal test written
 *    against the role proves nothing at all. Two annotation tests were once
 *    written exactly that way.
 *
 * Run against a SCRATCH database — it creates and deletes companies:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web run test:db
 */

/** The signed-in person, swapped per case. Same shape
 * `requireCompanyContext` returns; `jobFunction` — NOT `role` — is what
 * `can()` reads. */
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

const { loadJobMediaForReport, countJobMedia } = await import("./job-media-query");
const { requireCapability } = await import("./authz");
const {
  PHOTO_REPORT_LIMIT,
  groupByDay,
  oldestFirst,
  parsePhotoReportSelection,
  partitionPrintable,
  photoReportSharedFlag,
} = await import("./photo-report");

const ZONE = "America/Los_Angeles";
const at = (iso: string) => new Date(`${iso}Z`);

let companyId = "";
let ownerUserId = "";
/** MEMBER + ACCOUNTING and MEMBER + FIELD, both REAL ROWS. The job function
 *  that decides the refusal is read back off the database rather than
 *  asserted from a literal, which is the only version of this check that is
 *  about the app rather than about the mock. */
let accountingUserId = "";
let fieldUserId = "";
let jobId = "";
let otherJobId = "";
let otherCompanyId = "";
let otherCompanyMediaId = "";
let tagId = "";

/** The photos on `jobId`, named by what each one is for. */
let sharedId = "";
let internalId = "";
let taggedSharedId = "";
let clipId = "";
let noteId = "";
let sharedOnOtherJobId = "";

const TAG_NAME = "backcharge";
const PHOTOGRAPHER = "Marisol Vega";
/** A latitude nobody would produce by accident, so finding these digits in
 *  the serialised document is unambiguous. */
const LATITUDE = 36.16994;
const LONGITUDE = -115.13983;

function media(
  name: string,
  job: string,
  capturedAt: string,
  caption: string | null,
  extra: Record<string, unknown> = {},
) {
  return prisma.jobMedia.create({
    data: {
      companyId,
      jobId: job,
      blobUrl: `https://store.public.blob.vercel-storage.com/job-media/${job}/${name}.jpg`,
      contentType: "image/jpeg",
      byteSize: 1024,
      caption,
      capturedAt: at(capturedAt),
      capturedByUserId: ownerUserId,
      ...extra,
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

describe("the printed site photo report", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Report Drywall Co" } });
    companyId = company.id;

    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        companyId,
        clerkId: `report-owner-${stamp}`,
        email: `report-owner-${stamp}@example.test`,
        name: PHOTOGRAPHER,
        role: "OWNER",
      },
    });
    ownerUserId = owner.id;
    const accounting = await prisma.user.create({
      data: {
        companyId,
        clerkId: `report-acct-${stamp}`,
        email: `report-acct-${stamp}@example.test`,
        name: "Book Keeper",
        role: "MEMBER",
        jobFunction: "ACCOUNTING",
      },
    });
    accountingUserId = accounting.id;
    const field = await prisma.user.create({
      data: {
        companyId,
        clerkId: `report-field-${stamp}`,
        email: `report-field-${stamp}@example.test`,
        name: "Foreman",
        role: "MEMBER",
        jobFunction: "FIELD",
      },
    });
    fieldUserId = field.id;

    const gc = await prisma.contact.create({ data: { companyId, name: "Turner GC" } });
    const otherGc = await prisma.contact.create({ data: { companyId, name: "Skanska GC" } });

    const job = await prisma.job.create({
      data: { companyId, contactId: gc.id, name: "Riverside Tower", status: "IN_PROGRESS" },
    });
    jobId = job.id;
    const otherJob = await prisma.job.create({
      data: { companyId, contactId: otherGc.id, name: "Harbor Point", status: "IN_PROGRESS" },
    });
    otherJobId = otherJob.id;

    // Two on the same DAY and one on the next, so the day grouping has
    // something real to group. Coordinates on the shared one, because the
    // exclusion that matters most is the one on the capture that IS
    // disclosable and therefore likeliest to be printed.
    const shared = await media("shared", jobId, "2026-09-04T21:00:00.000", "West wall, after patch", {
      capturedLatitude: LATITUDE,
      capturedLongitude: LONGITUDE,
      capturedAccuracyMeters: 12,
    });
    sharedId = shared.id;
    // 04:00 UTC on the 5th is 21:00 the PREVIOUS EVENING in Los Angeles, and
    // that is chosen rather than convenient: it is the only kind of row that
    // can tell a day heading computed in the viewer's zone apart from one
    // computed in UTC. With every capture safely mid-afternoon the grouping
    // test passes either way, which is a test that cannot see the bug it is
    // for.
    const taggedShared = await media(
      "tagged",
      jobId,
      "2026-09-05T04:00:00.000",
      "Their electrician's conduit through our header",
    );
    taggedSharedId = taggedShared.id;
    const internal = await media(
      "internal",
      jobId,
      "2026-09-05T16:00:00.000",
      "Our own mistake, before we fixed it",
    );
    internalId = internal.id;
    const clip = await media("walkthrough", jobId, "2026-09-05T17:00:00.000", "Level 2 riser", {
      contentType: "video/quicktime",
    });
    clipId = clip.id;
    const note = await media("narration", jobId, "2026-09-05T17:05:00.000", "What is behind this", {
      contentType: "audio/mp4",
    });
    noteId = note.id;
    const elsewhere = await media("elsewhere", otherJobId, "2026-09-04T22:00:00.000", "Harbor slab");
    sharedOnOtherJobId = elsewhere.id;

    // An arrow and a label on the shared photo. The marks are the reason
    // this document exists, so their arrival is asserted rather than assumed.
    await prisma.jobMediaAnnotation.createMany({
      data: [
        {
          mediaId: sharedId,
          kind: "ARROW",
          x1: 0.1,
          y1: 0.2,
          x2: 0.6,
          y2: 0.7,
          label: null,
          createdByUserId: ownerUserId,
        },
        {
          mediaId: sharedId,
          kind: "TEXT",
          x1: 0.5,
          y1: 0.5,
          x2: null,
          y2: null,
          label: "Rework this joint",
          createdByUserId: ownerUserId,
        },
      ],
    });

    // The tag goes on a SHARED photo on purpose: the document must not
    // carry the sub's own word for what this dispute is, and the only way
    // to be sure is to put that word on a capture the report will include.
    const tag = await prisma.jobMediaTag.create({
      data: { companyId, name: TAG_NAME, normalizedName: TAG_NAME },
    });
    tagId = tag.id;
    await prisma.jobMediaTagAssignment.create({
      data: { mediaId: taggedSharedId, tagId, taggedByUserId: ownerUserId },
    });

    const otherCompany = await prisma.company.create({ data: { name: "Somebody Else Inc" } });
    otherCompanyId = otherCompany.id;
    const theirContact = await prisma.contact.create({
      data: { companyId: otherCompanyId, name: "Their GC" },
    });
    const theirJob = await prisma.job.create({
      data: { companyId: otherCompanyId, contactId: theirContact.id, name: "Not yours" },
    });
    const theirs = await prisma.jobMedia.create({
      data: {
        companyId: otherCompanyId,
        jobId: theirJob.id,
        blobUrl: `https://store.public.blob.vercel-storage.com/job-media/${theirJob.id}/theirs.jpg`,
        contentType: "image/jpeg",
        byteSize: 2048,
        capturedAt: at("2026-09-04T10:00:00.000"),
        sharedWithClientAt: at("2026-09-06T12:00:00.000"),
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
      const mediaIds = rows.map((r) => r.id);
      await prisma.jobMediaAnnotation.deleteMany({ where: { mediaId: { in: mediaIds } } });
      await prisma.jobMediaTagAssignment.deleteMany({ where: { mediaId: { in: mediaIds } } });
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
    // Every case starts from the same visibility whatever the last one did,
    // so no test depends on the order the file happens to run in.
    await prisma.jobMedia.updateMany({
      where: { id: { in: [sharedId, taggedSharedId, clipId, sharedOnOtherJobId] } },
      data: { sharedWithClientAt: at("2026-09-06T12:00:00.000"), sharedWithClientByUserId: ownerUserId },
    });
    await prisma.jobMedia.updateMany({
      where: { id: { in: [internalId, noteId] } },
      data: { sharedWithClientAt: null, sharedWithClientByUserId: null },
    });
  });

  /* ---------------------------------------------------------------- *
   * Who may print one
   * ---------------------------------------------------------------- */

  it("refuses a MEMBER whose job function does not include MANAGE_FIELD", async () => {
    // Read the FUNCTION back off the row rather than trusting the fixture:
    // this check is only about the app if the value it turns on came out of
    // the database.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: accountingUserId } });
    expect(row.role).toBe("MEMBER");
    expect(row.jobFunction).toBe("ACCOUNTING");

    context.id = row.id;
    context.companyId = companyId;
    context.company = { id: companyId };
    context.role = row.role;
    context.jobFunction = row.jobFunction;

    const { allowed } = await requireCapability("MANAGE_FIELD");
    expect(allowed).toBe(false);
  });

  it("lets a MEMBER in the field print one — the control the refusal needs", async () => {
    // Without this, a guard that refused everybody would satisfy the case
    // above perfectly. FIELD is the crew on site, which is who takes the
    // photographs this document is made of.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: fieldUserId } });
    expect(row.role).toBe("MEMBER");
    expect(row.jobFunction).toBe("FIELD");

    context.id = row.id;
    context.companyId = companyId;
    context.company = { id: companyId };
    context.role = row.role;
    context.jobFunction = row.jobFunction;

    const { allowed } = await requireCapability("MANAGE_FIELD");
    expect(allowed).toBe(true);
  });

  it("lets an OWNER through regardless of job function, which is why the refusal above is a MEMBER", async () => {
    // Recorded as its own case rather than as a comment, because it is the
    // reason the two cases above are written the way they are: an owner
    // holds every capability whatever their job function, so a refusal test
    // written against `role: "OWNER"` passes while proving nothing.
    context.id = ownerUserId;
    context.companyId = companyId;
    context.company = { id: companyId };
    context.role = "OWNER";
    context.jobFunction = "ACCOUNTING";

    const { allowed } = await requireCapability("MANAGE_FIELD");
    expect(allowed).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * What goes on the paper
   * ---------------------------------------------------------------- */

  it("defaults to the captures the client has already been shown", async () => {
    // The document's whole safety posture, executed end to end: no
    // parameter -> the safe selection -> the safe `where`.
    const selection = parsePhotoReportSelection(undefined);
    const captures = await loadJobMediaForReport(
      {
        jobId,
        companyId,
        ...(photoReportSharedFlag(selection) === undefined
          ? {}
          : { shared: photoReportSharedFlag(selection) }),
        take: PHOTO_REPORT_LIMIT,
      },
      ZONE,
    );

    const ids = captures.map((c) => c.id);
    expect(ids).toContain(sharedId);
    expect(ids).toContain(taggedSharedId);
    expect(ids).not.toContain(internalId);
    expect(ids).not.toContain(noteId);
  });

  it("prints the OTHER half when asked, and `false` is not silently dropped", async () => {
    // THE FALSY-BOOLEAN TRAP. Composed the obvious way — `...(shared ? … :
    // {})` — this returns the everything report, and the failure looks
    // exactly like a working document. The assertion that catches it is
    // that the two halves are DIFFERENT and the negative one excludes what
    // the client can see.
    const notShared = await loadJobMediaForReport(
      { jobId, companyId, shared: false, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const shared = await loadJobMediaForReport(
      { jobId, companyId, shared: true, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const everything = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );

    expect(notShared.map((c) => c.id).sort()).toEqual([internalId, noteId].sort());
    expect(notShared.map((c) => c.id)).not.toContain(sharedId);
    // The partition property, which is the durable form of it: whatever the
    // fixture grows into, the two halves must add up to the whole.
    expect(shared.length + notShared.length).toBe(everything.length);
    expect(everything.length).toBe(5);
  });

  it("never reaches into another job, or another company", async () => {
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(captures.map((c) => c.id)).not.toContain(sharedOnOtherJobId);
    expect(captures.map((c) => c.id)).not.toContain(otherCompanyMediaId);

    // And the other job's report has its own, so the clause is filtering
    // rather than simply excluding everything.
    const theirs = await loadJobMediaForReport(
      { jobId: otherJobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(theirs.map((c) => c.id)).toEqual([sharedOnOtherJobId]);

    // A job id that is real but belongs to somebody else returns nothing,
    // rather than that company's document.
    const crossTenant = await loadJobMediaForReport(
      { jobId: otherJobId, companyId: otherCompanyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(crossTenant).toEqual([]);
  });

  it("carries no tag, no photographer and no coordinates anywhere in what it returns", async () => {
    // The exclusions, checked on the SERIALISED result rather than on the
    // type. `JobPhotoReportCapture` not having these fields is what stops
    // this today; this is what fails on the day somebody widens the type or
    // the select, which is the day it matters — and this document, unlike
    // the portal, cannot be un-published once it is a PDF in an inbox.
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const serialised = JSON.stringify(captures);

    expect(serialised).not.toContain(TAG_NAME);
    expect(serialised).not.toContain(PHOTOGRAPHER);
    expect(serialised).not.toContain(String(LATITUDE));
    expect(serialised).not.toContain(String(LONGITUDE));
    expect(serialised).not.toContain("capturedLatitude");

    expect(Object.keys(captures[0]).sort()).toEqual([
      "blobUrl",
      "caption",
      "capturedAtLabel",
      "clientCanSee",
      "dayLabel",
      "id",
      "kind",
      "marks",
    ]);
  });

  it("brings the marks with it, geometry and words and nothing about who drew them", async () => {
    // The reason the report exists. The blob URL serves an unmarked
    // photograph, so if the marks do not arrive here the document is the
    // same thing the sub could already email.
    const captures = await loadJobMediaForReport(
      { jobId, companyId, shared: true, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const withMarks = captures.find((c) => c.id === sharedId);
    expect(withMarks?.marks).toHaveLength(2);
    // Ordered by creation, so overlapping marks paint in a stable order
    // between renders — SVG paints in document order.
    expect(withMarks?.marks.map((m) => m.kind)).toEqual(["ARROW", "TEXT"]);
    expect(withMarks?.marks[0].x1).toBeCloseTo(0.1);
    expect(withMarks?.marks[1].label).toBe("Rework this joint");
    expect(Object.keys(withMarks!.marks[0]).sort()).toEqual([
      "id",
      "kind",
      "label",
      "x1",
      "x2",
      "y1",
      "y2",
    ]);
  });

  it("derives whether the client can see each capture, from the timestamp and nothing else", async () => {
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const byId = new Map(captures.map((c) => [c.id, c]));
    expect(byId.get(sharedId)?.clientCanSee).toBe(true);
    expect(byId.get(internalId)?.clientCanSee).toBe(false);

    // Withdraw it and the same read says the opposite — one stored fact, no
    // second flag beside it that could disagree.
    await prisma.jobMedia.update({
      where: { id: sharedId },
      data: { sharedWithClientAt: null, sharedWithClientByUserId: null },
    });
    const after = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(after.find((c) => c.id === sharedId)?.clientCanSee).toBe(false);
  });

  it("composes the tag filter with the selection rather than replacing it", async () => {
    // "The backcharge photos we have already shown this GC" is the compound
    // question, and AND is the only reading of it that is not dangerous — a
    // filter that quietly became OR would print the internal photo onto a
    // document somebody is reading as the shared set.
    const sharedAndTagged = await loadJobMediaForReport(
      { jobId, companyId, shared: true, tagId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(sharedAndTagged.map((c) => c.id)).toEqual([taggedSharedId]);

    // Same tag, opposite selection: the tag is only on a shared capture, so
    // this must be empty. Under an OR it would return several.
    const notSharedAndTagged = await loadJobMediaForReport(
      { jobId, companyId, shared: false, tagId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(notSharedAndTagged).toEqual([]);
  });

  it("counts the same population the document prints, on every selection", async () => {
    // The "most recent N of M" line is a separate query, and it is printed
    // ON THE PAPER. A filter added to the read and forgotten on the count
    // produces a document stating a number that is not about the
    // photographs in it.
    for (const shared of [true, false, undefined]) {
      const captures = await loadJobMediaForReport(
        { jobId, companyId, ...(shared === undefined ? {} : { shared }), take: PHOTO_REPORT_LIMIT },
        ZONE,
      );
      const total = await countJobMedia({
        companyId,
        jobId,
        ...(shared === undefined ? {} : { shared }),
      });
      expect(total).toBe(captures.length);
    }
  });

  it("reads out of the database newest-first, and onto the paper oldest-first", async () => {
    // The two halves of one rule: the CAP has to keep the most recent
    // captures, and the DOCUMENT has to read forwards. Checked together
    // because either alone is satisfiable by the wrong code.
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    expect(captures[0].id).toBe(noteId); // 17:05 on the 5th, the latest
    expect(captures[captures.length - 1].id).toBe(sharedId); // 21:00 on the 4th

    const document = oldestFirst(captures);
    expect(document[0].id).toBe(sharedId);
    expect(document[document.length - 1].id).toBe(noteId);
  });

  it("keeps the MOST RECENT captures when it caps, not the oldest", async () => {
    const capped = await loadJobMediaForReport({ jobId, companyId, take: 2 }, ZONE);
    expect(capped.map((c) => c.id)).toEqual([noteId, clipId]);
    // And the count still answers about the whole matching population, so
    // the printed "2 of 5" line is true.
    expect(await countJobMedia({ companyId, jobId })).toBe(5);
  });

  it("groups the document by the day each capture was taken, in the viewer's zone", async () => {
    // Two captures at 21:00 and 23:30 UTC on the 4th are the same afternoon
    // in Los Angeles; the third is the next day. Grouping in UTC would file
    // the 23:30 one under its own heading — a document about what happened
    // on a job, filed under the wrong day.
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const { printable } = partitionPrintable(oldestFirst(captures));
    const days = groupByDay(printable);

    expect(days.map((d) => d.day)).toEqual([
      "Friday, September 4, 2026",
      "Saturday, September 5, 2026",
    ]);
    expect(days[0].captures.map((c) => c.id)).toEqual([sharedId, taggedSharedId]);
    expect(days[1].captures.map((c) => c.id)).toEqual([internalId]);
  });

  it("keeps the video and the voice note out of the photographs and into the list", async () => {
    // Paper cannot hold a recording, and the decision is to LIST them
    // rather than drop them — a document that silently omits a walk-through
    // tells its reader the job's record is these photographs.
    const captures = await loadJobMediaForReport(
      { jobId, companyId, take: PHOTO_REPORT_LIMIT },
      ZONE,
    );
    const { printable, notPrintable } = partitionPrintable(oldestFirst(captures));

    expect(printable.every((c) => c.kind === "photo")).toBe(true);
    expect(notPrintable.map((c) => c.id).sort()).toEqual([clipId, noteId].sort());
    expect(notPrintable.map((c) => c.kind).sort()).toEqual(["audio", "video"]);
    // Nothing was lost between the two.
    expect(printable.length + notPrintable.length).toBe(captures.length);
  });

  it("says nothing at all for a job with nothing in the selection", async () => {
    // An empty result rather than a throw: the page prints a sentence
    // saying which selection is on, and a blank sheet pretending to be a
    // report is the failure this replaces.
    const empty = await prisma.job.create({
      data: {
        companyId,
        contactId: (await prisma.contact.findFirstOrThrow({ where: { companyId } })).id,
        name: "Nothing photographed yet",
        status: "ESTIMATE",
      },
    });
    // Cleaned up in a `finally` because this suite's counts and orderings
    // are asserted against a fixed fixture, and a row that outlives its
    // test is how a suite quietly stops being order-independent.
    try {
      expect(
        await loadJobMediaForReport({ jobId: empty.id, companyId, take: PHOTO_REPORT_LIMIT }, ZONE),
      ).toEqual([]);
      expect(await countJobMedia({ companyId, jobId: empty.id })).toBe(0);
    } finally {
      await prisma.job.delete({ where: { id: empty.id } });
    }
  });
});
