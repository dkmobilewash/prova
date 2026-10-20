import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /safety after the declutter pass (density audit #31): each incident's
 * description opens on click, and toolbox talks show the latest 10 with
 * See all — they were a silent `take: 50` with every one inline.
 */

const talk = (n: number) => ({
  id: `t-${n}`,
  heldOn: new Date(`2026-09-${String(n).padStart(2, "0")}T00:00:00Z`),
  topic: `Talk ${n}`,
  presenter: null,
  attendees: null,
  notes: null,
  job: null,
  recordedBy: null,
});
const TALKS = Array.from({ length: 12 }, (_, i) => talk(i + 1));
const incident = (n: number) => ({
  id: `i-${n}`,
  caseYear: 2026,
  caseNumber: n,
  occurredAt: new Date("2026-09-03T00:00:00Z"),
  jobId: null,
  job: null,
  employeeName: n === 1 ? "Luis Ortega" : `Worker ${n}`,
  jobTitle: null,
  location: null,
  description: n === 1 ? "Cut on the left hand from a utility knife." : `Incident ${n}.`,
  classification: "INJURY",
  outcome: n % 4 === 0 ? "DAYS_AWAY" : "FIRST_AID",
  daysAway: n % 4 === 0 ? 2 : null,
  daysRestricted: null,
  reportedBy: null,
});
let INCIDENTS = [incident(1)];
const takes: (number | undefined)[] = [];

vi.mock("@prova/db", () => ({
  prisma: {
    safetyIncident: {
      findMany: vi.fn(async (args: { distinct?: unknown }) =>
        args.distinct
          ? [{ caseYear: 2026 }]
          : INCIDENTS,
      ),
    },
    job: { findMany: vi.fn(async () => []) },
    toolboxTalk: {
      findMany: vi.fn(async ({ take }: { take?: number }) => {
        takes.push(take);
        return TALKS.slice(0, take ?? TALKS.length);
      }),
      count: vi.fn(async () => TALKS.length),
    },
  },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context: { company: { id: "co-1" }, id: "u-1", role: "OWNER" } })),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/safety", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

const { default: SafetyPage } = await import("@/app/(app)/safety/page");
const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await SafetyPage({ searchParams: Promise.resolve(sp) }));

describe("/safety", () => {
  it("opens an incident's description on click", async () => {
    const html = await render();
    expect(html).toMatch(
      /<details class="[^"]*mt-1"><summary[^>]*>What happened<\/summary><div[^>]*><p[^>]*>Cut on the left hand from a utility knife\.<\/p>/,
    );
  });

  it("shows the latest 10 toolbox talks, with See all", async () => {
    takes.length = 0;
    const html = await render({ year: "2026" });
    expect(takes).toEqual([10]);
    expect(html).toContain(">Talk 10<");
    expect(html).not.toContain(">Talk 11<");
    expect(html).toMatch(/href="\?year=2026&amp;all=1#talks"[^>]*>See all 12</);
  });

  it("shows every talk on ?all=1", async () => {
    takes.length = 0;
    const html = await render({ all: "1" });
    expect(takes).toEqual([undefined]);
    expect(html).toContain(">Talk 12<");
    expect(html).toMatch(/href="\?#talks"[^>]*>Show the latest 10</);
  });

  it("shows the latest 10 incidents with See all, while the status line counts EVERY case", async () => {
    INCIDENTS = Array.from({ length: 12 }, (_, i) => incident(12 - i));
    try {
      const html = await render({ year: "2026" });
      const rows = html.match(/>What happened</g) ?? [];
      expect(rows).toHaveLength(10);
      expect(html).toContain("Incident 3.");
      expect(html).not.toContain("Incident 2.");
      expect(html).toMatch(/href="\?year=2026&amp;all=1#incidents"[^>]*>See all 12</);
      // Counts read off all 12, not the 10 rendered: 3 of them (4, 8, 12)
      // are days-away cases.
      expect(html).toContain("12 cases logged for 2026: 3 recordable on the 300 log, 3 with days away.");

      const all = await render({ all: "1" });
      expect(all.match(/>What happened</g) ?? []).toHaveLength(12);
      expect(all).toMatch(/href="\?#incidents"[^>]*>Show the latest 10</);
    } finally {
      INCIDENTS = [incident(1)];
    }
  });
});
