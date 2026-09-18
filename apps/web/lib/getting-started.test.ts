import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ASK_CREATE_JOB_CAPABILITIES,
  ASK_CREATE_JOB_EXAMPLE,
  gettingStartedChecklist,
  isSignUpCompanyName,
  type GettingStartedCounts,
  type GettingStartedStepId,
} from "./getting-started";
import type { Principal } from "./permissions";
import { isGettingStartedHidden } from "./getting-started-cookie";

/**
 * The getting-started checklist, as a pure function of counts.
 *
 * Every step is tested at its boundary — the value that is not yet done
 * and the first value that is — because a `> 0` that drifts to `> 1` or a
 * `users > 1` that drifts to `users > 0` passes every test written only
 * against an obviously-done or obviously-empty company. `users > 0` in
 * particular would tick "Add your crew" for every account on day one,
 * since the viewer is always a user.
 */

vi.mock("@prova/db", () => ({ prisma: {} }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: vi.fn() }));

const EMPTY: GettingStartedCounts = {
  jobs: 0,
  users: 1,
  pendingInvites: 0,
  crewMembers: 0,
  scheduleDays: 0,
  fieldReports: 0,
  jobMedia: 0,
  quickBooksConnections: 0,
};

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };
const PLAIN_MEMBER: Principal = { role: "MEMBER", jobFunction: null };

const GENERATED = "Dana Smith's Company";
const NAMED = "Smith Drywall LLC";

function run(
  counts: Partial<GettingStartedCounts> = {},
  viewer: Principal = OWNER,
  companyName = GENERATED,
) {
  return gettingStartedChecklist({ companyName, counts: { ...EMPTY, ...counts }, viewer });
}

function step(checklist: ReturnType<typeof run>, id: GettingStartedStepId) {
  const found = checklist.steps.find((s) => s.id === id);
  if (!found) throw new Error(`step ${id} not shown`);
  return found;
}

const ids = (checklist: ReturnType<typeof run>) => checklist.steps.map((s) => s.id);

/** Every required step done, for an owner. */
const ALL_REQUIRED: Partial<GettingStartedCounts> = {
  jobs: 1,
  users: 2,
  scheduleDays: 1,
  fieldReports: 1,
};

describe("a brand-new company, seen by its owner", () => {
  const checklist = run();

  it("shows every step, in order", () => {
    expect(ids(checklist)).toEqual([
      "name-company",
      "first-job",
      "import",
      "crew",
      "schedule",
      "first-day",
      "quickbooks",
    ]);
  });

  it("has nothing done and five required steps", () => {
    expect(checklist.steps.every((s) => !s.done)).toBe(true);
    expect(checklist.requiredTotal).toBe(5);
    expect(checklist.requiredDone).toBe(0);
    expect(checklist.complete).toBe(false);
  });

  it("marks import and QuickBooks optional and nothing else", () => {
    expect(checklist.steps.filter((s) => s.optional).map((s) => s.id)).toEqual(["import", "quickbooks"]);
  });
});

describe("each step's done boundary", () => {
  it("name: the sign-up name is not done, a real one is", () => {
    expect(step(run({}, OWNER, GENERATED), "name-company").done).toBe(false);
    expect(step(run({}, OWNER, "My Company"), "name-company").done).toBe(false);
    expect(step(run({}, OWNER, NAMED), "name-company").done).toBe(true);
  });

  it("first job: 0 is not done, 1 is", () => {
    expect(step(run({ jobs: 0 }), "first-job").done).toBe(false);
    expect(step(run({ jobs: 1 }), "first-job").done).toBe(true);
  });

  it("crew: just the viewer is not done — a second user is", () => {
    expect(step(run({ users: 1 }), "crew").done).toBe(false);
    expect(step(run({ users: 2 }), "crew").done).toBe(true);
  });

  it("crew: a pending invite counts, since the owner has done their part", () => {
    expect(step(run({ pendingInvites: 1 }), "crew").done).toBe(true);
  });

  it("crew: an active crew record counts", () => {
    expect(step(run({ crewMembers: 1 }), "crew").done).toBe(true);
  });

  it("schedule: 0 is not done, 1 is", () => {
    expect(step(run({ scheduleDays: 0 }), "schedule").done).toBe(false);
    expect(step(run({ scheduleDays: 1 }), "schedule").done).toBe(true);
  });

  it("first day: a field report counts", () => {
    expect(step(run({ fieldReports: 0, jobMedia: 0 }), "first-day").done).toBe(false);
    expect(step(run({ fieldReports: 1 }), "first-day").done).toBe(true);
  });

  it("first day: a photo or video on a job counts on its own", () => {
    expect(step(run({ jobMedia: 1 }), "first-day").done).toBe(true);
  });

  it("QuickBooks: 0 is not done, 1 is", () => {
    expect(step(run({ quickBooksConnections: 0 }), "quickbooks").done).toBe(false);
    expect(step(run({ quickBooksConnections: 1 }), "quickbooks").done).toBe(true);
  });

  it("import is never done, because nothing proves an import happened", () => {
    expect(step(run({ ...ALL_REQUIRED, jobs: 50 }, OWNER, NAMED), "import").done).toBe(false);
  });
});

describe("the sign-up name rule", () => {
  it("recognises both strings lib/auth.ts writes", () => {
    expect(isSignUpCompanyName("Dana Smith's Company")).toBe(true);
    expect(isSignUpCompanyName("Dana's Company")).toBe(true);
    expect(isSignUpCompanyName("My Company")).toBe(true);
  });

  it("treats blank as not named", () => {
    expect(isSignUpCompanyName("   ")).toBe(true);
  });

  it("treats a real name as named, including ones containing the words", () => {
    expect(isSignUpCompanyName("Smith Drywall LLC")).toBe(false);
    expect(isSignUpCompanyName("My Company Drywall")).toBe(false);
    expect(isSignUpCompanyName("The Company's Drywall")).toBe(false);
    // A curly apostrophe was typed by a person; auth.ts never writes one.
    expect(isSignUpCompanyName("Dana Smith’s Company")).toBe(false);
  });
});

