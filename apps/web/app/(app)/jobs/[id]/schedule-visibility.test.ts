import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Overview tab's Schedule and crew box: SHOWN to everyone who can open
 * the job, EDITABLE only by MANAGE_JOBS — and the two halves are tested
 * together because the whole point of the decision is that they diverge.
 *
 * WHY BOTH HALVES IN ONE FILE. After #396 the page and the endpoint answer
 * different questions, and a test of either one alone can be satisfied by
 * the wrong fix. A test that only checks the rendering passes if somebody
 * "fixes" a refusal by deleting the guard. A test that only checks the
 * refusal passes if somebody hides the whole section. So each case below
 * asserts the pair: this person SEES it, and the action still turns them
 * away.
 *
 * WHICH ROLES THIS IS ACTUALLY ABOUT, because it is easy to get wrong and
 * the first version of #396's own click-list did:
 *
 *   FIELD HOLDS MANAGE_JOBS. A foreman keeps the editable form, the crew
 *   list, the Remove buttons and the Assign control — nothing was taken
 *   from them and nothing here is a courtesy to them. That is asserted
 *   below as a control, not assumed.
 *
 *   ACCOUNTING and PAYROLL_COMPLIANCE are the two functions without
 *   MANAGE_JOBS, so they are the ones who now read the schedule instead of
 *   editing it. They are also exactly the two `lib/permissions.ts` names
 *   in its ROUTE_CAPABILITY comment as the reason `/jobs/[id]` is
 *   deliberately left open at all: "ACCOUNTING and PAYROLL_COMPLIANCE hold
 *   no MANAGE_JOBS and both must open a job". Somebody opening a job to
 *   raise a pay application should see when it runs and who is on it. They
 *   should not restaff it.
 *
 * The page rendering is COURTESY — it decides what a person is offered.
 * The capability assertion inside the action is the BOUNDARY. The last
 * describe block is the one that proves the boundary, and it would still
 * pass if this file's rendering assertions were all deleted.
 */

const company = { id: "company-1", name: "Test Drywall" };

/** The signed-in person, swapped per case. */
const principal = {
  id: "user-1",
  name: "Tester",
  email: "tester@example.com",
  role: "MEMBER" as string,
  jobFunction: null as string | null,
  companyId: company.id,
  company,
};

const START = new Date("2026-10-06T00:00:00.000Z");
const END = new Date("2026-11-20T00:00:00.000Z");

const location = { id: "loc-1", name: "North Yard", city: "Reno", state: "NV", companyId: company.id };

const crew = [
  {
    id: "assign-1",
    userId: "user-42",
    jobId: "job-1",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    user: { id: "user-42", name: "Marta Ruiz", email: "marta@example.com" },
  },
];

const jobRow = {
  id: "job-1",
  companyId: company.id,
  name: "Sunset Tower — drywall",
  status: "IN_PROGRESS",
  scope: "Framing and drywall",
  contactId: "contact-1",
  contact: { id: "contact-1", name: "Acme GC", email: "gc@example.com" },
  operatingLocationId: location.id,
  operatingLocation: location,
  startDate: START,
  endDate: END,
  siteAddress: null,
  projectLocation: null,
  siteLatitude: null,
  bidDueDate: null,
  bidResearch: null,
  signatureRequests: [],
  contractDocuments: [],
  assignments: crew,
  lineItems: [],
};

/** Counts every property read on the stubbed client, so the action cases
 * below can assert that a refusal arrived before any query — the same
 * claim lib/action-capability-guards.test.ts makes, kept here too because
 * this file is where somebody will come to change this behaviour. */
let dbReads = 0;

