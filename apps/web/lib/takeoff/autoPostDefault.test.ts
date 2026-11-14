import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Diego, 2026-11-14: walls auto-post on 417 ft of held-out evidence, so NO company gets it unasked.
// The column has been false by default since it was added; signup used to switch it on for every new
// company. Now nothing does but the owner's own switch.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("auto-post is off until the owner turns it on", () => {
  it("is false by default in the schema, and the migration that added it says so", () => {
    expect(read("../../../../packages/db/prisma/schema/company.prisma")).toMatch(/autoPostOn\s+Boolean\s+@default\(false\)/);
    expect(read("../../../../packages/db/prisma/schema/migrations/20261110120000_add_company_auto_post/migration.sql")).toMatch(/"autoPostOn" BOOLEAN NOT NULL DEFAULT false/);
  });

  it("a new company is created without it, beside the switches it does start with", () => {
    const auth = read("../auth.ts");
    const create = /create: \{ name: companyName,[^\n]*\}/.exec(auth)?.[0] ?? "";
    expect(create, "the signup create line is found").toContain("planCompareOn: true");
    expect(create).not.toContain("autoPostOn");
    // Nothing else in the app turns it on: the owner's settings action is the one writer.
    expect(read("../actions/planCompare.ts")).toMatch(/ownerRefusal\(context, "Only the account owner[\s\S]{0,500}data: \{ autoPostOn: on \}/);
  });

  it("the owner's switch says what it does and that it is off until turned on", () => {
    const sw = read("../../components/AutoPostSwitch.tsx");
    expect(sw).toContain("disabled={!isOwner}");
    expect(sw).toMatch(/off until you turn it on/);
    expect(sw).not.toMatch(/nothing posts yet/);
  });
});
