import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Diego, 2026-11-14: doors keep auto-posting for new companies; WALLS get their own switch, off for
// every company (existing and new) until an owner turns it on, while walls stand on 417 ft held-out.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("walls auto-post has its own switch, off for everyone", () => {
  it("the column is false by default, added by its own migration, and no backfill turns anyone on", () => {
    expect(read("../../../../packages/db/prisma/schema/company.prisma")).toMatch(/autoPostWalls\s+Boolean\s+@default\(false\)/);
    const sql = read("../../../../packages/db/prisma/schema/migrations/20261114203000_add_company_auto_post_walls/migration.sql");
    expect(sql).toMatch(/ADD COLUMN "autoPostWalls" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).not.toMatch(/UPDATE/i);
  });

  it("signup keeps doors ON and never turns walls on", () => {
    const create = /create: \{ name: companyName,[^\n]*\}/.exec(read("../auth.ts"))?.[0] ?? "";
    expect(create).toContain("autoPostOn: true");
    expect(create).not.toContain("autoPostWalls");
  });

  it("walls read the walls switch; doors read the door switch", () => {
    expect(read("../plan-ingest/wallItems.ts")).toMatch(/select: \{ autoPostWalls: true \} \}\)\)\?\.autoPostWalls === true/);
    expect(read("../plan-ingest/wallItems.ts")).not.toMatch(/select: \{ autoPostOn: true \}/);
    expect(read("../plan-ingest/autoDoors.ts")).toMatch(/select: \{ autoPostOn: true \}/);
  });

  it("settings shows both switches, owner-only, one line each, and saves both", () => {
    const sw = read("../../components/AutoPostSwitch.tsx");
    expect(sw).toMatch(/\["autoPostOn", on, "Auto-post marked doors", "[^"]+"\]/);
    expect(sw).toMatch(/\["autoPostWalls", walls, "Auto-post walls", "[^"]+"\]/);
    expect(sw).toContain("disabled={!isOwner}");
    expect(read("../actions/planCompare.ts")).toMatch(/ownerRefusal[\s\S]{0,500}data: \{ autoPostOn: on, autoPostWalls: walls \}/);
    expect(read("../../app/(app)/settings/page.tsx")).toContain("walls={switches?.autoPostWalls ?? false}");
  });
});
