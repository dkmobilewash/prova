import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /certifications starts where the work starts.
 *
 * On a company with nothing set up, the page used to open on the record
 * form, then four tiles all reading 0, then "Require OSHA 10 below", and
 * only at the very bottom the section that copy was pointing at. So a new
 * owner read four zeros and a pointer to the last thing on the page before
 * reaching the one control that makes the page useful.
 *
 * Now, with no requirement AND no card on file, the requirements come
 * first, marked "Start here", and the tiles are not rendered. Every tile
 * is zero by construction in that state (`missing` needs a requirement,
 * the rest need a card), so hiding them hides nothing.
 *
 * The other half matters as much: a company with ANYTHING on file keeps
 * its tiles and its order. A requirement alone counts, and so does a card
 * alone, so each is rendered and must look exactly like the page it was.
 *
 * Rendered, not grepped: a grep cannot tell a branch that renders from one
 * that never runs. Every negative assertion sits beside a positive one
 * proving the page rendered at all.
 */

type Seed = Record<string, Record<string, unknown>>;
let seed: Seed = {};

const prismaStub = new Proxy(
  {},
  {
    get: (_t, model: string) =>
      new Proxy(
        {},
        {
          get: (_target, method: string) =>
            vi.fn(async () => {
              const seeded = seed[model]?.[method];
              if (seeded !== undefined) return seeded;
              if (method === "count") return 0;
              if (method === "findUnique" || method === "findFirst") return null;
              return [];
            }),
        },
      ),
  },
);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  role: "OWNER",
  jobFunction: null,
};

class DecimalStub {
  constructor(private readonly value: number | string) {}
  toString() {
    return String(this.value);
  }
}

vi.mock("@prova/db", () => ({ prisma: prismaStub, Prisma: { Decimal: DecimalStub } }));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context })),
}));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: vi.fn(async () => "2026-09-12"),
  viewerTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/certifications",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const OWNER_ROW = { id: "user-1", name: "Tester", email: "tester@example.com" };

const CARD = {
  id: "cert-1",
  companyId: "company-1",
  holderUserId: "user-1",
  kind: "OSHA_10",
  otherLabel: null,
  issuer: null,
  referenceNumber: null,
  issuedOn: new Date("2025-01-10T00:00:00.000Z"),
  expiresOn: null,
  notes: null,
  documentUrl: null,
  documentLabel: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

const REQUIREMENT = {
  id: "req-1",
  companyId: "company-1",
  kind: "OSHA_10",
  otherLabel: null,
  notes: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

async function load(): Promise<string> {
  const { default: Page } = await import("@/app/(app)/certifications/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

/** Where a `data-tour` anchor starts in the markup; -1 when absent. */
function at(html: string, anchor: string): number {
  return html.indexOf(`data-tour="${anchor}"`);
}

beforeEach(() => {
  seed = { user: { findMany: [OWNER_ROW] } };
});

describe("/certifications, nothing set up", () => {
  it("puts the requirements first, marked Start here, above the record form", async () => {
    const html = await load();
    // The page rendered: its own heading and the record form are there.
    expect(html).toContain(">Certifications</h1>");
    expect(at(html, "certifications-record")).toBeGreaterThan(-1);

    expect(html).toContain("data-start-here");
    expect(html).toContain(">Start here<");
    expect(at(html, "certifications-required")).toBeGreaterThan(-1);
    expect(at(html, "certifications-required")).toBeLessThan(at(html, "certifications-record"));
    // Rendered once, not once at the top AND once at the bottom.
    expect(html.match(/data-tour="certifications-required"/g)).toHaveLength(1);
  });

  it("renders no zero tiles", async () => {
    const html = await load();
    expect(at(html, "certifications-people")).toBeGreaterThan(-1);
    expect(at(html, "certifications-totals")).toBe(-1);
    expect(html).not.toContain("Required, nothing on file");
    expect(html).not.toContain("No expiry recorded");
  });

  it("points UP to the setup, never 'below' at a section that is now above it", async () => {
    const html = await load();
    expect(html).toContain("at the top of the page");
    expect(html).not.toContain("Require OSHA 10 below");
  });
});

describe("/certifications, an account with something on file keeps its page", () => {
  const cases: Array<{ name: string; setup: () => void }> = [
    { name: "a card on file, nothing required", setup: () => (seed.workerCertification = { findMany: [CARD] }) },
    {
      name: "a requirement, no card yet",
      setup: () => (seed.certificationRequirement = { findMany: [REQUIREMENT] }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: tiles render, requirements stay last, no Start here`, async () => {
      c.setup();
      const html = await load();
      expect(at(html, "certifications-totals")).toBeGreaterThan(-1);
      expect(html).toContain("Required, nothing on file");
      expect(html).not.toContain("data-start-here");
      expect(html).not.toContain(">Start here<");

      // The order it always had: record, totals, people, by job, required.
      const order = [
        "certifications-record",
        "certifications-totals",
        "certifications-people",
        "certifications-by-job",
        "certifications-required",
      ].map((anchor) => at(html, anchor));
      expect(order.every((position) => position > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  }

  it("a requirement nobody has met counts as missing, on the tile", async () => {
    seed.certificationRequirement = { findMany: [REQUIREMENT] };
    const html = await load();
    expect(html).toMatch(/>1<\/p><p[^>]*>Required, nothing on file</);
  });
});
