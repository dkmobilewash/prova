import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for the three pages that used to show a FIELD user
 * cost and margin.
 *
 * Being honest about what this proves: it is a STATIC check that each page
 * still consults `can()` and still references the flags the guards are
 * written against. It does not render anything and cannot tell you a guard
 * wraps the right section. What it does catch is the realistic regression
 * — somebody refactoring one of these files and dropping the import or the
 * flag, which would silently restore the hole with every test still green.
 *
 * The behaviour itself is proven in lib/permissions.test.ts (the map) and
 * lib/actions/permissions.dbtest.ts (the column). The click-list is what
 * proves the sections.
 */

const PAGES: { path: string; flags: string[] }[] = [
  { path: "app/(app)/dashboard/page.tsx", flags: ["showsJobMoney", "showsBilling"] },
  { path: "app/(app)/contacts/[id]/page.tsx", flags: ["showsJobMoney", "showsBilling", "showsEstimating"] },
];

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("pages that render job money", () => {
  for (const page of PAGES) {
    describe(page.path, () => {
      const source = read(page.path);

      it("consults the capability map", () => {
        expect(source).toContain('from "@/lib/permissions"');
        expect(source).toMatch(/\bcan\(/);
      });

      it("derives its flags from the signed-in person, not from a role string", () => {
        // `currentUser.role === "OWNER"` is the pattern this feature
        // replaces: it answers "can they administer", not "may they see
        // the money", and using it here would give a MEMBER-tier foreman
        // everything.
        expect(source).toContain("jobFunction: currentUser.jobFunction");
        for (const flag of page.flags) {
          expect(source).toContain(flag);
        }
      });
    });
  }

  it("withholds the receivables ROWS, not just the list markup", () => {
    // ReceivablesProvider is a client component: anything handed to it
    // reaches the browser whether or not a list renders it. Hiding the
    // panel while still shipping the rows is the "looks enforced, isn't"
    // failure this whole pass exists to close.
    const source = read("app/(app)/dashboard/page.tsx");
    expect(source).toContain("rows={showsBilling ? today.receivables : []}");
  });
});

describe("the job page's tabs (rebuilt 2026-09-20 out of one monolith)", () => {
  // `jobs/[id]/page.tsx` used to derive showsJobMoney/showsBilling once and
  // pass it to every section on one page. That page is now eight routes —
  // app/(app)/jobs/[id]/(tabs)/{page,estimate,crew,compliance,billing,
  // retainage,field-reports,photos}.tsx plus their shared layout — so the
  // single-file check above cannot apply to it. What replaces it: the
  // derivation itself lives in exactly ONE place now (lib/jobs/job-access.ts),
  // and every route that shows money either reads its flags from there or
  // calls requireCapability directly (permissions.test.ts already proves
  // each of those routes enforces the right one) — never from a role string.
  const derivation = read("lib/jobs/job-access.ts");

  it("derives every job-page money flag from the capability map, not a role string, in one place", () => {
    expect(derivation).toContain('from "@/lib/permissions"');
    expect(derivation).toMatch(/\bcan\(/);
    expect(derivation).toContain("jobFunction: currentUser.jobFunction");
  });

  // Estimate, Billing and Retainage SOFT-withhold (a flag, like Overview)
  // rather than hard-gate: lib/action-capability-guards.test.ts found their
  // Server Actions are not independently guarded on the capability, so a
  // requireCapability wall would claim a boundary the action layer does
  // not enforce — see each page's own doc comment. permissions.test.ts
  // records the same call in OPEN_ROUTES.
  const OPEN_TABS = [
    { path: "app/(app)/jobs/[id]/(tabs)/layout.tsx", flags: ["showsJobMoney", "showsBilling"] },
    { path: "app/(app)/jobs/[id]/(tabs)/page.tsx", flags: ["showsJobMoney"] },
    { path: "app/(app)/jobs/[id]/(tabs)/estimate/page.tsx", flags: ["showsJobMoney"] },
    { path: "app/(app)/jobs/[id]/(tabs)/billing/page.tsx", flags: ["showsBilling"] },
    { path: "app/(app)/jobs/[id]/(tabs)/retainage/page.tsx", flags: ["showsBilling"] },
  ];

  for (const tab of OPEN_TABS) {
    it(`${tab.path} reads its money flags from the shared derivation`, () => {
      const source = read(tab.path);
      expect(source).toMatch(/from "@\/lib\/jobs\/job-access"/);
      for (const flag of tab.flags) expect(source).toContain(flag);
    });
  }

  // Photos is the one tab that IS entirely one capability's content AND
  // can be hard-gated safely — its job-media actions are independently
  // guarded already (also reachable from the already-guarded top-level
  // /photos). permissions.test.ts proves it calls requireCapability with
  // the right capability and renders <NoAccess>; this asserts the piece
  // that guard belongs to — lib/authz's requireCapability, never a role
  // check standing in for it.
  it("app/(app)/jobs/[id]/(tabs)/photos/page.tsx gates on the capability map via requireCapability", () => {
    const source = read("app/(app)/jobs/[id]/(tabs)/photos/page.tsx");
    expect(source).toMatch(/from "@\/lib\/authz"/);
    expect(source).toMatch(/requireCapability\(/);
  });
});

describe("the app layout's Money Rail figures", () => {
  // The Sidebar is a client component: anything handed to it is serialized
  // to the browser for every principal, whether or not it is painted. The
  // 2026-09-19 audit found the five company-wide dollar figures reaching a
  // FIELD user's rail; the layout now loads them only for a principal who
  // holds VIEW_COMPANY_FINANCIALS, same as MetricBar ten lines below.
  const source = read("app/(app)/layout.tsx");

  it("loads the stages only behind VIEW_COMPANY_FINANCIALS", () => {
    // The gated call may be settled with shellQueryFailed (a rail query that
    // throws costs the rail its figures, not the page — components/
    // ShellRegion.tsx) and nothing else: the gate is still the ternary.
    expect(source).toMatch(
      /can\(principal, "VIEW_COMPANY_FINANCIALS"\)\s*\? getMoneyRailStages\(company\.id\)(?:\s*\.catch\(shellQueryFailed\("sidebar", \[\]\)\))?\s*: Promise\.resolve\(\[\]\)/,
    );
  });

  it("never calls getMoneyRailStages ungated", () => {
    const calls = source.match(/getMoneyRailStages\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
