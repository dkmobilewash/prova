import { describe, expect, it } from "vitest";
// Plain .mjs in packages/db so the script can run under bare node. Tested
// from here because this is where vitest lives — same arrangement as
// db-target.test.ts.
import {
  HANDLED_MODELS,
  NEVER_DELETE,
  blockingTables,
  delegateName,
  jobNamesFrom,
} from "../../../packages/db/scripts/scratch-scope.mjs";

/**
 * The decisions that control a delete against real data.
 *
 * Worth testing properly for an obvious reason: nobody is going to
 * rehearse this by running it. The one thing that must hold is that the
 * script's blast radius is exactly the jobs somebody named, and that it
 * STOPS rather than improvising when it meets a table it does not know.
 */

describe("what the cleanup refuses to touch", () => {
  it("passes when every table with rows is one it deletes", () => {
    expect(blockingTables({ Invoice: 2, Payment: 1, SafetyIncident: 0 })).toEqual([]);
  });

  it("blocks on a table it has never heard of — the schema-moved-on case", () => {
    // The whole point. A model added after this script was written shows up
    // here rather than being skipped into an orphan or an FK failure.
    const blockers = blockingTables({ Invoice: 1, SomeNewJobThing: 3 });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].model).toBe("SomeNewJobThing");
    expect(blockers[0].rows).toBe(3);
    expect(blockers[0].reason).toMatch(/added since/);
  });

  it("blocks on evidence records even though they carry a jobId", () => {
    // A safety incident is an OSHA record. A cleanup script must never be
    // the thing that decides one is disposable.
    for (const model of NEVER_DELETE) {
      const blockers = blockingTables({ [model]: 1 });
      expect(blockers, model).toHaveLength(1);
      expect(blockers[0].reason, model).toMatch(/evidence or company-level/);
    }
  });

  it("ignores empty tables, including unknown ones", () => {
    // Zeros must not block, or the script refuses to run forever: it counts
    // every job-scoped model precisely so the zeros are visible.
    expect(blockingTables({ SomeNewJobThing: 0, SafetyIncident: 0 })).toEqual([]);
  });

  it("never lists a protected table as deletable", () => {
    for (const model of NEVER_DELETE) {
      expect(HANDLED_MODELS, model).not.toContain(model);
    }
  });

  it("deletes children before their parents", () => {
    // Order is foreign-key order, not alphabetical, and a reordering that
    // looks like tidying would break the delete.
    const at = (m: string) => HANDLED_MODELS.indexOf(m);
    expect(at("CostEntry")).toBeLessThan(at("JobLineItem"));
    expect(at("InvoiceLineItem")).toBeLessThan(at("Invoice"));
    expect(at("Payment")).toBeLessThan(at("Invoice"));
  });
});

describe("how the job names are chosen", () => {
  it("takes exact names from argv", () => {
    expect(jobNamesFrom(["ZZQB-TEST", "--delete"], ["fallback"])).toEqual(["ZZQB-TEST"]);
  });

  it("falls back only when no name was given", () => {
    expect(jobNamesFrom(["--delete"], ["ZZQB-TEST"])).toEqual(["ZZQB-TEST"]);
  });

  it("does not treat a flag as a job name", () => {
    // `--delete` reaching the name list would mean the run matches nothing
    // and silently reports success, which reads exactly like a clean result.
    expect(jobNamesFrom(["--delete", "--dry"], [])).toEqual([]);
  });

  it("keeps names verbatim so matching can stay exact", () => {
    // The names are used with `in`, never `contains`. A cleanup that
    // substring-matched "test" would take a real job called "Westfield
    // Retest" with it.
    expect(jobNamesFrom(["Westfield Retest"], [])).toEqual(["Westfield Retest"]);
  });
});

describe("delegateName", () => {
  it("lowercases only the first letter, as Prisma does", () => {
    expect(delegateName("QuickBooksEntityLink")).toBe("quickBooksEntityLink");
    expect(delegateName("Invoice")).toBe("invoice");
    expect(delegateName("Rfi")).toBe("rfi");
  });
});
