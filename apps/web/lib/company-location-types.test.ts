import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCATION_TYPES } from "./actions/shared";

/**
 * `LOCATION_TYPES` is a second copy of the Prisma `LocationType` enum, and
 * this codebase cites it BY NAME, in four separate files, as its example of
 * a second copy of an enum drifting from the original. It was drifting the
 * whole time: the enum had four members and this list had three.
 *
 * The cost was not cosmetic. The settings form offers every member of the
 * enum, so "Trailer" was selectable; `enumFromForm` refused it; and the
 * throw happens BEFORE the insert, so the entire typed-in address was lost
 * on submit. A jobsite trailer is the location a specialty sub is most
 * likely to add.
 *
 * So the list stops being maintained by hand. This reads the enum out of
 * the schema file — which is what the database enforces — and requires the
 * two to be the same set.
 *
 * IT ALSO COUNTS WHAT IT PARSED, against a member this file names
 * literally. A regex over a schema is exactly the guard shape CLAUDE.md
 * warns about: matching nothing returns an empty set, and an empty set is
 * never missing anything, so every comparison below it would pass. A parse
 * that finds no enum is a failure here, not a pass.
 */

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schemaFile = join(repoRoot, "packages/db/prisma/schema/operations.prisma");

function locationTypeEnumMembers(): string[] {
  const schema = readFileSync(schemaFile, "utf8");
  // `\s+` rather than a literal space or newline: the formatting of the
  // schema is not something this test should be able to break on.
  const block = schema.match(/enum\s+LocationType\s*\{([^}]*)\}/);
  if (!block) throw new Error(`No "enum LocationType" block found in ${schemaFile}`);
  return block[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0);
}

describe("LOCATION_TYPES against the Prisma enum", () => {
  it("parses a non-empty enum that contains a member named here literally", () => {
    // The anti-vacuity assertion. Without it, a pattern that matched
    // nothing would satisfy every other test in this file.
    const members = locationTypeEnumMembers();
    expect(members.length).toBeGreaterThanOrEqual(4);
    expect(members).toContain("TRAILER");
  });

  it("accepts exactly what the database accepts, no more and no less", () => {
    // Sorted: this is about membership, and the order of a validator list
    // is not something the database has an opinion about.
    expect([...LOCATION_TYPES].sort()).toEqual([...locationTypeEnumMembers()].sort());
  });

  it("accepts TRAILER, the value that used to throw away a typed address", () => {
    expect(LOCATION_TYPES).toContain("TRAILER");
  });
});

describe("the settings dropdown offers nothing the action will refuse", () => {
  /**
   * The other half of the same bug, and the half a schema comparison cannot
   * see: the form's own option list is a THIRD copy. It is what the user
   * clicks, so an option missing from `LOCATION_TYPES` is a submit that
   * throws — which is how this was found.
   */
  const settingsPage = fileURLToPath(new URL("../app/(app)/settings/page.tsx", import.meta.url));

  function dropdownValues(): string[] {
    const source = readFileSync(settingsPage, "utf8");
    const block = source.match(/const LOCATION_TYPE_OPTIONS = \[([\s\S]*?)\] as const;/);
    if (!block) throw new Error("No LOCATION_TYPE_OPTIONS array found on the settings page");
    return [...block[1].matchAll(/value:\s*"([A-Z_]+)"/g)].map((match) => match[1]);
  }

  it("finds the option list at all, and more than one option in it", () => {
    expect(dropdownValues().length).toBeGreaterThanOrEqual(4);
  });

  it("offers only values the create action will accept", () => {
    for (const value of dropdownValues()) {
      expect(LOCATION_TYPES).toContain(value);
    }
  });
});
