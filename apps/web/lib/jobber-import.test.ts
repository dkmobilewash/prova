import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, formatJobberAddress, jobberDay, planJobberImport, type JobberPull } from "./jobber-import";
import { FULL_SSN_REFUSAL, mentionsWholeSsn } from "./spreadsheet-import";

/** The planner on its own: Jobber rows in, buckets out. Nothing here talks
 * to Jobber or a database — see lib/actions/jobber.test.ts for that. */

function pull(partial: Partial<JobberPull>): JobberPull {
  return {
    clients: [],
    jobs: [],
    quotes: [],
    properties: [],
    truncated: { clients: false, jobs: false, quotes: false, properties: false },
    ...partial,
  };
}
const none = { contacts: [], jobs: [] };

describe("clients", () => {
  it("never merges two Jobber clients who share a name — the second, and its jobs, are refused with a reason", () => {
    const plan = planJobberImport(
      pull({
        clients: [
          { id: "A", name: "John Smith" },
          { id: "B", name: "john  smith" },
        ],
        jobs: [
          { id: "J1", jobNumber: 1, title: "Fence", client: { id: "A" } },
          { id: "J2", jobNumber: 2, title: "Roof", client: { id: "B" } },
        ],
      }),
      none,
    );
    expect(plan.clients.create.map((c) => c.jobberId)).toEqual(["A"]);
    expect(plan.clients.problems[0].message).toMatch(/same name/);
    expect(plan.jobs.create.map((j) => j.jobberId)).toEqual(["J1"]);
    expect(plan.jobs.problems[0].message).toMatch(/Job #2 Roof — skipped because/);
  });

  it("also refuses the second one when the FIRST matched a hand-typed client by name", () => {
    const plan = planJobberImport(
      pull({ clients: [{ id: "A", name: "John Smith" }, { id: "B", name: "John Smith" }] }),
      { contacts: [{ id: "c1", name: "John Smith", jobberId: null }], jobs: [] },
    );
    expect(plan.clients.existing).toHaveLength(1);
    expect(plan.clients.problems).toHaveLength(1);
  });

  it("does not treat a namesake imported from a DIFFERENT Jobber client as the same person", () => {
    const plan = planJobberImport(pull({ clients: [{ id: "B", name: "John Smith" }] }), {
      contacts: [{ id: "c1", name: "John Smith", jobberId: "A" }],
      jobs: [],
    });
    expect(plan.clients.existing).toEqual([]);
    expect(plan.clients.problems[0].message).toMatch(/different Jobber client/);
  });

  it("recognises its own row by Jobber id after a rename", () => {
    const plan = planJobberImport(pull({ clients: [{ id: "A", name: "New Name" }] }), {
      contacts: [{ id: "c1", name: "Old Name", jobberId: "A" }],
      jobs: [],
    });
    expect(plan.clients.create).toEqual([]);
    expect(plan.clients.existing[0].label).toBe("New Name (here as Old Name)");
  });

  it("refuses a client carrying a whole SSN without repeating it", () => {
    const plan = planJobberImport(pull({ clients: [{ id: "A", name: "Pat", phones: [{ number: "123-45-6789" }] }] }), none);
    expect(plan.clients.create).toEqual([]);
    expect(plan.clients.problems[0].message).toBe(`Pat — ${FULL_SSN_REFUSAL}`);
    expect(JSON.stringify(plan)).not.toContain("123-45-6789");
  });

  it("caps NEW clients at the importer's limit, counting after matching, and says so", () => {
    const clients = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => ({ id: `C${i}`, name: `Client ${i}` }));
    const plan = planJobberImport(pull({ clients }), none);
    expect(plan.clients.create).toHaveLength(MAX_IMPORT_ROWS);
    expect(plan.notices.join(" ")).toMatch(/3 more are left for the next run/);
  });
});

