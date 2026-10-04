import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { HIDEABLE_ROUTES, isHiddenByBusinessScope, routesHiddenByAnswers } from "@/lib/businessScope";
import { ROUTE_DATA_PROBE, loadRoutesWithData, probeSql } from "@/lib/businessScopeData";

/**
 * The route-data probe against a real database.
 *
 * WHY THIS FILE HAS TO EXIST. The probe is one hand-written SQL statement.
 * The unit census (businessScopeData.test.ts) proves its shape and checks
 * every table and column against the Prisma schema files, which is most of
 * the risk — but it cannot prove that Postgres ACCEPTS the statement, that
 * `EXISTS` comes back as a JavaScript boolean rather than a string or a
 * bigint, or that the positional aliases line up with the routes they were
 * built from. A wrong answer there does not throw; it silently reports "no
 * data" for every route, which hides exactly the doors this guard exists to
 * keep open. That is the shape CLAUDE.md calls a check answering a question
 * nobody asked, so it gets a real database.
 *
 * It also pins the ORDER-INDEPENDENCE that the positional aliases depend on:
 * four rows are inserted one at a time, and after each insert the probe must
 * name exactly the routes inserted so far and no others. A statement whose
 * `p0`/`p1` aliases had drifted from `Object.keys(ROUTE_DATA_PROBE)` would
 * pass a test that only ever checked "all four" or "none".
 *
 * NOT RUN BY THIS SESSION — there is no Postgres in an agent container.
 * Written to the same shape as lib/actions/businessScope.dbtest.ts beside it
 * and left for CI's `test:db` job, which boots a scratch database and applies
 * the migrations before running it.
 */

let companyId = "";
let otherCompanyId = "";
let jobId = "";

/** One row per probed route, in the order the routes are declared. Each
 * creator writes the single record that makes its route "used". */
const INSERTERS: Record<string, () => Promise<unknown>> = {
  "/submittals": () =>
    prisma.submittal.create({
      data: { companyId, jobId, number: 1, title: "Acoustical ceiling grid — product data" },
    }),
  "/backcharges": () =>
    prisma.backcharge.create({
      data: {
        companyId,
        jobId,
        number: 1,
        category: "CLEANUP",
        description: "Final clean of level 3 corridor",
        claimedAmount: "1250.00",
        issuedOn: new Date("2026-09-01T00:00:00.000Z"),
      },
    }),
  "/prevailing-wage": () =>
    prisma.prevailingWageRuleSet.create({
      data: {
        companyId,
        name: "California state — DIR",
        jurisdiction: "California",
        authority: "STATE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    }),
  "/union-compliance": () =>
    prisma.unionLocal.create({
      data: {
        companyId,
        parentInternational: "OPCMIA",
        localNumber: "300",
        jurisdictionName: "Southern California",
      },
    }),
};

const OWNER_DIRECT_NO_PUBLIC = {
  contractingRelationship: "DIRECT_FOR_OWNERS" as const,
  doesPublicWork: false,
  filesMonthlyPayApps: false,
};

describe("the business-scope route-data probe, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Probe Test's Company" } });
    companyId = company.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "Probe GC" } });
    const job = await prisma.job.create({
      data: { companyId, contactId: contact.id, name: "Probe job" },
    });
    jobId = job.id;

    // A SECOND COMPANY, populated with every probed record. The probe filters
    // on companyId and nothing checks that but this: a statement that had
    // lost its WHERE clause would report data for a brand-new tenant, which
    // would un-hide every route for every company and look like the feature
    // simply not working.
    const other = await prisma.company.create({ data: { name: "Other Probe Company" } });
    otherCompanyId = other.id;
    const otherContact = await prisma.contact.create({
      data: { companyId: otherCompanyId, name: "Other GC" },
    });
    const otherJob = await prisma.job.create({
      data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Other job" },
    });
    await prisma.submittal.create({
      data: { companyId: otherCompanyId, jobId: otherJob.id, number: 1, title: "Other submittal" },
    });
    await prisma.backcharge.create({
      data: {
        companyId: otherCompanyId,
        jobId: otherJob.id,
        number: 1,
        category: "OTHER",
        description: "Other backcharge",
        claimedAmount: "10.00",
        issuedOn: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    await prisma.prevailingWageRuleSet.create({
      data: {
        companyId: otherCompanyId,
        name: "Other rules",
        jurisdiction: "Nevada",
        authority: "STATE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.unionLocal.create({
      data: {
        companyId: otherCompanyId,
        parentInternational: "IUPAT",
        localNumber: "36",
        jurisdictionName: "Nevada",
      },
    });
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      await prisma.submittal.deleteMany({ where: { companyId: id } });
      await prisma.backcharge.deleteMany({ where: { companyId: id } });
      await prisma.prevailingWageRuleSet.deleteMany({ where: { companyId: id } });
      await prisma.unionLocal.deleteMany({ where: { companyId: id } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
  });

  it("the statement runs, and every probe comes back as a real boolean", async () => {
    // The thing no unit test can check: Postgres accepting the SQL, and the
    // driver handing back `true`/`false` rather than "t" or 1n. A truthy
    // string would make every route look used; a bigint 0 is falsy and would
    // work by accident until somebody changed the comparison.
    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(probeSql(), companyId);
    expect(row).toBeDefined();
    const keys = Object.keys(ROUTE_DATA_PROBE).map((_href, i) => `p${i}`);
    expect(Object.keys(row).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(typeof row[key], key).toBe("boolean");
  });

  it("reports nothing for a company that has used none of these features", async () => {
    expect(await loadRoutesWithData(companyId)).toEqual([]);
  });

  it("reports nothing for a brand-new company even though another company has every record", async () => {
    // The WHERE clause, checked rather than assumed.
    const fresh = await prisma.company.create({ data: { name: "Fresh Probe Company" } });
    try {
      expect(await loadRoutesWithData(fresh.id)).toEqual([]);
    } finally {
      await prisma.company.delete({ where: { id: fresh.id } });
    }
  });

  it("names each route the moment its first row exists, and only that route", async () => {
    // One insert at a time, so a positional alias that had drifted from the
    // probe order fails HERE rather than passing an all-or-nothing check.
    const seen: string[] = [];
    for (const href of Object.keys(ROUTE_DATA_PROBE)) {
      await INSERTERS[href]();
      seen.push(href);
      // `loadRoutesWithData` is React-`cache()`d, and outside a server render
      // cache() calls straight through — which is exactly what this loop
      // needs, and is itself worth pinning: a memo that survived between
      // these iterations would make every assertion after the first vacuous.
      const withData = await loadRoutesWithData(companyId);
      expect([...withData].sort(), `after inserting for ${href}`).toEqual([...seen].sort());
    }
    expect([...seen].sort()).toEqual([...HIDEABLE_ROUTES].sort());
  });

  it("the guard then keeps every one of those routes on the rail, against answers that would hide them all", async () => {
    // END TO END, on real rows: the company above has now used all four, and
    // answers "direct for owners, no public work, no pay apps" — the answer
    // shape that hides the most. Nothing may be hidden.
    expect([...routesHiddenByAnswers(OWNER_DIRECT_NO_PUBLIC)].sort()).toEqual([...HIDEABLE_ROUTES].sort());
    const withData = await loadRoutesWithData(companyId);
    for (const href of HIDEABLE_ROUTES) {
      expect(isHiddenByBusinessScope(href, OWNER_DIRECT_NO_PUBLIC, withData), href).toBe(false);
    }
  });
});
