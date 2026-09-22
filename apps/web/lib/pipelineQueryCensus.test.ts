import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * WHAT /pipeline ASKS THE DATABASE FOR, COUNTED, BECAUSE A NUMBER IN A
 * COMMENT ROTS AND A NUMBER IN A TEST DOES NOT.
 *
 * The complaint this file was written from: saving on /pipeline feels slow,
 * "the whole page is rebuilt on the server after every save". That is true
 * and it is not this page's doing — a Server Action that calls
 * revalidatePath re-renders the route from the ROOT (CLAUDE.md, issue #61:
 * "action flight is always a root render"), so the (app) layout's own
 * loaders run again too. Counted on 2026-09-22 with a counting Prisma
 * proxy, one job seeded so the per-job child reads fire:
 *
 *   | what                                   | Prisma client calls |
 *   | -------------------------------------- | ------------------- |
 *   | layout: countVisibleAlerts             | 24                  |
 *   | layout: getMoneyRailStages             | 14                  |
 *   | layout: loadCompanyFinancials          |  9                  |
 *   | PAGE: the three loaders below          |  3                  |
 *
 * (The layout's three overlap — `loadActiveJobCostRows`,
 * `renewalSourcesForCompany`, `loadRetainageHeld` and
 * `loadFringeSchedulesByCraft` are `cache()`d, so a real render issues
 * fewer than 47. The page's three do not overlap with anything.)
 *
 * So the page is about a fifteenth of the work its own save triggers, and
 * the useful thing this file can do is keep it that way. It fails the build
 * when /pipeline grows a loader nobody has accounted for, or when one of
 * the three starts issuing more than one query.
 *
 * THE SCOPE IS DERIVED FROM THE PAGE, NOT LISTED HERE, and that is
 * deliberate — CLAUDE.md's theme-contrast entry is about a census with the
 * right pattern and the wrong scope, which no size assertion could see.
 * The page source is the only thing that cannot drift from what the page
 * loads. The parse is then size-asserted both ways: a pattern that matches
 * nothing fails loudly rather than passing an empty set downstream, and a
 * loader on the page with no entry in COST below fails by name.
 */

const PAGE = join(__dirname, "..", "app", "(app)", "pipeline", "page.tsx");

/** Every loader /pipeline calls, and where it lives. A new one on the page
 * fails the test below until it is added here — which is the moment to look
 * at what it costs. */
const COST: Record<string, { module: string; calls: number }> = {
  loadBidPipeline: { module: "./bid-pipeline-query", calls: 1 },
  loadBidPursuits: { module: "./bid-pursuits-query", calls: 1 },
  loadLinkableInvitations: { module: "./bid-pursuits-query", calls: 1 },
};

/** Every prisma call the loader made, with the argument it sent. */
const calls: Array<{ model: string; op: string; where: unknown }> = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: new Proxy(
    {},
    {
      get(_target, model: string) {
        if (model === "then") return undefined;
        return new Proxy(
          {},
          {
            get(_t, op: string) {
              return async (args: { where?: unknown } = {}) => {
                calls.push({ model, op, where: args?.where });
                return op === "count" ? 0 : [];
              };
            },
          },
        );
      },
    },
  ),
}));

describe("/pipeline's own database cost", () => {
  const source = readFileSync(PAGE, "utf8");

  it("read the page it is counting", () => {
    // The scope assertion. Everything below reasons about a set parsed out
    // of this string; an empty or missing file would make every assertion
    // vacuously true.
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("export default async function PipelinePage");
  });

  /** The loaders the page actually calls, from its own source. */
  const called = [...source.matchAll(/\b(load[A-Z]\w*)\(/g)].map((match) => match[1]);

  it("finds the loaders on the page, and every one of them is accounted for", () => {
    // A regex matching nothing is the failure mode this repo has shipped
    // twice (scratch-cleanup-order, theme-contrast). Say so out loud.
    expect(called.length).toBeGreaterThan(0);
    expect([...new Set(called)].sort()).toEqual(Object.keys(COST).sort());
  });

  it("issues one query per loader, and every one is scoped to the company", async () => {
    let total = 0;
    for (const [name, expected] of Object.entries(COST)) {
      const loaded = (await import(expected.module)) as Record<
        string,
        (companyId: string, today: string) => Promise<unknown>
      >;
      calls.length = 0;
      await loaded[name]("company-1", "2026-09-22");
      expect(calls, `${name} issues ${calls.length} queries, not ${expected.calls}`).toHaveLength(
        expected.calls,
      );
      for (const call of calls) {
        expect(
          (call.where as { companyId?: string } | undefined)?.companyId,
          `${name} -> ${call.model}.${call.op} is not scoped to a company`,
        ).toBe("company-1");
      }
      total += calls.length;
    }
    // The headline number, so the table in this file's header cannot quietly
    // stop being true.
    expect(total).toBe(3);
  });
});
