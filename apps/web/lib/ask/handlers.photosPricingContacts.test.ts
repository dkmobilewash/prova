import { describe, expect, it, vi } from "vitest";

/**
 * job_photos, vendor_pricing and gc_relationship.
 *
 * The recurring rule in this batch is that a missing date is reported as
 * missing and never as good news:
 *
 *   - a vendor quote with no validity date is not a price that stands
 *     forever; it is a quote nobody wrote terms on;
 *   - an MSA with no expiry recorded is not an MSA in force;
 *   - and a photo's date is when it was TAKEN, not when somebody uploaded
 *     it, because a dispute turns on the first and they can be weeks apart.
 */

const TODAY = "2026-09-17";

const MEDIA = [
  {
    // Taken in August; not shared with the GC until LATE SEPTEMBER —
    // deliberately AFTER the newest capture below, so that a handler
    // reporting any date other than capturedAt produces a different answer
    // and the test can see it. The first version of this fixture had the
    // share date in August too, which made the assertion below vacuous: a
    // mutation swapping capturedAt for the share date passed every test.
    capturedAt: new Date("2026-08-14T00:00:00.000Z"),
    caption: "Head-of-wall detail, level 2",
    sharedWithClientAt: new Date("2026-09-20T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    capturedAt: new Date("2026-09-15T00:00:00.000Z"),
    caption: null,
    sharedWithClientAt: null,
    job: { name: "Riverside Medical" },
  },
  {
    // Whitespace caption — not a caption.
    capturedAt: new Date("2026-09-02T00:00:00.000Z"),
    caption: "   ",
    sharedWithClientAt: null,
    job: { name: "Northgate Apartments" },
  },
];

const QUOTES = [
  {
    // Valid until August. Today is September — expired.
    description: "5/8 Type X",
    unit: "SF",
    unitPrice: 0.62,
    quotedOn: new Date("2026-06-01T00:00:00.000Z"),
    validUntil: new Date("2026-08-31T00:00:00.000Z"),
    vendor: { name: "Allied Building Products" },
  },
  {
    description: "3-5/8 25ga stud",
    unit: "EA",
    unitPrice: 4.1,
    quotedOn: new Date("2026-09-10T00:00:00.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
    vendor: { name: "Allied Building Products" },
  },
  {
    // No terms recorded. NOT valid indefinitely.
    description: "Acoustic sealant",
    unit: "TUBE",
    unitPrice: 7.85,
    quotedOn: new Date("2026-05-02T00:00:00.000Z"),
    validUntil: null,
    vendor: { name: "Westside Supply" },
  },
];

const CONTACTS = [
  {
    // MSA lapsed in March. The sentence somebody repeats before finding out.
    name: "Turner Construction",
    msaExpirationDate: new Date("2026-03-01T00:00:00.000Z"),
    prequalificationExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    portalToken: "tok-1",
    portalRevokedAt: null,
  },
  {
    name: "Brackett Construction",
    msaExpirationDate: new Date("2027-06-30T00:00:00.000Z"),
    prequalificationExpiresAt: null,
    portalToken: "tok-2",
    portalRevokedAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  {
    name: "Halvorsen Builders",
    msaExpirationDate: null,
    prequalificationExpiresAt: null,
    portalToken: null,
    portalRevokedAt: null,
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    jobMedia: { findMany: async () => MEDIA },
    vendorPriceQuote: { findMany: async () => QUOTES },
    contact: { findMany: async () => CONTACTS },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return ["Riverside Medical", "Northgate Apartments"].some((n) => n.toLowerCase().includes(wanted))
          ? { id: "job-1" }
          : null;
      },
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("job_photos", () => {
  it("reports when the photo was TAKEN, not when it was shared or uploaded", async () => {
    // Riverside's newest CAPTURE is 15 Sep. One of its photos was shared on
    // 20 Sep, which is later — so any handler reading a date other than
    // capturedAt answers 2026-09-20 here and fails.
    const rows = (await ask("job_photos")).data as { job: string; latestCapturedOn: string | null }[];
    expect(rows.find((row) => row.job === "Riverside Medical")!.latestCapturedOn).toBe("2026-09-15");
  });

  it("groups per job with counts, and counts what is shared with the GC", async () => {
    const rows = (await ask("job_photos")).data as {
      job: string;
      captures: number;
      captioned: number;
      shared: number;
    }[];
    expect(rows.find((row) => row.job === "Riverside Medical")).toMatchObject({
      captures: 2,
      captioned: 1,
      shared: 1,
    });
  });

  it("does not count a whitespace caption as a caption", async () => {
    const rows = (await ask("job_photos")).data as { job: string; captioned: number }[];
    expect(rows.find((row) => row.job === "Northgate Apartments")!.captioned).toBe(0);
  });

  it("puts the most recently photographed job first", async () => {
    const rows = (await ask("job_photos")).data as { job: string }[];
    expect(rows[0].job).toBe("Riverside Medical");
  });
});

describe("vendor_pricing", () => {
  it("STATES that a quote is expired rather than leaving two dates to compare", async () => {
    // An expired quote carried into a bid is how a job gets mis-priced.
    const rows = (await ask("vendor_pricing")).data as { material: string; expired: boolean | null }[];
    expect(rows.find((row) => row.material === "5/8 Type X")!.expired).toBe(true);
    expect(rows.find((row) => row.material === "3-5/8 25ga stud")!.expired).toBe(false);
  });

  it("says null, not false, for a quote with no validity date", async () => {
    // "Not expired" would be a claim that the price still stands.
    const rows = (await ask("vendor_pricing")).data as { material: string; expired: boolean | null }[];
    expect(rows.find((row) => row.material === "Acoustic sealant")!.expired).toBeNull();
  });

  it("counts undated quotes apart from expired ones", async () => {
    // Different problems, different fixes: one is a stale price, the other
    // is a vendor who never gave terms.
    expect((await ask("vendor_pricing")).summary).toEqual({
      quotes: 3,
      expired: 1,
      withoutAValidityDate: 1,
    });
  });
});

describe("gc_relationship", () => {
  it("catches an MSA that lapsed", async () => {
    const rows = (await ask("gc_relationship")).data as { contact: string; msa: string }[];
    expect(rows.find((row) => row.contact === "Turner Construction")!.msa).toBe("expired");
  });

  it("reports an unrecorded date as unrecorded, never as current", async () => {
    const rows = (await ask("gc_relationship")).data as {
      contact: string;
      msa: string;
      prequalification: string;
    }[];
    const halvorsen = rows.find((row) => row.contact === "Halvorsen Builders")!;
    expect(halvorsen.msa).toBe("unrecorded");
    expect(halvorsen.prequalification).toBe("unrecorded");
    // And the one with an in-date MSA but no prequal date on file.
    expect(rows.find((row) => row.contact === "Brackett Construction")).toMatchObject({
      msa: "current",
      prequalification: "unrecorded",
    });
  });

  it("reports the portal link separately from the paperwork", async () => {
    // A live link is a thing somebody can still open, whatever the MSA says
    // — and Turner's MSA is expired while their link still works.
    const rows = (await ask("gc_relationship")).data as { contact: string; portalLink: string }[];
    expect(rows.find((row) => row.contact === "Turner Construction")!.portalLink).toBe("live");
    expect(rows.find((row) => row.contact === "Brackett Construction")!.portalLink).toBe("revoked");
    expect(rows.find((row) => row.contact === "Halvorsen Builders")!.portalLink).toBe("never issued");
  });

  it("counts what is expired and what is still open to the world", async () => {
    expect((await ask("gc_relationship")).summary).toEqual({
      contacts: 3,
      msaExpired: 1,
      prequalificationExpired: 0,
      livePortalLinks: 1,
    });
  });
});
