import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Saving what somebody drew, and getting it back out on both sides.
 *
 * `.dbtest.ts` rather than a unit test because every claim worth making
 * here is a claim about rows: that a save REPLACES the previous set rather
 * than adding to it, that it does so atomically, that a company cannot
 * write on another company's photo, and that deleting a photo takes its
 * marks with it rather than being blocked by them. A pure test can see none
 * of those — `lib/job-media-annotations.test.ts` covers the geometry and
 * the validation, which is the half that IS decidable without a database.
 *
 * The CASCADE case matters more than it looks. #227 and #228 were both
 * per-job RESTRICT children that silently blocked a delete, and the guard
 * that should have caught them was green. This model is CASCADE on purpose
 * so it can never join that list, and the last case here is what proves it
 * rather than asserting it from the schema text.
 */

const OWNER = "owner@marks.test";
const OTHER = "owner@othermarks.test";

/** The shape `requireCompanyContext` returns, narrowed to what these paths
 *  read. `jobFunction` is the one that decides capabilities — NOT `role`,
 *  which is about ownership. Getting that wrong is why the last case in
 *  this file failed the first time it ran: it set `role: "ACCOUNTING"`,
 *  which `can()` never looks at, so a person who should have been refused
 *  sailed through and the test caught my mock rather than the code. */
let context = {
  id: "",
  companyId: "",
  email: OWNER,
  role: "OWNER",
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveJobMediaAnnotations } = await import("./actions/jobMedia");
const { loadJobMedia, loadSharedJobMediaForClient } = await import("./job-media-query");

let companyId = "";
let otherCompanyId = "";
let ownerUserId = "";
let otherUserId = "";
let jobId = "";
let mediaId = "";
let otherMediaId = "";

function arrow(over: Record<string, unknown> = {}) {
  return { kind: "ARROW" as const, x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.6, label: null, ...over };
}

async function makeCompany(name: string, email: string) {
  const company = await prisma.company.create({ data: { name } });
  const user = await prisma.user.create({
    data: { clerkId: `clerk-${email}`, email, name: "Owner", role: "OWNER", companyId: company.id },
  });
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: `GC ${name}`, status: "ACTIVE" },
  });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: `Job ${name}`, status: "ESTIMATE" },
  });
  const media = await prisma.jobMedia.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      blobUrl: `https://public.blob.vercel-storage.com/job-media/${job.id}/x.jpg`,
      contentType: "image/jpeg",
      byteSize: 2048,
      capturedAt: new Date("2026-09-10T12:00:00.000Z"),
      capturedByUserId: user.id,
    },
  });
  return { company, user, job, media };
}

