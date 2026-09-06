import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The signing page, rendered — because both defects here are things a
 * reader SEES, and neither is visible in a type or a query.
 *
 * One is a date. `signedAt.toLocaleDateString()` with no `timeZone` renders
 * the SERVER's calendar day, and the server is Vercel, which is UTC. A
 * contract signed at 6pm in California was therefore dated tomorrow — on
 * the single date a dispute about this document would turn on.
 *
 * The other is a sentence. The footnote under the table said the table
 * showed "the current agreed scope and pricing", forty lines below a banner
 * saying it showed what was agreed AT SIGNING. Both on screen at once, about
 * a legal document, contradicting each other.
 *
 * These render the real page and assert on the real markup, so a
 * regression in either shows up as the words changing rather than as a
 * silently-dropped option.
 */

const notFoundError = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
  useRouter: () => ({ refresh: () => {} }),
}));

type Row = Record<string, unknown>;

let request: Row | null = null;

// The page pulls in the whole actions barrel (through EsignForm), and
// lib/change-order.ts constructs a `Prisma.Decimal` at MODULE scope. Nothing
// under test does arithmetic with one, so the stub only has to be
// constructible — but it has to exist, or the import of the page fails
// before a single assertion runs.
vi.mock("@prova/db", () => ({
  prisma: { signatureRequest: { findUnique: async () => request } },
  Prisma: { Decimal: class { constructor(readonly value: unknown) {} } },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vercel/blob", () => ({ put: async () => ({ url: "x" }), del: async () => {} }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ id: "usr_1", role: "OWNER", company: { id: "cmp_1" } }),
}));
vi.mock("@prova/integrations", () => ({
  revokeToken: async () => {},
  refreshTokens: async () => {},
  getCompanyInfo: async () => ({}),
  generateWipNarrative: async () => "",
  extractComplianceDocument: async () => ({}),
}));

const { default: EsignPage } = await import("../app/esign/[token]/page");

const SNAPSHOT = {
  companyName: "Ours Drywall",
  jobName: "Tower B",
  clientName: "Pat GC",
  scope: null,
  total: 125,
  lineItems: [{ description: "Framing", quantity: "10", unit: "SF", unitPrice: "12.50" }],
};

/**
 * The LIVE job behind the request — deliberately not the same numbers as
 * SNAPSHOT above.
 *
 * The job is re-priced after signing in almost every real dispute: a change
 * order lands, a line is re-measured, someone corrects a unit price. If the
 * live rows and the frozen ones carry the same figures in a test, then a
 * signed page rendering the WRONG one of the two is invisible — which is
 * how the fixture used to be (`lineItems: []`) and why nothing noticed.
 */
function job(status = "ESTIMATE") {
  return {
    status,
    name: "Tower B",
    scope: null,
    company: { name: "Ours Drywall" },
    contact: { name: "Pat GC", email: "pat@gc.test" },
    lineItems: [
      {
        id: "li_live",
        description: "Framing — RE-PRICED AFTER SIGNING",
        quantity: "10",
        unit: "SF",
        unitPrice: "99.00",
        isDeleted: false,
      },
    ],
  };
}

async function render(token = "tok") {
  return renderToStaticMarkup(await EsignPage({ params: Promise.resolve({ token }) }));
}

beforeEach(() => {
  request = null;
});

/**
 * Renders under a named timezone, and PROVES the zone actually took effect.
 *
 * Setting `process.env.TZ` mid-process does move `toLocaleDateString`, but
 * silently does nothing if the platform has already cached a zone — and a
 * timezone test whose timezone did not change is a test that passes for the
 * wrong reason. The assertion inside the guard is the whole point: it fails
 * loudly rather than letting the case below assert against the machine's own
 * zone while claiming to assert against Kiritimati.
 */
async function renderUnderTimezone(zone: string) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    expect(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `this test is worthless unless the process really moved to ${zone}`,
    ).toBe(zone);
    return await render();
  } finally {
    process.env.TZ = original;
  }
}

