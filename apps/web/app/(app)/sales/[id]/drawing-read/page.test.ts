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
 * ── WHAT THE FAKE IMPLEMENTS, AND WHAT IT STILL DOES NOT ──
 *
 * This header used to say, in as many words, that `orderBy` was deliberately
 * not implemented and "ordering cannot change any answer below". That was true
 * of the plan list and FALSE of the note query, whose `orderBy` decides which
 * note reaches "What they asked for" — so the clause that chose the single
 * most important string on this page was never exercised by anything, and it
 * shipped ordering by `occurredOn`, a column `sales.prisma` calls "Entered,
 * not stamped". A fake that silently ignores the clause under test is how that
 * reached a reviewer with seventeen green tests over it.
 *
 * So it implements `orderBy` now: a single object or an array of them, over
 * scalar and `Date` fields, `asc` and `desc`, on every `findMany` and inside
 * `include: { activities: … }` — which also honours that clause's own `where`
 * and `take`. A term naming a field the fixture row does not carry THROWS
 * rather than sorting by nothing, because a sort that silently becomes a no-op
 * is the failure mode this paragraph exists to describe.
 *
 * It still does NOT implement, and nothing below may rely on:
 *
 *   - `select`, anywhere. Every row comes back WHOLE, so a query that forgot
 *     to select a field it reads still passes here, and a field this fixture
 *     omits is `undefined` rather than an error. Only `include` is read.
 *   - any `where` operator beyond equality, `in`, `equals`, and one level of
 *     nested relation filter. `matches` throws on anything else rather than
 *     matching everything.
 *   - `orderBy` on a relation, by relation count, or with `nulls`.
 *   - `skip`, `distinct`, `cursor`, aggregates, or any write at all.
 *   - `_count`, except the one `sheetTexts` count `takeoffPlan.findMany`
 *     computes by hand below.
 *
 * The newest proposal per page winning is still `plan-ingest/`'s rule and is
 * still tested there; the fixture carries exactly ONE proposal per page, so
 * that ordering remains unable to change any answer here either way.
 */

const COMPANY = "co_operator";
const OTHER = "co_rival";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  role: "OWNER" as string,
  isProvaOperator: true,
  /** Emptied by the empty-state case. */
  planIds: ["plan_ours", "plan_theirs"] as string[],
  /** The reader's IANA zone, as `viewerTimeZone()` would resolve it from the
   *  `prova_tz` cookie. Moved by the upload-date cases below, which is the
   *  whole point of them — a page that hardcoded a zone would pass one of
   *  those two and fail the other. */
  timeZone: "America/Los_Angeles" as string,
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
 * The reader's timezone.
 *
 * Mocked rather than left real because the real one reads `cookies()` and
 * `headers()`, which THROW outside a request scope — `lib/viewerToday.ts`
 * catches that and returns "UTC", so an unmocked run would silently pin every
 * assertion below to UTC and the day-early bug under test is invisible in UTC.
 * That is the shape of a watcher whose needle is already on the page.
 */
