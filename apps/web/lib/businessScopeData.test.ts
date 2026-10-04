import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HIDEABLE_ROUTES } from "./businessScope";

/**
 * The census over lib/businessScopeData.ts — the data guard's probe list.
 *
 * WHAT THIS FILE IS FOR. The probe is the only place in this feature that
 * names a database table, and it names them in a STRING inside raw SQL, where
 * TypeScript cannot help. A renamed model would typecheck, lint, build, and
 * then throw inside the (app) layout on every authenticated page of every
 * company whose answers hide something. So the names are checked against the
 * Prisma schema files here, at build time, and the guard fails loudly on a
 * laptop instead of quietly in a shell.
 *
 * WHAT CLAUDE.MD'S CENSUS SCARS REQUIRE OF IT, all three, because this file
 * derives its input and is therefore in exactly the family that has gone
 * green while seeing nothing:
 *
 *   - SIZE. The schema parse asserts its own model count against a second
 *     expression that shares no regex with the first, so a pattern that stops
 *     matching fails with a number rather than passing every assertion
 *     downstream on an empty set.
 *   - SCOPE. The schema files are found by reading the directory rather than
 *     by a hand-kept list, and the directory is asserted non-empty — nothing
 *     is ever missing from a directory you do not walk.
 *   - THE SECOND LIST. `ROUTE_DATA_PROBE` and `ROUTE_HIDDEN_WHEN` are two
 *     lists of the same routes, so "is the list complete" is not enough:
 *     both directions are asserted, because a probe for a route that cannot
 *     be hidden is dead code and a hideable route with no probe is a route
 *     the guard silently cannot protect.
 *
 * The module imports `prisma`, whose client constructs at module load and
 * needs `DATABASE_URL`, so `@prova/db` is mocked here. Nothing in this file
 * runs a query; proving the SQL actually executes is
 * businessScopeData.dbtest.ts's job, against the scratch Postgres in CI.
 */

vi.mock("@prova/db", () => ({ prisma: {} }));

const { ROUTE_DATA_PROBE, probeSql, probedRoutes, unprobedHideableRoutes } = await import(
  "./businessScopeData"
);

const SCHEMA_DIR = path.resolve(__dirname, "../../../packages/db/prisma/schema");

/** Every `model X { … }` block in the multi-file schema, by name. */
function readSchemaModels(): { models: Map<string, string>; declaredCount: number; files: string[] } {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".prisma"));
  const models = new Map<string, string>();
  let declaredCount = 0;
  for (const file of files) {
    const text = readFileSync(path.join(SCHEMA_DIR, file), "utf8");
    // The SECOND expression, deliberately sharing no regex with the block
    // matcher below: a bare count of declaration lines. If the block parse
    // starts matching fewer (or nothing), the size test says so by number.
    declaredCount += text.split("\n").filter((line) => /^model\s+\w+\s*\{/.test(line)).length;
    for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      models.set(match[1], match[2]);
    }
  }
  return { models, declaredCount, files };
}

describe("the probe list is the hideable list — both directions", () => {
  it("has a probe for every route the answers can hide", () => {
    expect(HIDEABLE_ROUTES.length).toBeGreaterThan(0);
    expect(unprobedHideableRoutes()).toEqual([]);
    for (const href of HIDEABLE_ROUTES) expect(ROUTE_DATA_PROBE[href], href).toBeDefined();
  });

  it("has no probe for a route the answers can never hide", () => {
    // The direction a completeness test cannot see. A probe for a route that
    // is not in ROUTE_HIDDEN_WHEN is a query nobody reads — and if the route
    // was REMOVED from the map, the probe left behind is a table being
    // touched on every render for no reason at all.
    for (const href of probedRoutes()) expect(HIDEABLE_ROUTES, href).toContain(href);
    expect([...probedRoutes()].sort()).toEqual([...HIDEABLE_ROUTES].sort());
  });
});

describe("every probe names a real table and a real column", () => {
  const { models, declaredCount, files } = readSchemaModels();

  it("parsed the schema at all — the size and scope assertions", () => {
    // SCOPE: the directory is walked, not listed, and it has to have files
    // in it. A path that drifted would otherwise make every test below pass
    // over an empty map.
    expect(files.length).toBeGreaterThan(0);
    // SIZE: the block parse must find exactly as many models as there are
    // declaration lines, counted by an expression that shares nothing with
    // it. A block regex broken by a formatting change fails here with
    // "expected 0 to be 180" rather than shrinking the set in silence.
    expect(models.size).toBe(declaredCount);
    expect(models.size).toBeGreaterThan(0);
  });

  it("names a model that exists, with the column it filters on", () => {
    for (const [href, probe] of Object.entries(ROUTE_DATA_PROBE)) {
      const block = models.get(probe.table);
      expect(block, `${href} probes table ${probe.table}, which is not a model in the schema`).toBeDefined();
      expect(
        new RegExp(`^\\s*${probe.column}\\s+\\S`, "m").test(block as string),
        `${href} probes ${probe.table}.${probe.column}, which that model does not declare`,
      ).toBe(true);
    }
  });

  it("probes a company-scoped column, never a job-scoped one", () => {
    // The guard answers a question about a COMPANY. A probe filtered on
    // anything else would be asking whether some other tenant has data.
    for (const [href, probe] of Object.entries(ROUTE_DATA_PROBE)) {
      expect(probe.column, href).toBe("companyId");
    }
  });
});

describe("the SQL the probe actually sends", () => {
  const sql = probeSql();

  it("is ONE statement — the whole reason it is raw SQL rather than four findFirsts", () => {
    // connection_limit=5, and this layout renders concurrently with the page
    // beneath it. One statement is one pooled connection and one round trip;
    // four parallel probes would be four slots at the tightest moment.
    expect(sql.split(";").filter((part) => part.trim().length > 0)).toHaveLength(1);
    expect(sql.trim().startsWith("SELECT ")).toBe(true);
  });

  it("has one EXISTS per probed route, and nothing else", () => {
    expect(sql.match(/EXISTS \(SELECT 1 FROM/g) ?? []).toHaveLength(probedRoutes().length);
    for (const probe of Object.values(ROUTE_DATA_PROBE)) {
      expect(sql, probe.table).toContain(`FROM "${probe.table}" WHERE "${probe.column}" = $1`);
    }
  });

  it("binds the company id as a parameter and interpolates nothing else", () => {
    // `$queryRawUnsafe` is used because Prisma's tagged template cannot place
    // identifiers. The identifiers come from a module constant; the only
    // value in the statement is $1. Anything that looked like a literal here
    // would mean a request value had reached the SQL.
    expect(sql).toContain("$1");
    expect(sql.match(/\$\d+/g) ?? []).toEqual(new Array(probedRoutes().length).fill("$1"));
    expect(sql).not.toMatch(/'/);
  });

  it("aliases positionally, so no route path has to survive being an identifier", () => {
    probedRoutes().forEach((href, i) => {
      expect(sql).toContain(`AS "p${i}"`);
      expect(sql, href).not.toContain(href);
    });
  });
});