describe("the date on a signed contract", () => {
  function signedAt(instant: string) {
    request = {
      status: "SIGNED",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      signerName: "Pat GC",
      signedAt: new Date(instant),
      snapshot: SNAPSHOT,
      job: job(),
    };
  }

  it("is the UTC calendar day, and says so", async () => {
    // 2026-09-05 18:30 in California is 2026-09-06 01:30 UTC. Rendered
    // without a timeZone this was the server's day and the app never said
    // which day it meant.
    //
    // The zone is PINNED rather than inherited. Read on a machine set to
    // UTC — which is what CI is — an inherited zone makes the local day and
    // the UTC day identical, and this test would pass with the `timeZone`
    // option deleted. Honolulu is UTC-10, so the local day here is Sep 5 and
    // the assertion below can only hold if the render says UTC.
    signedAt("2026-09-06T01:30:00.000Z");

    const html = await renderUnderTimezone("Pacific/Honolulu");

    expect(html).toContain("Sep 6, 2026");
    expect(html, "the zone has to be on screen for the date to be checkable").toContain("(UTC)");
  });

  it("does not drift with the machine's own timezone", async () => {
    // Both sides of UTC, each with an instant whose LOCAL calendar day is
    // the wrong one, so neither case can be satisfied by the machine's zone
    // happening to agree with UTC.
    //
    // The previous version of this test asserted "Sep 6, 2026" for
    // 01:30 UTC under Kiritimati (UTC+14), where the local day is ALSO
    // Sep 6 — so it held whether or not the render passed `timeZone`. It
    // could not fail. That is the defect issue #150 is about, and it is why
    // the instants below are chosen per zone rather than shared.
    signedAt("2026-09-06T01:30:00.000Z"); // UTC day Sep 6, Honolulu day Sep 5
    expect(await renderUnderTimezone("Pacific/Honolulu")).toContain("Sep 6, 2026");

    signedAt("2026-09-05T23:30:00.000Z"); // UTC day Sep 5, Kiritimati day Sep 6
    expect(await renderUnderTimezone("Pacific/Kiritimati")).toContain("Sep 5, 2026");
  });
});

/**
 * The signed page renders the SNAPSHOT. Nothing may recompute it.
 *
 * `SignatureRequest.snapshot` is a value copy of the company, job and line
 * items taken at the instant of signing — written in one place, read in one
 * place. It is the evidence of what was agreed, and the whole reason the
 * column exists.
 *
 * This is the test that was MISSING, and the gap was demonstrated rather
 * than assumed: swapping `snapshot.lineItems` for `request.job.lineItems` on
 * the signed branch left every test in this repo green. A diff making that
 * swap reads as a tidy-up — one identifier, removing an apparent duplicate,
 * "keeping the contract in step with the job" — and it would silently
 * replace a legal record with whatever the numbers are today. The line items
 * are the part of the snapshot a dispute is actually about, so they are what
 * this pins.
 */
describe("what the signed page renders", () => {
  it("shows the frozen snapshot, never the job's current line items", async () => {
    request = {
      status: "SIGNED",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      signerName: "Pat GC",
      signedAt: new Date("2026-09-06T01:30:00.000Z"),
      snapshot: SNAPSHOT,
      // The job has since been re-priced from 12.50 to 99.00 — see `job()`.
      job: job(),
    };

    const html = await render();

    expect(html, "the signed page must render the price that was agreed").toContain("12.50");
    expect(
      html,
      "a price set after signing must never appear on the signed contract",
    ).not.toContain("99.00");
    expect(html).not.toContain("RE-PRICED AFTER SIGNING");
  });
});

describe("what the footnote claims the table is", () => {
  it("calls a signed snapshot frozen, not current", async () => {
    request = {
      status: "SIGNED",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      signerName: "Pat GC",
      signedAt: new Date("2026-09-06T01:30:00.000Z"),
      snapshot: SNAPSHOT,
      job: job(),
    };

    const html = await render();

    expect(html).toContain("exactly as it stood when this contract was signed");
    expect(
      html,
      "the page must not tell a GC a frozen snapshot is the current agreed pricing",
    ).not.toContain("the current agreed scope and pricing");
  });

  it("still calls the LIVE contract current, on the unsigned page", async () => {
    request = { status: "PENDING", createdAt: new Date(), snapshot: null, job: job() };

    const html = await render();

    expect(html).toContain("the current agreed scope and pricing");
  });
});

describe("a link that is no longer live", () => {
  it("explains itself instead of 404ing", async () => {
    request = {
      status: "PENDING",
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      snapshot: null,
      job: job(),
    };

    const html = await render();

    expect(html).toContain("no longer live");
    expect(html, "an expired link must not still render a signable form").not.toContain(
      "Sign to accept",
    );
  });

  it("does not offer to sign a job that is already under contract", async () => {
    request = { status: "PENDING", createdAt: new Date(), snapshot: null, job: job("CONTRACTED") };

    const html = await render();

    expect(html).not.toContain("Sign to accept");
  });

  it("404s a token that never existed, saying nothing about it", async () => {
    request = null;
    await expect(render("invented")).rejects.toThrow(notFoundError);
  });
});
