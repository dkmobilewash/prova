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
  { path: "app/(app)/jobs/[id]/page.tsx", flags: ["showsJobMoney", "showsBilling"] },
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