describe("progress and completion", () => {
  it("counts only required steps", () => {
    const checklist = run({ jobs: 1, quickBooksConnections: 1 });
    expect(checklist.requiredDone).toBe(1);
    expect(checklist.requiredTotal).toBe(5);
  });

  it("is complete when every required step is done", () => {
    const checklist = run(ALL_REQUIRED, OWNER, NAMED);
    expect(checklist.requiredDone).toBe(5);
    expect(checklist.complete).toBe(true);
  });

  it("optional steps never block completion", () => {
    const checklist = run(ALL_REQUIRED, OWNER, NAMED);
    expect(step(checklist, "import").done).toBe(false);
    expect(step(checklist, "quickbooks").done).toBe(false);
    expect(checklist.complete).toBe(true);
  });

  it("optional steps done cannot stand in for a required one", () => {
    const checklist = run({ ...ALL_REQUIRED, scheduleDays: 0, quickBooksConnections: 1 }, OWNER, NAMED);
    expect(checklist.requiredDone).toBe(4);
    expect(checklist.complete).toBe(false);
  });

  it("any single required step outstanding keeps it open", () => {
    for (const missing of [
      { companyName: GENERATED, counts: ALL_REQUIRED },
      { companyName: NAMED, counts: { ...ALL_REQUIRED, jobs: 0 } },
      { companyName: NAMED, counts: { ...ALL_REQUIRED, users: 1 } },
      { companyName: NAMED, counts: { ...ALL_REQUIRED, scheduleDays: 0 } },
      { companyName: NAMED, counts: { ...ALL_REQUIRED, fieldReports: 0 } },
    ]) {
      expect(run(missing.counts, OWNER, missing.companyName).complete).toBe(false);
    }
  });
});

describe("only steps the viewer can act on", () => {
  it("a FIELD member sees no owner-only step and no settings link", () => {
    const shown = ids(run({}, FIELD));
    expect(shown).toEqual(["first-job", "schedule", "first-day"]);
    for (const s of run({}, FIELD).steps) expect(s.href.startsWith("/settings")).toBe(false);
  });

  it("an ACCOUNTING member is not sent to /field-reports or asked to schedule", () => {
    const shown = ids(run({}, ACCOUNTING));
    expect(shown).not.toContain("first-day");
    expect(shown).not.toContain("schedule");
    expect(shown).toEqual(["first-job"]);
  });

  it("a member with no job function gets the office steps but none of the owner's", () => {
    expect(ids(run({}, PLAIN_MEMBER))).toEqual(["first-job", "schedule", "first-day"]);
  });

  it("progress and completion are over the steps the viewer can see", () => {
    // The company is unnamed and nobody else is on it — both owner jobs —
    // and neither holds a FIELD member's card open.
    const checklist = run({ jobs: 1, scheduleDays: 1, fieldReports: 1 }, FIELD, GENERATED);
    expect(checklist.requiredTotal).toBe(3);
    expect(checklist.requiredDone).toBe(3);
    expect(checklist.complete).toBe(true);
  });
});

describe("the one-sentence path through the assistant", () => {
  it("is offered to an owner on the first-job step", () => {
    const ask = step(run(), "first-job").ask;
    expect(ask).toEqual({ example: ASK_CREATE_JOB_EXAMPLE, href: "/ask" });
  });

  it("is withheld from a FIELD member, whom the command would refuse", () => {
    expect(step(run({}, FIELD), "first-job").ask).toBeUndefined();
  });

  it("is on no other step", () => {
    expect(run().steps.filter((s) => s.ask).map((s) => s.id)).toEqual(["first-job"]);
  });

  it("is gated on exactly what create_estimate_job itself requires", async () => {
    const { createEstimateJobCommand } = await import("./ask/commands/estimating");
    expect(new Set(ASK_CREATE_JOB_CAPABILITIES)).toEqual(
      new Set([createEstimateJobCommand.capability, ...(createEstimateJobCommand.requiresAlso ?? [])]),
    );
    // The example names a job and a GC, the two things it asks for.
    const properties = (createEstimateJobCommand.input_schema as { properties: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["jobName", "gcName"]));
  });
});

describe("the hide cookie", () => {
  it("hides only for the company it names", () => {
    expect(isGettingStartedHidden("co-1", "co-1")).toBe(true);
    expect(isGettingStartedHidden("co-2", "co-1")).toBe(false);
    expect(isGettingStartedHidden(undefined, "co-1")).toBe(false);
    expect(isGettingStartedHidden("", "co-1")).toBe(false);
  });
});

describe("every link on the checklist goes to a page that exists", () => {
  // The import step was written before /settings/import existed, pointing
  // at a route another branch was adding. A link to a missing page is a 404
  // on the card a brand-new contractor sees first, and nothing else here
  // would notice — so each step's href must resolve to a real page file.
  it("resolves each owner-visible href to app/(app)/<href>/page.tsx", () => {
    const steps = run({}, OWNER, GENERATED).steps;
    // All seven, so a filter that dropped steps cannot make this vacuous.
    expect(steps.map((s) => s.id)).toEqual([
      "name-company",
      "first-job",
      "import",
      "crew",
      "schedule",
      "first-day",
      "quickbooks",
    ]);
    for (const s of steps) {
      const page = new URL(`../app/(app)${s.href}/page.tsx`, import.meta.url);
      expect(existsSync(page), `${s.id} -> ${s.href}`).toBe(true);
    }
  });
});
