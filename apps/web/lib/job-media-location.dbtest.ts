import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * WHERE a site capture was taken: what gets written, what gets refused, and
 * — the half that matters most — what the GC does NOT get.
 *
 * `.dbtest.ts` and not a unit test, because four of the claims this feature
 * makes are claims about things a pure test structurally cannot see:
 *
 *  - THE PORTAL BOUNDARY. `PortalJobPhoto` does not carry coordinates and
 *    `loadSharedJobMediaForClient`'s `select` does not fetch them. The
 *    assertion below is on the SERIALISED result — the digits of a real
 *    coordinate must not appear anywhere in what the portal returns —
 *    because the type is what a future edit changes on its way to breaking
 *    this, and only a real row proves the query.
 *  - THE TWO CHECK CONSTRAINTS. `JobMedia_captured_location_pairing` and
 *    `JobMedia_captured_location_range` live in the migration and nowhere
 *    else. Typecheck, lint and every unit test are perfectly happy with a
 *    half-written location; Postgres is not, and this is the only place
 *    that can watch it refuse.
 *  - THE `located` FILTER, both ways, including the falsy-boolean trap that
 *    `shared` already has a scar from: `located: false` composed the obvious
 *    way disappears, and the "No location" chip then renders the entire
 *    gallery while looking perfectly correct.
 *  - THE ACTION'S REFUSALS, which have to leave NO ROW behind. A record call
 *    that rejects a coordinate and writes the photo anyway would be a much
 *    worse bug than one that fails.
 *
 * Run against a SCRATCH database — it creates and deletes companies:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.mts
 */

/** The signed-in person, swapped per case — same shape
 * `requireCompanyContext` returns. `jobFunction`, not `role`, is what drives
 * a capability; an OWNER holds every one of them regardless, which is why
 * the refusal case below sets both. */
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

/** `recordJobMedia` requires the URL to come from OUR store, and derives
 * which store that is from the credentials the app holds. Set before the
 * module is imported so the action sees it — `blobStoreId` reads
 * `process.env` per call, but a test that set this later would be relying on
 * that and would break silently if it were ever hoisted. */
const STORE_ID = "dbtestlocationstore";
process.env.BLOB_STORE_ID = STORE_ID;

const { recordJobMedia } = await import("./actions/jobMedia");
const { countJobMedia, loadJobMedia, loadSharedJobMediaForClient } = await import(
  "./job-media-query"
);

const ZONE = "America/Los_Angeles";
const at = (iso: string) => new Date(`${iso}Z`);

let companyId = "";
let ownerUserId = "";
let jobId = "";

/** A real fix, seven decimals, exactly as a phone reports one. Its rounded
 * form is what must be stored. */
const RAW_LAT = 36.1699412;
const RAW_LNG = -115.1398261;
const ROUNDED_LAT = 36.16994;
const ROUNDED_LNG = -115.13983;

function blobUrl(name: string) {
  return `https://${STORE_ID}.public.blob.vercel-storage.com/job-media/${jobId}/${name}.jpg`;
}

/** A record call with whatever location fields the case wants. `capturedAt`
 * is always sent explicitly so no case depends on the clock. */
function recordForm(
  name: string,
  fields: Partial<Record<"latitude" | "longitude" | "accuracyMeters" | "capturedAt", string>> = {},
) {
  const formData = new FormData();
  formData.set("blobUrl", blobUrl(name));
  formData.set("contentType", "image/jpeg");
  formData.set("byteSize", "204800");
  formData.set("caption", name);
  formData.set("capturedAt", fields.capturedAt ?? at("2026-09-11T17:00:00.000").toISOString());
  for (const key of ["latitude", "longitude", "accuracyMeters"] as const) {
    if (fields[key] !== undefined) formData.set(key, fields[key] as string);
  }
  return formData;
}

/** Rows written directly, for the read-side cases — the action is exercised
 * separately above them. */
