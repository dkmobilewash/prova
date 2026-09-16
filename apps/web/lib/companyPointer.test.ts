/**
 * "Settings → Company" has to name somewhere that exists.
 *
 * THE SCAR. Five places in this app told a reader to go and fix the
 * company record at "Settings → Company" — two of them printed in RED on a
 * union trust-fund remittance sheet and on the WH-347 certified payroll
 * form, the two documents this company sends OUTSIDE itself. There was no
 * Company section on /settings, and `prisma.company.update` appeared
 * nowhere in `apps/web` at all: the instruction pointed at a page that did
 * not exist, to fix data the product could not capture. A dangling pointer
 * in prose fails silently and forever — nothing typechecks a sentence.
 *
 * So this file ties the two halves together. The pointer may be reworded
 * and the section may be renamed; they may not stop agreeing.
 *
 * THE SIZE CHECK COMES FIRST, for the reason
 * scratch-cleanup-order.test.ts had to learn the hard way: a scan that
 * matches nothing passes every assertion after it, because nothing is
 * missing from an empty list. Both floors below are literals a broken
 * walker cannot shrink with itself.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

/** The exact words the documents use. Kept as one literal so a reword has
 * to happen here too, which is where the agreement is checked. */
const POINTER = "Settings → Company";

/** The heading text on /settings the pointer names. */
const SECTION_HEADING = "Company";

const SETTINGS_PAGE = "app/(app)/settings/page.tsx";

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const top of ["app", "components", "lib"]) walk(join(webRoot, top));
  return out;
}

describe("the Settings → Company pointer", () => {
  const files = sourceFiles();

  it("scanned the app at all", () => {
    // 516 files on 2026-09-12. A floor, not a count — this is here so a
    // walker that returns nothing fails loudly instead of passing the two
    // checks below by seeing no pointers and no page.
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.endsWith(SETTINGS_PAGE.replace(/\//g, "/")))).toBe(true);
  });

  it("is used by the documents that need the company record", () => {
    const users = files.filter((f) => readFileSync(f, "utf8").includes(POINTER));
    // The remittance sheet's two reason sentences, the remittance page's own
    // two, and the WH-347 header. Five occurrences across three files; the
    // floor is three so a reworded sentence does not fail this, but deleting
    // the pointers rather than keeping them honest does.
    expect(
      users.length,
      `Nothing says "${POINTER}" any more — if the wording changed, change POINTER here too`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("names a section that exists on /settings, under that heading", () => {
    const page = readFileSync(join(webRoot, SETTINGS_PAGE), "utf8");
    const headings = [...page.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].trim());
    expect(
      headings,
      `/settings has no "${SECTION_HEADING}" heading, so every "${POINTER}" in this app is a ` +
        `dangling pointer. Its headings are: ${headings.join(", ")}`,
    ).toContain(SECTION_HEADING);
  });

  it("has a form on that section wired to the action that writes the record", () => {
    // The "written, documented, and never called" shape this repo keeps
    // producing: a form component and an action both exist and nothing
    // renders or calls them, and everything stays green.
    const page = readFileSync(join(webRoot, SETTINGS_PAGE), "utf8");
    expect(page).toContain("<CompanyProfileForm");

    const form = readFileSync(join(webRoot, "components/CompanyProfileForm.tsx"), "utf8");
    expect(form).toContain("updateCompanyProfile(formData)");

    const action = readFileSync(join(webRoot, "lib/actions/company.ts"), "utf8");
    expect(action).toContain("export async function updateCompanyProfile");
    // The whole point of the section: something in this app writes Company.
    expect(action).toContain("prisma.company.update");
  });
});