describe("marks on a site photo", () => {
  beforeAll(async () => {
    const mine = await makeCompany("Marks Drywall", OWNER);
    companyId = mine.company.id;
    ownerUserId = mine.user.id;
    jobId = mine.job.id;
    mediaId = mine.media.id;

    const theirs = await makeCompany("Other Drywall", OTHER);
    otherCompanyId = theirs.company.id;
    otherUserId = theirs.user.id;
    otherMediaId = theirs.media.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      if (!id) continue;
      const jobs = await prisma.job.findMany({ where: { companyId: id }, select: { id: true } });
      const jobIds = jobs.map((j) => j.id);
      await prisma.jobMedia.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    }
  });

  beforeEach(async () => {
    context = { id: ownerUserId, companyId, email: OWNER, role: "OWNER", jobFunction: null };
    await prisma.jobMediaAnnotation.deleteMany({ where: { mediaId: { in: [mediaId, otherMediaId] } } });
  });

  it("saves what was drawn, and hands it back to the gallery", async () => {
    expect(
      await saveJobMediaAnnotations(mediaId, [
        arrow(),
        { kind: "TEXT", x1: 0.4, y1: 0.2, x2: null, y2: null, label: "  rework  " },
      ]),
    ).toEqual({ ok: true });

    const [card] = await loadJobMedia({ companyId, jobId, take: 10 }, "UTC");
    expect(card.marks).toHaveLength(2);
    expect(card.marks.map((m) => m.kind).sort()).toEqual(["ARROW", "TEXT"]);
    // Trimmed on the way in, so no reader has to trim it again.
    expect(card.marks.find((m) => m.kind === "TEXT")?.label).toBe("rework");
  });

  // THE CLAIM THE ACTION'S NAME MAKES. A second save is the whole picture,
  // not an addition to it — get this wrong and every edit doubles the marks.
  it("REPLACES the previous set rather than adding to it", async () => {
    await saveJobMediaAnnotations(mediaId, [arrow(), arrow({ x1: 0.2, y1: 0.2 })]);
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId } })).toBe(2);

    await saveJobMediaAnnotations(mediaId, [arrow({ x1: 0.3, y1: 0.3 })]);
    const rows = await prisma.jobMediaAnnotation.findMany({ where: { mediaId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].x1).toBeCloseTo(0.3, 10);
  });

  it("clears every mark when the set is empty", async () => {
    await saveJobMediaAnnotations(mediaId, [arrow()]);
    expect(await saveJobMediaAnnotations(mediaId, [])).toEqual({ ok: true });
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId } })).toBe(0);
  });

  // ATOMIC, which is why the action uses $transaction: a save that deleted
  // the old marks and then failed would leave a photo that somebody had
  // annotated showing nothing at all.
  it("leaves the old marks untouched when the new set is refused", async () => {
    await saveJobMediaAnnotations(mediaId, [arrow()]);

    const refused = await saveJobMediaAnnotations(mediaId, [
      arrow({ x1: 0.2, y1: 0.2 }),
      // Off the image: the validator refuses the SET before it writes.
      arrow({ x1: 5 }),
    ]);
    expect(refused.ok).toBe(false);

    const rows = await prisma.jobMediaAnnotation.findMany({ where: { mediaId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].x1).toBeCloseTo(0.1, 10);
  });

  it("refuses a mark on another company's photo, and writes nothing", async () => {
    const refused = await saveJobMediaAnnotations(otherMediaId, [arrow()]);
    expect(refused).toEqual({ ok: false, error: "Photo not found" });
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId: otherMediaId } })).toBe(0);
  });

  it("refuses more marks than a photo may carry", async () => {
    const many = Array.from({ length: 25 }, (_, i) => arrow({ x1: i / 100 }));
    const refused = await saveJobMediaAnnotations(mediaId, many);
    expect(refused.ok).toBe(false);
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId } })).toBe(0);
  });

  it("records who drew them", async () => {
    await saveJobMediaAnnotations(mediaId, [arrow()]);
    const row = await prisma.jobMediaAnnotation.findFirstOrThrow({ where: { mediaId } });
    expect(row.createdByUserId).toBe(ownerUserId);
  });

  // The marks are the point of showing the photo, so they go to the GC —
  // but nothing ABOUT them does.
  it("carries the marks to the portal, and no author or timestamp with them", async () => {
    await saveJobMediaAnnotations(mediaId, [arrow(), { kind: "MEASURE", x1: 0.1, y1: 0.8, x2: 0.9, y2: 0.8, label: "12 ft" }]);
    await prisma.jobMedia.update({
      where: { id: mediaId },
      data: { sharedWithClientAt: new Date(), sharedWithClientByUserId: ownerUserId },
    });

    const [photo] = await loadSharedJobMediaForClient({ jobId, companyId, take: 10 }, "UTC");
    expect(photo.marks).toHaveLength(2);
    expect(photo.marks.find((m) => m.kind === "MEASURE")?.label).toBe("12 ft");

    const serialised = JSON.stringify(photo);
    expect(serialised).not.toContain(ownerUserId);
    expect(serialised).not.toContain("createdAt");
    expect(Object.keys(photo.marks[0]).sort()).toEqual(["id", "kind", "label", "x1", "x2", "y1", "y2"]);
  });

  // THE CASCADE, asked of the database rather than read off the schema.
  // #227 and #228 were both a child that blocked its parent's delete while
  // the static guard stayed green; this is the same question asked the way
  // that cannot be fooled by SQL formatting.
  it("goes with the photo when the photo is deleted, rather than blocking it", async () => {
    const media = await prisma.jobMedia.create({
      data: {
        companyId,
        jobId,
        blobUrl: `https://public.blob.vercel-storage.com/job-media/${jobId}/doomed.jpg`,
        contentType: "image/jpeg",
        byteSize: 1024,
        capturedAt: new Date("2026-09-10T13:00:00.000Z"),
      },
    });
    await saveJobMediaAnnotations(media.id, [arrow()]);
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId: media.id } })).toBe(1);

    // Not blocked, and it takes the marks with it.
    await prisma.jobMedia.delete({ where: { id: media.id } });
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId: media.id } })).toBe(0);
  });

  it("refuses somebody without the field capability", async () => {
    // ACCOUNTING is one of the two functions BY_FUNCTION does not give
    // MANAGE_FIELD to, which is what makes it the right one to test with:
    // FIELD holds MANAGE_JOBS as well, so gating on that would have
    // excluded nobody on the crew (the guard #214 nearly shipped).
    // MEMBER, not OWNER. `capabilitiesFor` rule 1 is that an OWNER holds
    // everything and no job function reduces it — so an OWNER/ACCOUNTING
    // context tests nothing at all, which is exactly what this case did on
    // its first two runs before the mock was fixed.
    context = { id: ownerUserId, companyId, email: OWNER, role: "MEMBER", jobFunction: "ACCOUNTING" };
    const refused = await saveJobMediaAnnotations(mediaId, [arrow()]);
    expect(refused.ok).toBe(false);
    expect(await prisma.jobMediaAnnotation.count({ where: { mediaId } })).toBe(0);
  });
});
