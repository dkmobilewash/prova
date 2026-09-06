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

function job(status = "ESTIMATE") {
  return {
    status,
    name: "Tower B",
    scope: null,
    company: { name: "Ours Drywall" },
    contact: { name: "Pat GC", email: "pat@gc.test" },
    lineItems: [],
  };
}

async function render(token = "tok") {
  return renderToStaticMarkup(await EsignPage({ params: Promise.resolve({ token }) }));
}

beforeEach(() => {
  request = null;
});

describe("the date on a signed contract", () => {
  it("is the UTC calendar day, and says so", async () => {
    // 2026-09-05 18:30 in California is 2026-09-06 01:30 UTC. Rendered
    // without a timeZone this was the server's day and the app never said
    // which day it meant.
    request = {
      status: "SIGNED",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      signerName: "Pat GC",
      signedAt: new Date("2026-09-06T01:30:00.000Z"),
      snapshot: SNAPSHOT,
      job: job(),
    };

    const html = await render();

    expect(html).toContain("Sep 6, 2026");
    expect(html, "the zone has to be on screen for the date to be checkable").toContain("(UTC)");
  });

  it("does not drift with the machine's own timezone", async () => {
    const original = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    try {
      request = {
        status: "SIGNED",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        signerName: "Pat GC",
        signedAt: new Date("2026-09-06T01:30:00.000Z"),
        snapshot: SNAPSHOT,
        job: job(),
      };
      expect(await render()).toContain("Sep 6, 2026");
    } finally {
      process.env.TZ = original;
    }
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