describe("jobs", () => {
  const clients = [{ id: "A", name: "Ann" }];

  it("keeps two same-titled jobs for one client as two, told apart by their Jobber number", () => {
    const plan = planJobberImport(
      pull({
        clients,
        jobs: [
          { id: "J1", jobNumber: 1, title: "Service call", client: { id: "A" } },
          { id: "J2", jobNumber: 2, title: "Service call", client: { id: "A" } },
        ],
      }),
      none,
    );
    expect(plan.jobs.create.map((j) => j.name)).toEqual(["Service call — Jobber job #1", "Service call — Jobber job #2"]);
  });

  it("leaves out archived jobs and converted quotes, with the reason, and imports the rest whatever their status", () => {
    const plan = planJobberImport(
      pull({
        clients,
        jobs: [
          { id: "J1", jobNumber: 1, title: "Old", jobStatus: "archived", client: { id: "A" } },
          { id: "J2", jobNumber: 2, title: "Live", jobStatus: "active", client: { id: "A" } },
        ],
        quotes: [
          { id: "Q1", quoteNumber: "5", title: "Won", quoteStatus: "converted", client: { id: "A" } },
          { id: "Q2", quoteNumber: "6", title: "Pending", quoteStatus: "approved", client: { id: "A" } },
        ],
      }),
      none,
    );
    expect(plan.jobs.create.map((j) => j.jobberId)).toEqual(["J2", "Q2"]);
    expect(plan.jobs.leftOut.map((l) => l.reason)).toEqual([
      expect.stringMatching(/archived/),
      expect.stringMatching(/became a job/),
    ]);
  });

  it("drops unreadable or backwards dates with a note rather than guessing", () => {
    const plan = planJobberImport(
      pull({
        clients,
        jobs: [
          { id: "J1", jobNumber: 1, title: "A", startAt: "2026-05-10T00:00:00Z", endAt: "2026-05-01T00:00:00Z", client: { id: "A" } },
          { id: "J2", jobNumber: 2, title: "B", startAt: "soon", client: { id: "A" } },
        ],
      }),
      none,
    );
    expect(plan.jobs.create.map((j) => [j.startDate, j.endDate, j.notes.length])).toEqual([
      [null, null, 1],
      [null, null, 1],
    ]);
  });

  it("a job whose client isn't in the pull is a problem, not an orphan", () => {
    const plan = planJobberImport(pull({ jobs: [{ id: "J1", jobNumber: 1, title: "X", client: { id: "ghost" } }] }), none);
    expect(plan.jobs.create).toEqual([]);
    expect(plan.jobs.problems).toHaveLength(1);
  });

  it("matches a hand-typed job by name under the same client", () => {
    const plan = planJobberImport(
      pull({ clients, jobs: [{ id: "J1", jobNumber: 1, title: "Porch", client: { id: "A" } }] }),
      { contacts: [{ id: "c1", name: "ann", jobberId: null }], jobs: [{ name: "porch", contactId: "c1", jobberId: null }] },
    );
    expect(plan.jobs.create).toEqual([]);
    expect(plan.jobs.existing).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("formats an address and skips the empty parts", () => {
    expect(formatJobberAddress({ street1: " 1 A St ", city: "Reno", province: "NV", postalCode: "" })).toBe("1 A St, Reno, NV");
    expect(formatJobberAddress({})).toBeNull();
  });

  it("takes the calendar day as Jobber wrote it, not shifted through UTC", () => {
    expect(jobberDay("2026-10-01T22:30:00-07:00")).toBe("2026-10-01");
    expect(jobberDay(null)).toBeNull();
    expect(jobberDay("2026-02-30T00:00:00Z")).toBeUndefined();
  });

  it("finds a whole SSN inside text, but not a phone number", () => {
    expect(mentionsWholeSsn("gate code 1234, owner ssn 123-45-6789")).toBe(true);
    expect(mentionsWholeSsn("775-555-0101")).toBe(false);
    expect(mentionsWholeSsn(null)).toBe(false);
  });
});
