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
const takes: (number | undefined)[] = [];

vi.mock("@prova/db", () => ({
  prisma: {
    safetyIncident: {
      findMany: vi.fn(async (args: { distinct?: unknown }) =>
        args.distinct
          ? [{ caseYear: 2026 }]
          : [
              {
                id: "i-1",
                caseYear: 2026,
                caseNumber: 1,
                occurredAt: new Date("2026-09-03T00:00:00Z"),
                jobId: null,
                job: null,
                employeeName: "Luis Ortega",
                jobTitle: null,
                location: null,
                description: "Cut on the left hand from a utility knife.",
                classification: "INJURY",
                outcome: "FIRST_AID",
                daysAway: null,
                daysRestricted: null,
                reportedBy: null,
              },
            ],
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
});
