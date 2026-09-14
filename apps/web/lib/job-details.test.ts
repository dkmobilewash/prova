import { describe, expect, it } from "vitest";
import {
  JOB_HISTORY_RELATIONS,
  describeJobHistory,
  jobDetailsFromForm,
  mayChangeClient,
} from "./job-details";

/**
 * Correcting an estimate, and removing one that should not exist.
 *
 * Two gaps this covers, both found by using the product rather than reading
 * it. A job's name, GC and scope could not be changed AT ALL — only its line
 * items and its schedule — so a typo was permanent on every job in the
 * system. And a job could not be removed by any means short of a database
 * script, which is genuinely correct for a job that has been worked and
 * plainly wrong for an estimate created by accident thirty seconds ago.
 *
 * The rule that decides both is this repo's evidence-record rule: a record
 * that has been SENT, BILLED or WORKED is history and does not get erased.
 * One that has not is a draft, and a person may fix or discard their own
 * draft without asking anybody.
 */
describe("jobDetailsFromForm", () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  it("reads a name, a scope and a client", () => {
    const parsed = jobDetailsFromForm(
      form({ name: "Maple Grove Middle School Gym", scope: "12,000 SF level 4", contactId: "c-1" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      name: "Maple Grove Middle School Gym",
      scope: "12,000 SF level 4",
      contactId: "c-1",
    });
  });

  it("trims, because a trailing space is not a rename", () => {
    const parsed = jobDetailsFromForm(form({ name: "  Riverside  ", scope: "  ", contactId: "c-1" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe("Riverside");
    // An emptied scope is null, not "". A job with no scope and a job whose
    // scope is the empty string are the same job.
    expect(parsed.value.scope).toBeNull();
  });

  it("refuses a blank name with a sentence, rather than writing one", () => {
    const parsed = jobDetailsFromForm(form({ name: "   ", scope: "x", contactId: "c-1" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.toLowerCase()).toContain("name");
  });
});

describe("mayChangeClient", () => {
  it("allows it while the job is still an estimate", () => {
    expect(mayChangeClient("ESTIMATE")).toBe(true);
  });

  it("refuses it once the job is contracted or beyond", () => {
    // Deliberately every other status, so a new one added later fails here
    // and somebody has to decide rather than inherit "true".
    for (const status of ["CONTRACTED", "IN_PROGRESS", "COMPLETE"] as const) {
      expect(mayChangeClient(status), status).toBe(false);
    }
  });
});

describe("describeJobHistory", () => {
  const none = Object.fromEntries(JOB_HISTORY_RELATIONS.map((r) => [r.key, 0]));

  it("says a job with nothing on it holds nothing", () => {
    expect(describeJobHistory(none)).toEqual([]);
  });

  it("names only the non-zero kinds", () => {
    // The shape of refusal message this repo has already had to fix once:
    // "has 0 invoices and 3 time entries" is what not to produce.
    const held = describeJobHistory({ ...none, invoices: 2, timeEntries: 0, rfis: 1 });
    expect(held).toEqual(["2 invoices", "1 RFI"]);
  });

  it("gets singular and plural right for every relation it knows", () => {
    for (const relation of JOB_HISTORY_RELATIONS) {
      const one = describeJobHistory({ ...none, [relation.key]: 1 });
      const two = describeJobHistory({ ...none, [relation.key]: 2 });
      expect(one, relation.key).toHaveLength(1);
      expect(two, relation.key).toHaveLength(1);
      expect(one[0], relation.key).toMatch(/^1 /);
      expect(two[0], relation.key).toMatch(/^2 /);
      // A plural that is just the singular again is the bug this catches.
      expect(one[0], relation.key).not.toBe(two[0].replace(/^2 /, "1 "));
    }
  });

  it("covers every relation that means a job has been worked", () => {
    // Asserted against a written-out number, not against the array's own
    // length: a list that silently shrank would otherwise satisfy every
    // property above while checking nothing. If a relation is added to Job,
    // this fails and somebody decides whether it counts as history.
    expect(JOB_HISTORY_RELATIONS).toHaveLength(19);
    const keys = JOB_HISTORY_RELATIONS.map((r) => r.key);
    expect(new Set(keys).size, "duplicate relation key").toBe(keys.length);
    // lineItems is deliberately NOT here: an estimate always has them and
    // they ARE the estimate, not evidence that it was worked.
    expect(keys).not.toContain("lineItems");
  });
});