vi.mock("@/lib/viewerToday", () => ({
  viewerTimeZone: async () => state.timeZone,
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

/**
 * THE TRAP THE NOTE QUERY HAS TO SURVIVE, built into `lead_ours`.
 *
 * Three activities. The intake note arrived FIRST (`createdAt` the 5th) and
 * carries the only copy of the contractor's Trade, Project, GC and Phone. The
 * job-walk note arrived LAST (`createdAt` the 8th) and is BACKDATED to the 1st
 * — the ordinary use of a column `sales.prisma` calls "Entered, not stamped",
 * and the thing `createSalesActivity` explicitly permits since it refuses only
 * future dates.
 *
 * So `occurredOn`-first ordering renders the job walk and `createdAt`-first
 * ordering renders the intake note, and the two are distinguishable in the
 * markup. They are listed here with the WRONG one first, so an array order
 * that happens to be right cannot stand in for a sort that is not.
 *
 * The CALL has the earliest `createdAt` of the three, which makes
 * `where: { type: "NOTE" }` load-bearing too: drop it and this is what the
 * section shows.
 */
const LEADS: Row[] = [
  {
    id: "lead_ours",
    companyId: COMPANY,
    companyName: "Harbor Drywall",
    contactName: "Dana Reyes",
    email: "dana@harbor.test",
    activities: [
      {
        id: "act_walk",
        type: "NOTE",
        occurredOn: new Date("2026-10-01T00:00:00.000Z"),
        createdAt: new Date("2026-10-08T16:20:00.000Z"),
        summary: "Met Dana at the Harborview job walk.",
      },
      {
        id: "act_intake",
        type: "NOTE",
        occurredOn: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T17:04:00.000Z"),
        summary:
          "Asked for a free drawing-set read from /wall-takeoff.\nTrade: Lath and plaster\nProject: Harbor Medical Fit-Out\nGC: Granite Builders\nPhone: 555-0133",
      },
      {
        id: "act_call",
        type: "CALL",
        occurredOn: new Date("2026-10-04T00:00:00.000Z"),
        createdAt: new Date("2026-10-04T09:00:00.000Z"),
        summary: "Left a voicemail asking them to send the set.",
      },
    ],
  },
  /** The control for the "there is more on the lead" line: one note, so that
   *  line must NOT appear. Without this the positive assertion could be
   *  satisfied by a page that prints it unconditionally. */
  {
    id: "lead_single",
    companyId: COMPANY,
    companyName: "Solo Plastering",
    contactName: "Ray Okoye",
    email: "ray@solo.test",
    activities: [
      {
        id: "act_solo",
        type: "NOTE",
        occurredOn: new Date("2026-10-06T00:00:00.000Z"),
        createdAt: new Date("2026-10-06T11:00:00.000Z"),
        summary: "Asked for a free drawing-set read from /wall-takeoff.\nTrade: Lath and plaster",
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
    /** 18:00 on the 7th in Los Angeles, which is the 8th in UTC. The upload
     *  date is `TakeoffPlan.createdAt`, a real instant, so this one row decides
     *  whether the picker tells an operator the truth about an evening upload.
     *  Deliberately an evening-west-of-UTC instant and not a tidy midday one —
     *  a midday instant renders the same day in every North American zone and
     *  would make the rendering untestable. */
    createdAt: new Date("2026-10-08T01:00:00.000Z"),
    job: { name: "Harbor Medical Fit-Out" },
  },
  {
    id: "plan_theirs",
    companyId: OTHER,
    fileName: "Rival Bid Set.pdf",
    createdAt: new Date("2026-10-09T01:00:00.000Z"),
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
    // `loadScheduleProposals` orders by `createdAt`, and the fake now honours
    // `orderBy` — a term naming a field a row does not carry throws, so these
    // have to be here rather than be absent and silently ignored.
    createdAt: new Date("2026-10-08T02:00:00.000Z"),
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
    createdAt: new Date("2026-10-09T02:00:00.000Z"),
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

type OrderBy = Row | Row[];

type FindMany = { where?: Row; orderBy?: OrderBy; take?: number };

/**
 * The comparable value of one field, or a throw.
 *
 * A `Date` compares by its instant; a number and a string compare as
 * themselves. ANYTHING ELSE — a field the fixture does not carry, a null, an
 * object — throws, for the reason the function below gives: an `orderBy` this
 * fake cannot honour has to be loud rather than silently become a no-op.
 * `nulls: "first" | "last"` is part of what is not implemented, so a nullable
 * column is refused rather than guessed at.
 */
function sortKey(row: Row, field: string): number | string {
  const value = row[field];
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "string") return value;
  throw new Error(
    `fake prisma: orderBy names \`${field}\`, which is ${
      field in row ? `${JSON.stringify(value)} on this row` : "not on this fixture's rows"
    } — add it to the fixture, or implement it here, rather than sorting by nothing`,
  );
}

/**
 * Prisma's `orderBy`, over scalar and `Date` fields, as one object or an array
 * of them. Sorts a COPY, because the fixture arrays above are shared between
 * every case in this file.
 *
 * THE THROWS ARE THE POINT, not defensiveness. A sort that quietly becomes a
 * no-op — a field this fixture never carried, a direction spelled some other
 * way — leaves every assertion downstream passing on an unordered list, which
 * is precisely the hole the defect this file now covers came through. An
 * unimplemented clause has to be loud.
 */
function applyOrderBy(rows: Row[], orderBy: OrderBy | undefined): Row[] {
  if (orderBy === undefined) return rows.slice();
  const terms = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((term) =>
    Object.entries(term).map(([field, direction]) => {
      if (direction !== "asc" && direction !== "desc") {
        throw new Error(
          `fake prisma: orderBy { ${field}: ${JSON.stringify(direction)} } is not asc/desc — ` +
            "this fake implements neither relation ordering nor `nulls`",
        );
      }
      return { field, sign: direction === "asc" ? 1 : -1 };
    }),
  );
  if (terms.length === 0) throw new Error("fake prisma: orderBy with no terms in it");
  return rows.slice().sort((a, b) => {
    for (const { field, sign } of terms) {
      const left = sortKey(a, field);
      const right = sortKey(b, field);
      if (left < right) return -sign;
      if (left > right) return sign;
    }
    return 0;
  });
}

function table(rows: Row[]) {
  return {
    findMany: async ({ where = {}, orderBy, take }: FindMany = {}) => {
      const found = applyOrderBy(
        rows.filter((row) => matches(row, where)),
        orderBy,
      );
      return take === undefined ? found : found.slice(0, take);
    },
    findUnique: async ({ where = {} }: { where?: Row } = {}) =>
      rows.find((row) => matches(row, where)) ?? null,
  };
}

/**
 * `salesLead.findUnique` with its nested note clause honoured.
 *
 * The page reads ONE lead and asks for its notes `where: { type: "NOTE" }`,
 * `orderBy` arrival, `take: 2`. All three of those decide what reaches the
 * screen, so all three run here. `deliveredReadFor` calls the same method with
 * `select` and no `include`, which falls through to the whole row exactly as
 * it did before.
 */
const salesLead = {
  findUnique: async ({ where = {}, include }: { where?: Row; include?: Row } = {}) => {
    const lead = LEADS.find((row) => matches(row, where)) ?? null;
    if (lead === null) return null;
    const clause = include?.activities as FindMany | undefined;
    if (clause === undefined) return lead;
    const kept = applyOrderBy(
      (lead.activities as Row[]).filter((activity) => matches(activity, clause.where ?? {})),
      clause.orderBy,
    );
    return {
      ...lead,
      activities: clause.take === undefined ? kept : kept.slice(0, clause.take),
    };
  },
};

vi.mock("@prova/db", () => ({
  prisma: {
    salesLead,
    takeoffPlan: {
      findUnique: table(PLANS).findUnique,
      findMany: async ({ where = {}, orderBy, take }: FindMany = {}) => {
        const found = applyOrderBy(
          PLANS.filter(
            (plan) => matches(plan, where) && state.planIds.includes(plan.id as string),
          ),
          // The page's own `orderBy` now decides this rather than a hand-rolled
          // sort that agreed with it by coincidence.
          orderBy,
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
  state.timeZone = "America/Los_Angeles";
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
    expect(candidates[0].uploadedAt.toISOString()).toBe("2026-10-08T01:00:00.000Z");
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

describe("'What they asked for' shows the note that ARRIVED first", () => {
  /**
   * THE FIXTURE'S OWN CONTROL, and it runs first on purpose.
   *
   * Every assertion in this block is worthless if `lead_ours` does not
   * actually contain the disagreement it is supposed to: two notes where the
   * backdated one has the EARLIER `occurredOn` and the LATER `createdAt`. A
   * fixture that lost that property would leave the rest of this block green
   * about nothing, which is this repo's most repeated failure. So the property
   * is asserted rather than assumed.
   */
  it("really does contain the trap: the backdated note is earlier by date and later by arrival", () => {
    const notes = (
      LEADS.find((lead) => lead.id === "lead_ours")!.activities as Row[]
    ).filter((activity) => activity.type === "NOTE");
    expect(notes).toHaveLength(2);

    const intake = notes.find((note) => note.id === "act_intake")!;
    const walk = notes.find((note) => note.id === "act_walk")!;

    // Backdated: earlier business date, later arrival. Both halves, because
    // either one alone makes the two orderings agree and the test vacuous.
    expect((walk.occurredOn as Date).getTime()).toBeLessThan(
      (intake.occurredOn as Date).getTime(),
    );
    expect((walk.createdAt as Date).getTime()).toBeGreaterThan(
      (intake.createdAt as Date).getTime(),
    );
  });

  /**
   * THE DEFECT ITSELF. Red against `orderBy: [{ occurredOn: "asc" }, …]`,
   * which is what this page shipped: the job-walk note wins on `occurredOn`
   * and the intake note — the only record of the Trade, Project, GC and Phone
   * — never reaches the screen.
   */
  it("renders the intake note, not the follow-up somebody backdated in front of it", async () => {
    const html = await render("lead_ours");

    // The intake note, by the four facts that exist nowhere else on this lead.
    expect(html).toContain("free drawing-set read from /wall-takeoff");
    expect(html).toContain("Project: Harbor Medical Fit-Out");
    expect(html).toContain("GC: Granite Builders");
    expect(html).toContain("Phone: 555-0133");

    // And the note that outranked it under the old ordering is not what the
    // section is showing. Paired with the positives above, so this cannot pass
    // on a section that rendered nothing at all.
    expect(html).not.toContain("Harborview job walk");
  });

  /** `where: { type: "NOTE" }` is load-bearing: `act_call` has the earliest
   *  `createdAt` of the three, so dropping that filter shows the voicemail. */
  it("does not reach past the notes to an earlier activity of another type", async () => {
    const html = await render("lead_ours");
    expect(html).toContain("free drawing-set read from /wall-takeoff");
    expect(html).not.toContain("Left a voicemail");
  });

  it("names which note it is showing, and says when it is not the only one", async () => {
    const html = await render("lead_ours");
    expect(html).toContain("The first note on this lead, dated 2026-10-05.");
    // The hint the defect was missing: the follow-up is not on screen, but the
    // operator is told something else is written down.
    expect(html).toContain("There is more written on the lead since");
  });

  /** The control for that hint. A page printing it unconditionally would pass
   *  the case above and fail this one. */
  it("does not claim there is more on a lead that has only the one note", async () => {
    const html = await render("lead_single");
    expect(html).toContain("The first note on this lead, dated 2026-10-06.");
    expect(html).not.toContain("There is more written on the lead since");
  });
});

describe("the upload date is an instant, not a UTC calendar day", () => {
  /**
   * `plan_ours` was uploaded at 2026-10-08T01:00:00Z — 18:00 on the SEVENTH in
   * Los Angeles. `toIsoDate` printed that as "uploaded 2026-10-08", a day the
   * operator who did the uploading had not reached yet, on the one control
   * whose stated job is telling two uploads of the same job apart.
   */
  it("lists an evening-Pacific upload on the day it happened there", async () => {
    state.timeZone = "America/Los_Angeles";
    const html = await render("lead_ours");

    expect(html).toContain("uploaded Oct 7, 2026");
    // The two spellings of the bug: the raw ISO day `toIsoDate` produced, and
    // the same wrong day formatted. Paired with the positive above.
    expect(html).not.toContain("2026-10-08");
    expect(html).not.toContain("Oct 8, 2026");
  });

  /**
   * The same row read from UTC, which is `viewerTimeZone()`'s own fallback and
   * therefore the behaviour of a first visit before the `prova_tz` cookie
   * lands. It must say the 8th — a page that simply hardcoded "America/
   * Los_Angeles" would pass the case above and fail this one, and so would a
   * page that happened to subtract a day.
   */
  it("follows the reader's zone rather than pinning one", async () => {
    state.timeZone = "UTC";
    const html = await render("lead_ours");

    expect(html).toContain("uploaded Oct 8, 2026");
    expect(html).not.toContain("Oct 7, 2026");
  });

  /** East of UTC the instant is already the 8th, so this is the third
   *  distinct answer from one stored value — which is what "it is an instant"
   *  means in practice. */
  it("gives a reader in Tokyo their own day for the same instant", async () => {
    state.timeZone = "Asia/Tokyo";
    const html = await render("lead_ours");
    expect(html).toContain("uploaded Oct 8, 2026");
  });

  /** The intake note's `occurredOn` is the opposite case and must NOT move
   *  with the reader: it is an entered calendar day stored at UTC midnight. */
  it("leaves the entered note date alone in every zone", async () => {
    state.timeZone = "America/Los_Angeles";
    expect(await render("lead_ours")).toContain("dated 2026-10-05.");
    state.timeZone = "Asia/Tokyo";
    expect(await render("lead_ours")).toContain("dated 2026-10-05.");
  });
});