vi.mock("@prova/db", () => {
  const bump = <T,>(value: T) => {
    dbReads += 1;
    return value;
  };
  return {
    Prisma: {},
    prisma: {
      job: { findUnique: vi.fn(async () => bump(jobRow)), update: vi.fn(async () => bump(jobRow)) },
      contact: { findMany: vi.fn(async () => bump([jobRow.contact])) },
      user: {
        findMany: vi.fn(async () =>
          bump([
            { id: "user-42", name: "Marta Ruiz", email: "marta@example.com", createdAt: new Date() },
            { id: "user-77", name: "Dale Okafor", email: "dale@example.com", createdAt: new Date() },
          ]),
        ),
        findUnique: vi.fn(async () => bump({ id: "user-77", companyId: company.id })),
      },
      companyLocation: { findUnique: vi.fn(async () => bump(location)), findMany: vi.fn(async () => bump([location])) },
      jobAssignment: { create: vi.fn(async () => bump({})), deleteMany: vi.fn(async () => bump({})) },
    },
  };
});

vi.mock("@/lib/auth", () => ({ requireCompanyContext: vi.fn(async () => principal) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
/** The editable branch mounts client components (`JobDetailsForm`,
 * `JobStatusControl`) that call `useRouter`, which throws outside a mounted
 * app router. Only the MANAGE_JOBS renders reach them — which is itself a
 * small confirmation that the two branches really are different code. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/jobs/job-1",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called — the job fixture is not being found");
  },
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["host", "app.example.com"]])),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: vi.fn(async () => "UTC"), viewerToday: vi.fn(async () => "2026-09-20") }));
vi.mock("@/lib/docusign/views", () => ({ loadJobDocuSign: vi.fn(async () => null) }));
vi.mock("@/lib/push", () => ({ pushToUser: vi.fn() }));

/** The page binds these; it never calls them during a render. Mocking the
 * BARREL leaves `@/lib/actions/jobs` itself real, which is what the last
 * describe block imports and executes. */
vi.mock("@/lib/actions", () => ({
  assignCrewMember: vi.fn(),
  unassignCrewMember: vi.fn(),
  updateJobSchedule: vi.fn(),
  createSignatureRequest: vi.fn(),
  revokeSignatureRequest: vi.fn(),
  deleteContractDocument: vi.fn(),
}));

async function renderOverviewAs(jobFunction: string | null, role = "MEMBER") {
  principal.role = role;
  principal.jobFunction = jobFunction;
  const { default: Page } = await import("@/app/(app)/jobs/[id]/(tabs)/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "job-1" }) }));
}

/** The markers that distinguish "offered a control" from "shown a value".
 * `name="startDate"` and `name="userId"` only exist on the real inputs. */
const EDITABLE = ['name="startDate"', 'name="endDate"', 'name="operatingLocationId"'];
/** Deliberately NOT "Confirm remove": `ConfirmDelete` only renders that
 * string once it is ARMED, which is client state a static render never
 * reaches — so asserting its absence would pass for both branches and
 * prove nothing. These three are in the server-rendered markup or not at
 * all: the assign picker, the assign button, and the unassign control's
 * own tooltip text. */
const CREW_CONTROLS = ['name="userId"', ">Assign<", "Takes this person off this job"];

describe("the Schedule and crew box is shown to everyone who can open the job", () => {
  beforeEach(() => {
    dbReads = 0;
    principal.role = "MEMBER";
    principal.jobFunction = null;
  });

  for (const jobFunction of ["ACCOUNTING", "PAYROLL_COMPLIANCE"]) {
    it(`shows ${jobFunction} the schedule and the crew, as information rather than as controls`, async () => {
      const html = await renderOverviewAs(jobFunction);

      // SEEN. The section, both dates, the operating location and the name
      // of the person on the crew — the things a person opening this job
      // came to find out.
      expect(html).toContain("Schedule");
      expect(html).toContain("Crew");
      expect(html).toContain("Oct 6, 2026");
      expect(html).toContain("Nov 20, 2026");
      expect(html).toContain("North Yard");
      expect(html).toContain("Marta Ruiz");

      // NOT OFFERED. No date input, no location picker, no assign control
      // and no armed-delete affordance — a control that refuses on submit
      // invites the click and then punishes it.
      for (const marker of [...EDITABLE, ...CREW_CONTROLS]) {
        expect(html, `${jobFunction} was offered ${marker}, which the action will refuse`).not.toContain(marker);
      }
      expect(html).not.toContain("Save dates");
    });
  }

  it("still offers FIELD the editable form — a foreman holds MANAGE_JOBS and lost nothing", async () => {
    // THE CONTROL, and the reason it is not optional: every assertion in
    // the two cases above is of the form "this string is absent", and a
    // render that produced nothing at all would satisfy all of them. This
    // proves the markers appear when the capability is held, so their
    // absence above means something.
    //
    // It is also the correction of a claim made in #396's first click-list
    // and in Slack: that a Field user would stop seeing this box. FIELD
    // holds MANAGE_JOBS, so a foreman keeps the whole thing — the box, the
    // form and both crew controls.
    const html = await renderOverviewAs("FIELD");

    expect(html).toContain("Schedule");
    expect(html).toContain("Marta Ruiz");
    for (const marker of [...EDITABLE, ...CREW_CONTROLS]) {
      expect(html, `FIELD should still be offered ${marker}`).toContain(marker);
    }
    expect(html).toContain("Save dates");
    // And the read-only rendering is NOT what they get.
    expect(html).not.toContain("Not set");
  });

  it("offers an OWNER everything, whatever their job function says", async () => {
    const html = await renderOverviewAs("ACCOUNTING", "OWNER");
    for (const marker of [...EDITABLE, ...CREW_CONTROLS]) {
      expect(html, `an OWNER must still be offered ${marker}`).toContain(marker);
    }
  });
});

describe("...and the actions behind it are the boundary, not the rendering", () => {
  beforeEach(() => {
    dbReads = 0;
    principal.role = "MEMBER";
    principal.jobFunction = null;
  });

  // The real module. The barrel is mocked above for the page's benefit;
  // this reaches past it deliberately, because the claim under test is
  // about what the endpoint does and not about what the page imports.
  const realActions = () => import("@/lib/actions/jobs");

  for (const jobFunction of ["ACCOUNTING", "PAYROLL_COMPLIANCE"]) {
    it(`refuses ${jobFunction} at the endpoint even though the page showed them the section`, async () => {
      const { updateJobSchedule, assignCrewMember, unassignCrewMember } = await realActions();
      principal.role = "MEMBER";
      principal.jobFunction = jobFunction;

      // Posted directly, the way a person who read the section and then
      // used the network tab would. The page offered them nothing; that is
      // not what stops this.
      for (const [name, call] of [
        ["updateJobSchedule", () => updateJobSchedule("job-1", new FormData())],
        ["assignCrewMember", () => assignCrewMember("job-1", new FormData())],
        ["unassignCrewMember", () => unassignCrewMember("job-1", "user-42")],
      ] as const) {
        dbReads = 0;
        await expect(call(), `${name} admitted ${jobFunction}`).rejects.toThrow(/part of your job function/);
        // And it refused BEFORE reading anything, which is the stronger
        // claim: a guard that runs after the first query is a guard that
        // ran too late.
        expect(dbReads, `${name} queried the database before refusing ${jobFunction}`).toBe(0);
      }
    });
  }

  it("admits FIELD, so the refusal above is about the capability and not about everyone", async () => {
    // Without this the block above is satisfied by an action that refuses
    // the entire world.
    const { unassignCrewMember } = await realActions();
    principal.role = "MEMBER";
    principal.jobFunction = "FIELD";

    await expect(unassignCrewMember("job-1", "user-42")).resolves.not.toThrow();
  });

  it("admits an OWNER whose job function holds nothing", async () => {
    const { unassignCrewMember } = await realActions();
    principal.role = "OWNER";
    principal.jobFunction = "ACCOUNTING";

    await expect(unassignCrewMember("job-1", "user-42")).resolves.not.toThrow();
  });
});