function seed(
  name: string,
  capturedAt: string,
  location: { lat: number; lng: number; accuracy: number | null } | null,
) {
  return prisma.jobMedia.create({
    data: {
      companyId,
      jobId,
      blobUrl: blobUrl(name),
      contentType: "image/jpeg",
      byteSize: 1024,
      caption: name,
      capturedAt: at(capturedAt),
      capturedByUserId: ownerUserId,
      capturedLatitude: location?.lat ?? null,
      capturedLongitude: location?.lng ?? null,
      capturedAccuracyMeters: location?.accuracy ?? null,
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

describe("where a site capture was taken", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Locating Drywall Co" } });
    companyId = company.id;
    const owner = await prisma.user.create({
      data: {
        companyId,
        clerkId: `loc-owner-${Date.now()}`,
        email: `loc-owner-${Date.now()}@example.test`,
        name: "Marisol Vega",
        role: "OWNER",
      },
    });
    ownerUserId = owner.id;
    const gc = await prisma.contact.create({
      data: { companyId, name: "Turner GC", portalToken: `tok-loc-${Date.now()}` },
    });
    const job = await prisma.job.create({
      data: { companyId, contactId: gc.id, name: "Riverside Tower", status: "IN_PROGRESS" },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.jobMedia.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    asOwner();
    // EVERY CASE STARTS FROM AN EMPTY GALLERY. This suite's read-side cases
    // assert on exact id lists and on a count partition, so a row surviving
    // one case changes the answer in the next — and a dbtest leaking rows
    // into later tests is a scar this repo already has.
    await prisma.jobMedia.deleteMany({ where: { jobId } });
  });

  /* ---------------------------------------------------------------- *
   * Recording it
   * ---------------------------------------------------------------- */

  it("stores a fix, rounded to five decimals, with its accuracy", async () => {
    expect(
      await recordJobMedia(
        jobId,
        recordForm("located", {
          latitude: String(RAW_LAT),
          longitude: String(RAW_LNG),
          accuracyMeters: "8.5",
        }),
      ),
    ).toEqual({ ok: true });

    const row = await prisma.jobMedia.findFirstOrThrow({ where: { jobId } });
    // The SEVEN-decimal value never reaches the database. Rounding happens
    // once, in the pure parser, so the stored value is the displayed value.
    expect(row.capturedLatitude).toBe(ROUNDED_LAT);
    expect(row.capturedLongitude).toBe(ROUNDED_LNG);
    // The accuracy is NOT rounded — it is already an estimate.
    expect(row.capturedAccuracyMeters).toBe(8.5);
  });

  it("records a capture with no location at all as a completely ordinary row", async () => {
    // The normal case, and the one this whole feature is written around: a
    // desktop upload, a denied permission, a photo older than an hour. It
    // must record exactly like any other, with no error and no marker.
    expect(await recordJobMedia(jobId, recordForm("unlocated"))).toEqual({ ok: true });

    const row = await prisma.jobMedia.findFirstOrThrow({ where: { jobId } });
    expect(row.capturedLatitude).toBeNull();
    expect(row.capturedLongitude).toBeNull();
    expect(row.capturedAccuracyMeters).toBeNull();
    expect(row.caption).toBe("unlocated");
  });

  it("takes a fix whose accuracy the browser did not report", async () => {
    expect(
      await recordJobMedia(
        jobId,
        recordForm("no-accuracy", { latitude: "36.5", longitude: "-115.5" }),
      ),
    ).toEqual({ ok: true });
    const row = await prisma.jobMedia.findFirstOrThrow({ where: { jobId } });
    expect(row.capturedLatitude).toBe(36.5);
    expect(row.capturedAccuracyMeters).toBeNull();
  });

  it("refuses a coordinate that is not on Earth, and writes NO row", async () => {
    // The refusal is the small half. The important half is that the photo
    // is not recorded either: a record call that drops the bad coordinate
    // and keeps the row would hide a broken writer forever, and one that
    // keeps the row AND the coordinate would put an impossible latitude in
    // front of a person.
    const result = await recordJobMedia(
      jobId,
      recordForm("impossible", { latitude: "91", longitude: "0" }),
    );
    expect(result).toEqual({ ok: false, error: "That latitude is not on Earth" });
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(0);
  });

  it("refuses half a fix rather than filing it as unlocated", async () => {
    const result = await recordJobMedia(jobId, recordForm("half", { latitude: "36.5" }));
    expect(result).toEqual({
      ok: false,
      error: "A location needs both a latitude and a longitude",
    });
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(0);
  });

  it("refuses an accuracy of zero, which is a claim no positioning system makes", async () => {
    const result = await recordJobMedia(
      jobId,
      recordForm("certain", { latitude: "36.5", longitude: "-115.5", accuracyMeters: "0" }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/positive number of metres/);
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(0);
  });

  it("refuses somebody whose job function does not include MANAGE_FIELD", async () => {
    // ACCOUNTING holds MANAGE_BILLING, VIEW_COMPANY_FINANCIALS and
    // VIEW_JOB_COSTS, and nothing to do with the field. `role` is MEMBER
    // here because an OWNER holds every capability regardless of
    // jobFunction — a case that left role as OWNER would pass while
    // proving nothing, which two annotation tests did.
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";

    const result = await recordJobMedia(
      jobId,
      recordForm("nope", { latitude: String(RAW_LAT), longitude: String(RAW_LNG) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/part of your job function/);
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(0);
  });

  it("lets a FIELD member record one — the control the refusal above needs", async () => {
    // Without this, an action that refused everybody would satisfy the case
    // above perfectly.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";

    expect(
      await recordJobMedia(
        jobId,
        recordForm("field-crew", { latitude: String(RAW_LAT), longitude: String(RAW_LNG) }),
      ),
    ).toEqual({ ok: true });
    const row = await prisma.jobMedia.findFirstOrThrow({ where: { jobId } });
    expect(row.capturedLatitude).toBe(ROUNDED_LAT);
  });

  /* ---------------------------------------------------------------- *
   * The database's own last line
   * ---------------------------------------------------------------- */

  it("refuses half a location at the DATABASE, not only in the action", async () => {
    // The action is one writer. This constraint is what holds when the next
    // one forgets — a script, a seed, a future action. Prisma has no idea
    // this constraint exists; only a real Postgres can say so.
    await expect(
      prisma.jobMedia.create({
        data: {
          companyId,
          jobId,
          blobUrl: blobUrl("db-half"),
          contentType: "image/jpeg",
          byteSize: 1024,
          capturedAt: at("2026-09-11T17:00:00.000"),
          capturedLatitude: 36.5,
        },
      }),
    ).rejects.toThrow(/JobMedia_captured_location_pairing/);
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(0);
  });

  it("refuses an accuracy with no coordinates at the database", async () => {
    // A radius with no centre. Same constraint, the other half of it.
    await expect(
      prisma.jobMedia.create({
        data: {
          companyId,
          jobId,
          blobUrl: blobUrl("db-radius"),
          contentType: "image/jpeg",
          byteSize: 1024,
          capturedAt: at("2026-09-11T17:00:00.000"),
          capturedAccuracyMeters: 8,
        },
      }),
    ).rejects.toThrow(/JobMedia_captured_location_pairing/);
  });

  it("refuses an off-Earth coordinate at the database", async () => {
    await expect(
      prisma.jobMedia.create({
        data: {
          companyId,
          jobId,
          blobUrl: blobUrl("db-range"),
          contentType: "image/jpeg",
          byteSize: 1024,
          capturedAt: at("2026-09-11T17:00:00.000"),
          capturedLatitude: 91,
          capturedLongitude: 0,
        },
      }),
    ).rejects.toThrow(/JobMedia_captured_location_range/);
  });

  it("accepts the poles and the antimeridian, which ARE on Earth", async () => {
    // The control the three refusals need. A constraint written with `<`
    // instead of `<=` refuses these and nothing would ever notice.
    const row = await prisma.jobMedia.create({
      data: {
        companyId,
        jobId,
        blobUrl: blobUrl("db-edge"),
        contentType: "image/jpeg",
        byteSize: 1024,
        capturedAt: at("2026-09-11T17:00:00.000"),
        capturedLatitude: -90,
        capturedLongitude: 180,
        capturedAccuracyMeters: 1,
      },
    });
    expect(row.capturedLatitude).toBe(-90);
  });

  /* ---------------------------------------------------------------- *
   * Reading it back
   * ---------------------------------------------------------------- */

  it("gives the card everything it renders, derived from the stored numbers", async () => {
    await seed("located", "2026-09-11T17:00:00.000", { lat: ROUNDED_LAT, lng: ROUNDED_LNG, accuracy: 8 });
    const [card] = await loadJobMedia({ companyId, jobId }, ZONE);

    expect(card.location).toEqual({
      coordinateLabel: "36.16994, -115.13983",
      accuracyLabel: "±8 m",
      coarseNote: null,
      mapHref:
        "https://www.openstreetmap.org/?mlat=36.16994&mlon=-115.13983#map=18/36.16994/-115.13983",
    });
  });

  it("gives an unlocated capture a null location, not a placeholder", async () => {
    await seed("unlocated", "2026-09-11T17:00:00.000", null);
    const [card] = await loadJobMedia({ companyId, jobId }, ZONE);
    expect(card.location).toBeNull();
  });

  it("says so when the stored accuracy is too wide to be a spot", async () => {
    // THE REASON THE ACCURACY COLUMN EXISTS. An IP-derived fix and a GPS one
    // are the same shape of number once stored; only the radius beside them
    // tells them apart, and only at read time — the threshold is a judgement
    // that may change, so nothing about it is written down in a row.
    await seed("coarse", "2026-09-11T17:00:00.000", { lat: 36.2, lng: -115.2, accuracy: 2400 });
    const [card] = await loadJobMedia({ companyId, jobId }, ZONE);
    expect(card.location?.accuracyLabel).toBe("±2.4 km");
    expect(card.location?.coarseNote).toMatch(/area, not the spot/);
  });

  it("filters the gallery both ways, and `false` is not dropped", async () => {
    // THE FALSY-BOOLEAN TRAP, executed. `located: false` composed the
    // obvious way — `...(filter.located ? … : {})` — disappears, and the
    // "No location" chip then renders the whole gallery while looking
    // entirely correct.
    const here = await seed("here", "2026-09-11T17:00:00.000", {
      lat: ROUNDED_LAT,
      lng: ROUNDED_LNG,
      accuracy: 8,
    });
    const nowhere = await seed("nowhere", "2026-09-11T16:00:00.000", null);

    const yes = await loadJobMedia({ companyId, jobId, located: true }, ZONE);
    const no = await loadJobMedia({ companyId, jobId, located: false }, ZONE);
    const all = await loadJobMedia({ companyId, jobId }, ZONE);

    expect(yes.map((m) => m.id)).toEqual([here.id]);
    expect(no.map((m) => m.id)).toEqual([nowhere.id]);
    expect(all.map((m) => m.id).sort()).toEqual([here.id, nowhere.id].sort());
  });

  it("counts the same population the list shows, on every value of the filter", async () => {
    // The count feeds "showing the 60 most recent of N" and is a separate
    // query. A filter added to the list and forgotten on the count states a
    // number that is not about the photos underneath it.
    await seed("here", "2026-09-11T17:00:00.000", { lat: 36.1, lng: -115.1, accuracy: 8 });
    await seed("nowhere", "2026-09-11T16:00:00.000", null);

    const [yes, no, all] = await Promise.all([
      countJobMedia({ companyId, jobId, located: true }),
      countJobMedia({ companyId, jobId, located: false }),
      countJobMedia({ companyId, jobId }),
    ]);
    expect(yes).toBe(1);
    expect(no).toBe(1);
    // The partition property, which is the durable form of it.
    expect(yes + no).toBe(all);
  });

  it("composes with the client-visibility filter rather than replacing it", async () => {
    // "What have we shown this GC, of the ones we know the position of" is
    // the compound question the chips exist to answer, and AND is the only
    // reading of it that is not dangerous.
    const shared = await seed("shared-located", "2026-09-11T17:00:00.000", {
      lat: 36.1,
      lng: -115.1,
      accuracy: 8,
    });
    await prisma.jobMedia.update({
      where: { id: shared.id },
      data: { sharedWithClientAt: at("2026-09-11T18:00:00.000"), sharedWithClientByUserId: ownerUserId },
    });
    await seed("internal-located", "2026-09-11T16:00:00.000", {
      lat: 36.2,
      lng: -115.2,
      accuracy: 8,
    });

    expect(
      (await loadJobMedia({ companyId, jobId, located: true, shared: true }, ZONE)).map((m) => m.id),
    ).toEqual([shared.id]);
    // Located but NOT shared is the other one — under an OR this would
    // return both.
    expect(
      (await loadJobMedia({ companyId, jobId, located: true, shared: false }, ZONE)).length,
    ).toBe(1);
    // And nothing at all is both unlocated and shared.
    expect(await countJobMedia({ companyId, jobId, located: false, shared: true })).toBe(0);
  });

  /* ---------------------------------------------------------------- *
   * The portal boundary — the decision this feature is judged on
   * ---------------------------------------------------------------- */

  it("never sends a coordinate to the GC, on a photo the sub deliberately shared", async () => {
    // THE CASE THIS FILE EXISTS FOR. Not "the type has no field" — that is
    // what a future edit changes on its way to breaking this — but that the
    // DIGITS of a real stored coordinate appear nowhere in what the portal
    // hands over, on a photo that IS shared, which is the only photo the
    // question is about.
    const shared = await seed("shared-located", "2026-09-11T17:00:00.000", {
      lat: ROUNDED_LAT,
      lng: ROUNDED_LNG,
      accuracy: 8,
    });
    await prisma.jobMedia.update({
      where: { id: shared.id },
      data: { sharedWithClientAt: at("2026-09-11T18:00:00.000"), sharedWithClientByUserId: ownerUserId },
    });

    const photos = await loadSharedJobMediaForClient({ jobId, companyId, take: 60 }, ZONE);
    expect(photos.map((p) => p.id)).toEqual([shared.id]);

    const serialised = JSON.stringify(photos);
    expect(serialised).not.toContain("36.16994");
    expect(serialised).not.toContain("115.13983");
    expect(serialised).not.toContain("capturedLatitude");
    expect(serialised).not.toContain("capturedLongitude");
    expect(serialised).not.toContain("capturedAccuracyMeters");

    // AND THE KEY LIST IS UNCHANGED. This is the assertion that fails the
    // day somebody widens the projection — it has gone red twice before, for
    // `kind` and for `marks`, and both times the list was widened by exactly
    // one field rather than relaxed into something that would not notice the
    // next one. Location is not on it and the reasoning is on the `select`
    // in job-media-query.ts.
    expect(Object.keys(photos[0]).sort()).toEqual([
      "blobUrl",
      "caption",
      "capturedAtLabel",
      "id",
      "kind",
      "marks",
    ]);
  });

  it("still shows the GC the photo itself — the control the exclusion needs", async () => {
    // Without this, a portal read that returned nothing at all would satisfy
    // the case above perfectly.
    const shared = await seed("shared-located", "2026-09-11T17:00:00.000", {
      lat: ROUNDED_LAT,
      lng: ROUNDED_LNG,
      accuracy: 8,
    });
    await prisma.jobMedia.update({
      where: { id: shared.id },
      data: { sharedWithClientAt: at("2026-09-11T18:00:00.000") },
    });

    const photos = await loadSharedJobMediaForClient({ jobId, companyId, take: 60 }, ZONE);
    expect(photos[0].caption).toBe("shared-located");
    expect(photos[0].blobUrl).toContain("job-media");
    expect(photos[0].kind).toBe("photo");
  });
});
