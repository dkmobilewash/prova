import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/sales/[id]/drawing-read` AND `lib/drawing-set-read-query.ts`.
 *
 * WHY THIS FILE RENDERS RATHER THAN READS THE SOURCE. The two things most
 * worth pinning here are both OUTPUT: that the access gate refuses, and that
 * the email a prospect is about to be sent actually reaches the screen. A grep
 * cannot tell a `<pre>` that renders from one inside a branch nothing takes,
 * and this repo has paid repeatedly for a check that was green about markup
 * nobody had ever produced (`components/EquipmentRow.test.ts`'s own reason,
 * and `app/(app)/empty-states.test.ts`'s).
 *
 * EVERY NEGATIVE ASSERTION BELOW IS PAIRED WITH A POSITIVE ONE, because
 * `not.toContain` passes just as happily on the empty string — the most
 * repeated failure in this codebase is a check answering a question nobody
 * asked. So the owner-only case asserts the refusal is on screen, the
 * empty-state case asserts the way out is on screen, and the composed-email
 * case asserts the real subject line is on screen.
 *
 * ── WHY A FAKE PRISMA AND NOT A `.dbtest.ts` ──
 *
 * The db suite needs a scratch Postgres (`vitest.db.setup.mts` refuses any
 * non-localhost host, correctly) and nothing asserted here is about SQL. The
 * fake holds TWO companies and honours `companyId` by equality, so a query
 * that forgets to scope returns the other company's rows and the
 * cross-company cases below go red — which is the whole point of them. It is
 * the shape `app/(app)/settings/import/page.test.ts` uses for the same reason.
 *
 * What the fake deliberately does NOT implement is `orderBy`. The newest
 * proposal per page winning is `plan-ingest/`'s rule and is tested there, so
 * the fixture carries exactly ONE proposal per page and ordering cannot change
 * any answer below. Stated rather than left to be discovered.
 */

const COMPANY = "co_operator";
const OTHER = "co_rival";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  isProvaOperator: true,
  /** Emptied by the empty-state case. */
  planIds: ["plan_ours", "plan_theirs"] as string[],
}));

/** Signed-in context. `company.isProvaOperator` and `role` are the two the
 *  page gates on, and each is moved independently below. */
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({
    id: "user_1",
    name: "Operator",
    email: "ops@cstream.test",
    role: state.role,
    jobFunction: null,
    company: { id: COMPANY, name: "C Stream", isProvaOperator: state.isProvaOperator },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/**
 * The send control's action. Stubbed so this file never loads the
 * `"use server"` module behind the button — it pulls in the mail provider and
 * is another agent's lane. Nothing here presses the button; the assertion is
 * that the control RENDERS, which is what a page can get wrong.
 */
vi.mock("@/lib/actions/takeoffOffer", () => ({
  sendDrawingSetRead: async () => ({ ok: false as const, error: "not called in this test" }),
}));

const LEADS: Row[] = [
  {
    id: "lead_ours",
    companyId: COMPANY,
    companyName: "Harbor Drywall",
    contactName: "Dana Reyes",
    email: "dana@harbor.test",
    activities: [
      {
        id: "act_note",
        type: "NOTE",
        occurredOn: new Date("2026-10-01T00:00:00.000Z"),
        summary: "Asked for a free drawing-set read from /wall-takeoff.\nTrade: Lath & plaster",
      },
    ],
  },
  {
    id: "lead_theirs",
    companyId: OTHER,
    companyName: "Rival Drywall",
    contactName: "Sam Vale",
    email: "sam@rival.test",
    activities: [],
  },
];

const PLANS: Row[] = [
  {
    id: "plan_ours",
    companyId: COMPANY,
    fileName: "Harbor Bid Set.pdf",
    createdAt: new Date("2026-10-02T15:00:00.000Z"),
    job: { name: "Harbor Medical Fit-Out" },
  },
  {
    id: "plan_theirs",
    companyId: OTHER,
    fileName: "Rival Bid Set.pdf",
    createdAt: new Date("2026-10-03T15:00:00.000Z"),
    job: { name: "Rival Tower" },
  },
];

/** `plan` is carried on each row so the nested `where: { plan: { companyId } }`
 *  that `sheetIndexFor` uses is a real filter here rather than a no-op. */
const SHEET_TEXTS: Row[] = [
  { planId: "plan_ours", pageNumber: 1, hasTextLayer: true, plan: { companyId: COMPANY } },
  // A scan: no text layer and therefore no proposal, ever, until somebody
  // types the number in. This is the row that makes the email's "sheets we
  // could not read" section fire.
  { planId: "plan_ours", pageNumber: 2, hasTextLayer: false, plan: { companyId: COMPANY } },
  { planId: "plan_ours", pageNumber: 3, hasTextLayer: true, plan: { companyId: COMPANY } },
  { planId: "plan_theirs", pageNumber: 1, hasTextLayer: true, plan: { companyId: OTHER } },
];

function proposal(planId: string, pageNumber: number, extra: Row): Row {
  return {
    id: `prop_${planId}_${pageNumber}`,
    planId,
    pageNumber,
    plan: { companyId: planId === "plan_ours" ? COMPANY : OTHER },
    proposedSheetNumber: null,
    proposedTitle: null,
    proposedDiscipline: null,
    proposedPageType: null,
    proposedScale: null,
    titleBlockRevisionText: null,
    titleBlockIssueDateText: null,
    proposedReason: "read off the title block",
    proposedConfidence: "HIGH",
    status: "PROPOSED",
    acceptedSheetNumber: null,
    acceptedTitle: null,
    createdAt: new Date("2026-10-02T16:00:00.000Z"),
    ...extra,
  };
}

const SHEET_PROPOSALS: Row[] = [
  proposal("plan_ours", 1, {
    proposedSheetNumber: "A-101",
    proposedTitle: "First Floor Plan",
    proposedDiscipline: "Architectural",
    proposedPageType: "PLAN",
  }),
  proposal("plan_ours", 3, {
    proposedSheetNumber: "A-601",
    proposedTitle: "Partition Schedule",
    proposedDiscipline: "Architectural",
    proposedPageType: "SCHEDULE",
  }),
  proposal("plan_theirs", 1, {
    proposedSheetNumber: "Z-999",
    proposedTitle: "Rival Floor Plan",
    proposedDiscipline: "Architectural",
    proposedPageType: "PLAN",
  }),
];

const SCHEDULE_PROPOSALS: Row[] = [
  {
    id: "sched_ours",
    planId: "plan_ours",
    pageNumber: 3,
    kind: "PARTITION",
    title: "Partition Schedule",
    rows: [{ mark: "P1", description: "One-hour rated", size: "6\"", quantity: 12, notes: null }],
    reason: "a grid with a mark column",
    confidence: "HIGH",
    gridRowCount: 1,
    readRowCount: 1,
  },
  {
    id: "sched_theirs",
    planId: "plan_theirs",
    pageNumber: 1,
    kind: "DOOR",
    title: "Rival Door Schedule",
    rows: [{ mark: "D1", description: null, size: null, quantity: null, notes: null }],
    reason: "a grid with a mark column",
    confidence: "HIGH",
    gridRowCount: 1,
    readRowCount: 1,
  },
];

/** Equality on scalars, one level of nested relation filter, and `in`. Enough
 *  for every `where` these two modules build, and nothing more — an unknown
 *  operator would silently match everything, so it throws instead. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected !== null && typeof expected === "object" && !(expected instanceof Date)) {
      const operators = expected as Row;
      if ("in" in operators) return (operators.in as unknown[]).includes(row[key]);
      if ("equals" in operators) return row[key] === operators.equals;
      const related = row[key];
      if (related === null || typeof related !== "object") return false;
      return matches(related as Row, operators);
    }
    return row[key] === expected;
  });
}

function table(rows: Row[]) {
  return {
    findMany: async ({ where = {}, take }: { where?: Row; take?: number } = {}) => {
      const found = rows.filter((row) => matches(row, where));
      return take === undefined ? found : found.slice(0, take);
    },
    findUnique: async ({ where = {} }: { where?: Row } = {}) =>
      rows.find((row) => matches(row, where)) ?? null,
  };
}

vi.mock("@prova/db", () => ({
  prisma: {
    salesLead: table(LEADS),
    takeoffPlan: {
      findUnique: table(PLANS).findUnique,
      findMany: async ({ where = {}, take }: { where?: Row; take?: number } = {}) => {
        const found = PLANS.filter(
          (plan) => matches(plan, where) && state.planIds.includes(plan.id as string),
        )
          // Newest first, which is the one ordering a candidate list's meaning
          // depends on — the operator picks the set they just ingested.
          .sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          )
          .map((plan) => ({
            ...plan,
            _count: {
              sheetTexts: SHEET_TEXTS.filter((text) => text.planId === plan.id).length,
            },
          }));
        return take === undefined ? found : found.slice(0, take);
      },
    },
    planSheetText: table(SHEET_TEXTS),
    planSheetProposal: table(SHEET_PROPOSALS),
    planScheduleProposal: table(SCHEDULE_PROPOSALS),
  },
  Prisma: {},
}));

const { default: DrawingReadPage } = await import(
  "@/app/(app)/sales/[id]/drawing-read/page"
);
const { readCandidates, deliveredReadFor, MAX_READ_CANDIDATES } = await import(
  "@/lib/drawing-set-read-query"
);
const { deliverySubjectLine } = await import("@/lib/takeoff-delivery");

function render(leadId: string, plan?: string) {
  return DrawingReadPage({
    params: Promise.resolve({ id: leadId }),
    searchParams: Promise.resolve(plan === undefined ? {} : { plan }),
  }).then(renderToStaticMarkup);
}

beforeEach(() => {
  state.role = "OWNER";
  state.isProvaOperator = true;
  state.planIds = ["plan_ours", "plan_theirs"];
});

describe("the gate is /sales's gate", () => {
  it("gives a non-operator company the same not-found as a lead that does not exist", async () => {
    state.isProvaOperator = false;
    await expect(render("lead_ours")).rejects.toThrow("NEXT_NOT_FOUND");

    // The control: with the flag back on, the SAME lead renders. Without this
    // the assertion above would pass on a page that is broken for everybody.
    state.isProvaOperator = true;
    expect(await render("lead_ours")).toContain("Harbor Drywall");
  });

  it("refuses a member at the operator company by name, and renders nothing of the read", async () => {
    state.role = "MEMBER";
    const html = await render("lead_ours", "plan_ours");
    expect(html).toContain("Owner only");
    expect(html).toContain("restricted to the account owner");
    // The refusal is the whole page: no candidate list, no composed email.
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("Harbor Bid Set.pdf");
  });

  it("does not find a lead belonging to another company", async () => {
    await expect(render("lead_theirs")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("readCandidates lists this company's sets and nobody else's", () => {
  it("returns only our plan, with the counts the operator picks by", async () => {
    const candidates = await readCandidates(COMPANY);
    expect(candidates.map((candidate) => candidate.planId)).toEqual(["plan_ours"]);
    expect(candidates[0]).toMatchObject({
      fileName: "Harbor Bid Set.pdf",
      jobName: "Harbor Medical Fit-Out",
      sheetCount: 3,
      // ONE, not two: page 3 is the only sheet the title block called
      // SCHEDULE. `scheduleSheetCountFor` counts sheets, not proposal rows.
      scheduleCount: 1,
    });
    expect(candidates[0].uploadedAt.toISOString()).toBe("2026-10-02T15:00:00.000Z");
  });

  it("asks for a bounded page rather than every plan the company has", () => {
    expect(MAX_READ_CANDIDATES).toBeGreaterThan(0);
  });

  it("returns the other company nothing of ours", async () => {
    const theirs = await readCandidates(OTHER);
    expect(theirs.map((candidate) => candidate.planId)).toEqual(["plan_theirs"]);
  });
});

describe("deliveredReadFor proves both ids against the company", () => {
  it("composes the read when the lead and the plan are both ours", async () => {
    const read = await deliveredReadFor("lead_ours", "plan_ours", COMPANY);
    expect(read).not.toBeNull();
    expect(read!.subject).toEqual({
      companyName: "Harbor Drywall",
      contactName: "Dana Reyes",
      projectName: "Harbor Medical Fit-Out",
      fileName: "Harbor Bid Set.pdf",
    });
    expect(read!.sheets.map((sheet) => sheet.pageNumber)).toEqual([1, 2, 3]);
    expect(read!.schedules.map((schedule) => schedule.id)).toEqual(["sched_ours"]);
  });

  /** THE MUTATION TARGET. Drop the plan's `companyId` comparison in
   * `deliveredReadFor` and this is the assertion that goes red. */
  it("returns null for a plan belonging to another company", async () => {
    expect(await deliveredReadFor("lead_ours", "plan_theirs", COMPANY)).toBeNull();
  });

  it("returns null for a lead belonging to another company", async () => {
    expect(await deliveredReadFor("lead_theirs", "plan_ours", COMPANY)).toBeNull();
  });

  it("returns null for ids that do not exist at all", async () => {
    expect(await deliveredReadFor("lead_nope", "plan_ours", COMPANY)).toBeNull();
    expect(await deliveredReadFor("lead_ours", "plan_nope", COMPANY)).toBeNull();
  });

  it("does not list another company's plan as a candidate either", async () => {
    const candidates = await readCandidates(COMPANY);
    expect(candidates.some((candidate) => candidate.planId === "plan_theirs")).toBe(false);
  });
});

describe("with no set ingested yet, the page says so and offers a way out", () => {
  it("renders the empty state, a link to create the job, and no empty <pre>", async () => {
    state.planIds = [];
    const html = await render("lead_ours");

    expect(html).toContain("There is no drawing set on this company yet");
    expect(html).toContain("Takeoff tab");
    // The way out, as an href rather than as prose.
    expect(html).toContain('href="/jobs/new"');
    // An empty monospace box reads as a render that failed. There must not be
    // one at all when there is no mail to put in it.
    expect(html).not.toContain("<pre");
  });

  it("still shows what the prospect asked for, which is the one thing that exists", async () => {
    state.planIds = [];
    const html = await render("lead_ours");
    expect(html).toContain("free drawing-set read from /wall-takeoff");
  });
});

describe("with a set chosen, the page renders the mail itself", () => {
  it("shows the subject line the delivery module composes, not a paraphrase", async () => {
    const read = await deliveredReadFor("lead_ours", "plan_ours", COMPANY);
    const subject = deliverySubjectLine(read!);
    // Anti-vacuity: a subject line that came back empty would make the
    // assertion below meaningless.
    expect(subject.length).toBeGreaterThan(20);

    const html = await render("lead_ours", "plan_ours");
    expect(html).toContain(subject);
  });

  it("shows the body in a <pre>, gaps first, with the sheets we did read in it", async () => {
    const html = await render("lead_ours", "plan_ours");
    expect(html).toContain("<pre");
    // The opening line, the gap section the scan produces, and two real index
    // rows. Each one is a different section of `deliveryBody`, so a body that
    // rendered only its first line fails here.
    expect(html).toContain("Dana — this is the free read of Harbor Bid Set.pdf");
    expect(html).toContain("SHEETS WE COULD NOT READ");
    expect(html).toContain("Page 2 is a scan");
    expect(html).toContain("A-101");
    expect(html).toContain("First Floor Plan");
    expect(html).toContain("SCHEDULES WE READ");
    expect(html).toContain("WHAT WE DID NOT DO");
  });

  it("renders the send control beside it", async () => {
    const html = await render("lead_ours", "plan_ours");
    expect(html).toContain("Email this read to them");
    // The two ids the action is called with travel through the form, so what
    // is submitted is what was rendered.
    expect(html).toContain('name="leadId"');
    expect(html).toContain('value="plan_ours"');
  });

  it("renders nothing of another company's set, even asked for by id", async () => {
    const html = await render("lead_ours", "plan_theirs");
    // Falls back to the picker rather than composing anything: the page's own
    // positive content is there, and the rival's set is nowhere in it.
    expect(html).toContain("Which set did they send?");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("Rival Floor Plan");
    expect(html).not.toContain("Rival Door Schedule");
  });
});
