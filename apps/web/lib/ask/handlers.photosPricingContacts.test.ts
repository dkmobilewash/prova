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

/**
 * Quotes, arranged so the MOVEMENT figure has something to find and three
 * ways to get it wrong.
 *
 * `5/8 Type X` is quoted twice by Allied in SF — June 0.62, September 0.71 —
 * so there is a real +14.5% rise. `Westside` also quotes it, in SF, ONCE, and
 * `Allied` quotes it a third time in MSF: a movement measured across vendors
 * is a difference of opinion and one measured across units is arithmetic on
 * unrelated numbers, so neither may produce a figure.
 */
const QUOTES = [
  {
    // Valid until August. Today is September — expired. Still counts as price
    // HISTORY: a price that lapsed is still where the price WAS.
    id: "q-typex-jun",
    description: "5/8 Type X",
    unit: "SF",
    unitPrice: 0.62,
    quotedOn: new Date("2026-06-01T00:00:00.000Z"),
    validUntil: new Date("2026-08-31T00:00:00.000Z"),
    source: "QUOTE",
    notes: null,
    catalogEntryId: "cat-typex",
    vendor: { id: "v-allied", name: "Allied Building Products" },
  },
  {
    // The same vendor, the same item, the same unit, three months later.
    id: "q-typex-sep",
    description: "5/8 Type X 4x12",
    unit: "SF",
    unitPrice: 0.71,
    quotedOn: new Date("2026-09-12T00:00:00.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
    source: "QUOTE",
    notes: null,
    // Linked to the SAME catalog item under different wording, which is why
    // the page groups on the catalog id where there is one.
    catalogEntryId: "cat-typex",
    vendor: { id: "v-allied", name: "Allied Building Products" },
  },
  {
    // Another vendor's only quote for the item. No movement of their own, and
    // never a movement against Allied's.
    id: "q-typex-westside",
    description: "5/8 Type X",
    unit: "SF",
    unitPrice: 0.68,
    quotedOn: new Date("2026-09-14T00:00:00.000Z"),
    validUntil: new Date("2026-11-30T00:00:00.000Z"),
    source: "PRICE_LIST",
    notes: null,
    catalogEntryId: "cat-typex",
    vendor: { id: "v-westside", name: "Westside Supply" },
  },
  {
    // Allied again, same item, DIFFERENT UNIT. Per MSF against per SF is the
    // 1000x error this must never make.
    id: "q-typex-msf",
    description: "5/8 Type X",
    unit: "MSF",
    unitPrice: 710,
    // BETWEEN the two SF quotes on purpose. Newest, it would become the
    // movement's own end and there would be nothing to compare; oldest, a
    // handler ignoring the unit would still land on the June SF quote and the
    // fixture would prove nothing. In the middle, ignoring the unit compares
    // $0.71/SF against $710/MSF and reports a 99.9% collapse.
    quotedOn: new Date("2026-08-01T00:00:00.000Z"),
    validUntil: null,
    source: "QUOTE",
    notes: null,
    catalogEntryId: "cat-typex",
    vendor: { id: "v-allied", name: "Allied Building Products" },
  },
  {
    id: "q-stud",
    description: "3-5/8 25ga stud",
    unit: "EA",
    unitPrice: 4.1,
    quotedOn: new Date("2026-09-10T00:00:00.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
    source: "QUOTE",
    notes: null,
    catalogEntryId: null,
    vendor: { id: "v-allied", name: "Allied Building Products" },
  },
  {
    // No terms recorded. NOT valid indefinitely.
    id: "q-sealant",
    description: "Acoustic sealant",
    unit: "TUBE",
    unitPrice: 7.85,
    quotedOn: new Date("2026-05-02T00:00:00.000Z"),
    validUntil: null,
    source: "VERBAL",
    notes: null,
    catalogEntryId: null,
    vendor: { id: "v-westside", name: "Westside Supply" },
  },
  {
    // The same vendor and item quoted twice at the SAME price. The page hides
    // a zero movement; this tool keeps it, because "they quoted the same
    // $7.85 twice" answers "has their price gone up" and returning nothing
    // reads as "we don't track that".
    id: "q-sealant-later",
    description: "Acoustic sealant",
    unit: "TUBE",
    unitPrice: 7.85,
    quotedOn: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: null,
    source: "VERBAL",
    notes: null,
    catalogEntryId: null,
    vendor: { id: "v-westside", name: "Westside Supply" },
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
      quotes: 7,
      expired: 1,
      withoutAValidityDate: 3,
      priceMovements: 2,
      pricesUp: 1,
      pricesDown: 0,
    });
  });

  /* ── the movement figure the box was told to refuse ──────────────────── */

  type Row = {
    material: string;
    vendor: string | null;
    unit: string | null;
    quotedOn: string | null;
    priceChange: {
      direction: "up" | "down" | "unchanged";
      changePercent: number;
      fromUnitPrice: number;
      fromQuotedOn: string;
    } | null;
  };

  it("RETURNS the price movement, which KNOWN_GAPS told the model to refuse", async () => {
    // THE FINDING. tools.ts carried a gap entry reading "a vendor's recent
    // price change: the catalog records what work has cost, not a vendor's
    // price list over time", and job_margin's description said "there is no
    // vendor price history". KNOWN_GAPS is injected into the system prompt, so
    // those were standing INSTRUCTIONS to refuse a question /vendors/pricing
    // answers on screen under "Movement" — `priceMovement()` has computed it
    // all along.
    const rows = (await ask("vendor_pricing")).data as Row[];
    const september = rows.find((row) => row.quotedOn === "2026-09-12")!;
    expect(september.priceChange).toEqual({
      direction: "up",
      // (0.71 - 0.62) / 0.62, one decimal — the figure the page renders, not
      // one the model works out from two prices.
      changePercent: 14.5,
      fromUnitPrice: 0.62,
      fromQuotedOn: "2026-06-01",
    });
  });

  it("never measures a movement across UNITS", async () => {
    // Allied quoted the same item per MSF in August, between the two SF
    // quotes. Comparing $0.71/SF against $710/MSF would report a 99.9%
    // collapse on a screen people bid from.
    const rows = (await ask("vendor_pricing")).data as Row[];
    expect(rows.find((row) => row.quotedOn === "2026-09-12")!.priceChange!.changePercent).toBe(14.5);
    // And the MSF quote itself has no movement: it is Allied's only one in
    // that unit.
    expect(rows.find((row) => row.unit === "MSF")!.priceChange).toBeNull();
  });

  it("never measures a movement across VENDORS", async () => {
    // Westside quoted the same item once, at $0.68. Against Allied's $0.71
    // that is a difference of opinion, not a price change.
    const rows = (await ask("vendor_pricing")).data as Row[];
    expect(rows.find((row) => row.vendor === "Westside Supply" && row.material === "5/8 Type X")!.priceChange).toBeNull();
  });

  it("reports a price that did NOT move, which the page has nothing to show for", async () => {
    // The one place this tool and the page differ, deliberately: "they quoted
    // the same $7.85 in May and again in September" is an answer to "has their
    // price gone up", and returning nothing there reads as "we don't track
    // that" — which is the whole defect being fixed.
    const rows = (await ask("vendor_pricing")).data as Row[];
    expect(rows.find((row) => row.quotedOn === "2026-09-01")!.priceChange).toMatchObject({
      direction: "unchanged",
      changePercent: 0,
    });
  });

  it("puts the movement on the NEWER quote and leaves the superseded one null", async () => {
    // Otherwise the same rise would be reported twice, once from each end.
    const rows = (await ask("vendor_pricing")).data as Row[];
    expect(rows.find((row) => row.quotedOn === "2026-06-01")!.priceChange).toBeNull();
  });

  it("groups by the CATALOG item, so different wording for one thing still lines up", async () => {
    // The September quote is worded "5/8 Type X 4x12" and the June one
    // "5/8 Type X". Grouping on the wording would find no movement at all —
    // and a movement the page shows and the box denies is the worse failure.
    const rows = (await ask("vendor_pricing")).data as Row[];
    expect(rows.find((row) => row.quotedOn === "2026-09-12")!.material).toBe("5/8 Type X 4x12");
    expect(rows.find((row) => row.quotedOn === "2026-09-12")!.priceChange).not.toBeNull();
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
