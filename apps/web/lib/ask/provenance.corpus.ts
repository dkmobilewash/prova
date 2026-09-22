import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";

/**
 * LEGITIMATE ANSWERS. Every number in every one of these came out of the
 * tool result beside it or out of the person's own question, so the guard
 * must pass all of them — and the count of how many it would have BLOCKED
 * is the number this whole change is judged on.
 *
 * A guard that refuses good answers gets turned off within a week, so this
 * file is the measurement rather than a formality. `provenanceCorpus.test.ts`
 * runs `checkNumberProvenance` over every entry and fails the build if a
 * single one is refused, printing which figure and what the sources offered.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL IN HERE AND WHAT IS WRITTEN BY HAND, because the difference
 * is the whole evidential value of the file.
 *
 * REAL, and therefore incapable of flattering the guard:
 *
 *   - THE QUESTIONS. Taken verbatim from `eval/top-questions.ts`, the
 *     hundred-question census, and the test asserts that they still appear
 *     there — so a question cannot be quietly reworded to suit the matcher.
 *   - THE SERIALIZATION. The test builds each tool's text with
 *     `toolResultContent` from `answer.ts`, the same function the executor
 *     calls, so the bytes here are the bytes the model is handed: rows
 *     capped by `forModel`, the count prepended, the summary merged in.
 *   - THE FORMATTING. Money is rendered by `lib/money.ts` and hours by
 *     `lib/render-hours.ts` — the app's own formatters, called on the very
 *     numbers sitting in the payload. So "does `$1,173.70` reconcile with
 *     `1173.7`" is answered by the real formatter and not by my idea of
 *     what it emits. Writing the string out by hand would have tested the
 *     matcher against a guess.
 *
 * HAND-WRITTEN, and said so: the tool payloads (shaped from the handlers in
 * `handlers.ts` — the field names and types are theirs) and the answer
 * prose. There are no production transcripts of this box yet, the same
 * caveat `cases.ts` and `top-questions.ts` both carry. **An answer that
 * reads wrong to Cyrus is wrong**, and so is the verdict on it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE ENTRIES ARE CHOSEN TO STRESS. Not a sample of typical answers —
 * a sample of the shapes that break a naive matcher:
 *
 *   - thousands separators and trailing zeros ($1,173.70 from 1173.7);
 *   - a legitimate rounding ("about $47" from 46.95) on the passing side of
 *     the boundary;
 *   - floating-point hour sums (35.300000000000004 rendered "35.3");
 *   - percentages, which handlers return ALREADY FORMATTED as strings;
 *   - dates in three spellings — ISO, slashed, and "September 8";
 *   - identifiers that are not quantities: invoice and pay-app numbers,
 *     an OSHA case number, a union local, a phone number, a sheet size;
 *   - a number the PERSON typed and the answer repeated;
 *   - a tool's `unavailable` sentence quoted back;
 *   - answers with no numbers, and answers with no tool call at all.
 */

export type CorpusTool = {
  /** Shaped from the handler that really returns it. */
  data: unknown;
  summary?: Record<string, number>;
};

export type CorpusEntry = {
  id: string;
  /** Verbatim from `eval/top-questions.ts` unless `ownWords` says otherwise. */
  question: string;
  /** Set when the question is not in the census — a follow-up, or a phrasing
   * the census does not carry. The test then skips the verbatim check for
   * this entry and counts how many it skipped, so the exemption cannot grow
   * silently. */
  ownWords?: true;
  tools: CorpusTool[];
  answer: string;
  /** One line on what this entry is here to stress. */
  stresses: string;
};

/** A floating-point sum of `Decimal(5,2)` hours, the exact value
 * `render-hours.ts` was written for: 7 + 7 + 7 + 7.1 + 7.2. */
const AWKWARD_HOURS = 7 + 7 + 7 + 7.1 + 7.2;

export const PROVENANCE_CORPUS: CorpusEntry[] = [
  {
    id: "receivables-cents",
    question: "who owes us money right now?",
    tools: [
      {
        data: [
          {
            invoice: 5,
            job: "Maple Street",
            gc: "Turner",
            amount: 45000,
            paid: 10000,
            retainageWithheld: 5000,
            outstanding: 30000,
            dueOn: "2026-07-31",
            dueFromTerms: false,
            daysOverdue: 42,
          },
          {
            invoice: 7,
            job: "Riverside Medical",
            gc: "Acme GC",
            amount: 1173.7,
            paid: 0,
            retainageWithheld: 0,
            outstanding: 1173.7,
            dueOn: "2026-09-08",
            dueFromTerms: true,
            daysOverdue: 6,
          },
        ],
        summary: { outstandingInvoiceCount: 2, overdueInvoiceCount: 2, notYetDueInvoiceCount: 0 },
      },
    ],
    answer: [
      "2 invoices are past due.",
      "",
      `• Turner, Maple Street — ${money(30000)} outstanding, 42 days overdue`,
      `• Acme GC, Riverside Medical — ${money(1173.7)} outstanding, 6 days overdue (due date derived from terms)`,
    ].join("\n"),
    stresses: "thousands separators, a trailing-zero cent figure from 1173.7, a count from the summary",
  },
  {
    id: "receivables-rounded",
    question: "is Turner late on anything?",
    ownWords: true,
    tools: [
      {
        data: [
          {
            invoice: 9,
            job: "Cedar Park",
            gc: "Turner",
            amount: 46.95,
            paid: 0,
            retainageWithheld: 0,
            outstanding: 46.95,
            dueOn: "2026-09-01",
            dueFromTerms: false,
            daysOverdue: 21,
          },
        ],
        summary: { outstandingInvoiceCount: 1, overdueInvoiceCount: 1, notYetDueInvoiceCount: 0 },
      },
    ],
    answer: "Turner is 21 days late on one invoice — about $47 on Cedar Park.",
    stresses: "the legitimate rounding: 46.95 said as 47, on the passing side of the half-unit window",
  },
  {
    id: "receivables-nothing",
    question: "what have we let slip past its date?",
    tools: [{ data: [], summary: { outstandingInvoiceCount: 0, overdueInvoiceCount: 0, notYetDueInvoiceCount: 0 } }],
    answer: "Nothing is overdue. Every invoice raised has been paid in full.",
    stresses: "an answer with no numbers at all, from a tool that returned none",
  },
  {
    id: "retainage-total",
    question: "how much of our money is being held in retainage?",
    tools: [
      {
        data: [
          { job: "Riverside Medical", gc: "Turner", held: 84250.5, releasable: 0 },
          { job: "Cedar Park", gc: "Halvorsen", held: 18400, releasable: 18400 },
        ],
        summary: { jobsWithRetainage: 2, totalHeld: 102650.5, totalReleasable: 18400 },
      },
    ],
    answer: [
      `${money(102650.5)} is being held across 2 jobs.`,
      "",
      `• Turner, Riverside Medical — ${money(84250.5)} held`,
      `• Halvorsen, Cedar Park — ${money(18400)} held, all of it releasable now`,
    ].join("\n"),
    stresses: "a six-figure money total with cents, and the same figure appearing twice",
  },
  {
    id: "retainage-collect",
    question: "which retainage can we actually go and collect now?",
    tools: [
      {
        data: [{ job: "Cedar Park", gc: "Halvorsen", held: 18400, releasable: 18400, substantialCompletionOn: "2026-06-30" }],
        summary: { jobsWithRetainage: 1, totalHeld: 18400, totalReleasable: 18400 },
      },
    ],
    answer: `Cedar Park only — ${money(18400)}, substantially complete since 2026-06-30. Halvorsen has had it since then.`,
    stresses: "an ISO date written back exactly as the tool gave it",
  },
  {
    id: "labor-awkward-hours",
    question: "what has the crew cost us on Riverside?",
    tools: [
      {
        data: [
          {
            job: "Riverside Medical",
            gc: "Turner",
            hoursLogged: AWKWARD_HOURS,
            hoursPriced: AWKWARD_HOURS,
            burdenedLaborCost: 3218.44,
            wageCost: 2410.5,
            allowanceCost: 807.94,
            shareOfHoursPriced: "100%",
          },
        ],
        summary: { jobsWithHours: 1, hoursLogged: AWKWARD_HOURS, hoursNotPriced: 0, burdenedLaborCost: 3218.44 },
      },
    ],
    answer: `${formatHours(AWKWARD_HOURS)} hours on Riverside, ${money(3218.44)} burdened. All of it priced.`,
    stresses: "a floating-point hour sum rendered by the app's own formatter, and a 100% share",
  },
  {
    id: "labor-partly-unpriced",
    question: "which jobs are losing money?",
    ownWords: true,
    tools: [
      {
        data: [
          {
            job: "Maple Street",
            gc: "Turner",
            hoursLogged: 412.5,
            hoursPriced: 330,
            burdenedLaborCost: 28104.12,
            wageCost: 26500,
            allowanceCost: 1604.12,
            shareOfHoursPriced: "80%",
          },
        ],
        summary: { jobsWithHours: 1, hoursLogged: 412.5, hoursNotPriced: 82.5, burdenedLaborCost: 28104.12 },
      },
    ],
    answer: `Maple Street: ${money(28104.12)} burdened over ${formatHours(412.5)} hours, 80% of them priced. ${formatHours(82.5)} hours have no rate against them.`,
    stresses: "a percentage the handler pre-formatted as a string, and two hour figures",
  },
  {
    id: "margin-percent",
    question: "how is Riverside doing against what we bid it at?",
    tools: [
      {
        data: [
          {
            job: "Riverside Medical",
            contractValue: 1250000,
            costToDate: 512400.25,
            percentComplete: "41.0%",
            overbilledBy: 18250,
            estimatedCostAtCompletion: 1180000,
          },
        ],
        summary: { jobs: 1 },
      },
    ],
    answer: `Riverside is 41.0% complete on a ${money(1250000)} contract — ${money(512400.25)} of cost in, overbilled by ${money(18250)}.`,
    stresses: "a seven-figure money value and a percentage with a decimal place",
  },
  {
    id: "safety-record",
    question: "how many recordable injuries have we had this year?",
    tools: [
      {
        data: {
          year: 2026,
          cases: [
            { caseNumber: "2026-03", recordable: true, daysAway: 4, occurredOn: "2026-04-11" },
            { caseNumber: "2026-07", recordable: true, daysAway: 0, occurredOn: "2026-08-02" },
          ],
        },
        summary: { recordableCases: 2, daysAway: 4, toolboxTalks: 19 },
      },
    ],
    answer: "2 recordable cases in 2026, 4 days away between them. Cases 2026-03 and 2026-07.",
    stresses: "a year as a figure, and OSHA case numbers as identifiers",
  },
  {
    id: "safety-days-away",
    question: "how many days away have we lost this year?",
    tools: [
      {
        data: { year: 2026, cases: [{ caseNumber: "2026-03", recordable: true, daysAway: 4, occurredOn: "2026-04-11" }] },
        summary: { recordableCases: 1, daysAway: 4, toolboxTalks: 19 },
      },
    ],
    answer: "4 days away this year, all from case 2026-03 on 2026-04-11.",
    stresses: "an ISO date and a case number in one sentence",
  },
  {
    id: "certs-expiring",
    question: "whose cards are about to expire?",
    tools: [
      {
        data: {
          withinDays: 30,
          rows: [
            { person: "Mike Alvarez", certification: "OSHA 30", expiresOn: "2026-10-04", daysLeft: 12 },
            { person: "Dan Petrie", certification: "Scissor lift", expiresOn: "2026-09-28", daysLeft: 6 },
          ],
        },
        summary: { expiringWithin30Days: 2, alreadyExpired: 0 },
      },
    ],
    answer: [
      "2 cards expire in the next 30 days.",
      "",
      "• Dan Petrie — scissor lift, 6 days left (2026-09-28)",
      "• Mike Alvarez — OSHA 30, 12 days left (2026-10-04)",
    ].join("\n"),
    stresses: "a wrapper object with rows, a window the tool chose, and OSHA 30 as a bare figure",
  },
  {
    id: "contact-phone",
    question: "what's the number for the PM at Halvorsen?",
    tools: [
      {
        data: [{ name: "Ruth Kessler", company: "Halvorsen Builders", role: "Project manager", phone: "555-0142", email: "ruth@halvorsen.example" }],
        summary: { matches: 1 },
      },
    ],
    answer: "Ruth Kessler, project manager at Halvorsen Builders — 555-0142.",
    stresses: "a phone number, which is an identifier and not a quantity",
  },
  {
    id: "rfis-open",
    question: "what am I waiting on answers for?",
    tools: [
      {
        data: [
          { number: 14, job: "Riverside Medical", subject: "Door schedule conflict at 2B", sentOn: "2026-08-20", dueBack: "2026-08-27", daysLate: 26 },
          { number: 15, job: "Maple Street", subject: "Head-of-wall detail", sentOn: "2026-09-10", dueBack: "2026-09-17", daysLate: 5 },
        ],
        summary: { openRfis: 2, pastDueBack: 2 },
      },
    ],
    answer: [
      "2 RFIs are past their due-back date.",
      "",
      "• RFI 14, Riverside — door schedule at 2B, 26 days late",
      "• RFI 15, Maple Street — head-of-wall detail, 5 days late",
    ].join("\n"),
    stresses: "RFI numbers, a grid reference (2B), and day counts in one answer",
  },
  {
    id: "punch-list",
    question: "what's left on the punch list at Riverside?",
    tools: [
      {
        data: [
          { item: "Patch corner bead at 2B", location: "Level 2", raisedOn: "2026-09-12" },
          { item: "Re-tape head of wall at 3A", location: "Level 3", raisedOn: "2026-09-12" },
          { item: "Touch up level 4 lid", location: "Level 4", raisedOn: "2026-09-15" },
        ],
        summary: { openItems: 3 },
      },
    ],
    answer: [
      "3 open on Riverside.",
      "",
      "• Patch corner bead at 2B — level 2",
      "• Re-tape head of wall at 3A — level 3",
      "• Touch up level 4 lid",
    ].join("\n"),
    stresses: "grid references and level numbers that are labels, not quantities",
  },
  {
    id: "deliveries",
    question: "did the board show up at Riverside?",
    tools: [
      {
        data: [
          { material: "5/8 type X", ordered: 200, delivered: 200, promisedOn: "2026-09-19", deliveredOn: "2026-09-19" },
          { material: "Corner bead", ordered: 40, delivered: 0, promisedOn: "2026-09-24", deliveredOn: null },
        ],
        summary: { ordersOnJob: 2, fullyDelivered: 1, outstanding: 1 },
      },
    ],
    answer: "Yes — all 200 sheets of 5/8 type X landed on 2026-09-19. 40 lengths of corner bead are still promised for 2026-09-24.",
    stresses: "a sheet size written as a fraction, and two quantities against two dates",
  },
  {
    id: "equipment",
    question: "where is the scissor lift?",
    tools: [
      {
        data: [{ asset: "Genie GS-1930", assignedJob: "Riverside Medical", assignedOn: "2026-09-02" }],
        summary: { machines: 1, unassigned: 0 },
      },
    ],
    answer: "The Genie GS-1930 is assigned to Riverside Medical, since 2026-09-02. That is a booking, not a position — there is no GPS on it.",
    stresses: "a model number with digits inside a word, and the assignment caveat",
  },
  {
    id: "fringes",
    question: "what do we owe the funds this month?",
    tools: [
      {
        data: {
          month: "2026-09",
          locals: [
            { local: "213", hours: 640.25, owed: 12805 },
            { local: "104", hours: 88, owed: 1760 },
          ],
        },
        summary: { totalHours: 728.25, totalOwed: 14565, unpricedHours: 0 },
      },
    ],
    answer: [
      `${money(14565)} due to the funds for 2026-09.`,
      "",
      `• Local 213 — ${formatHours(640.25)} hours, ${money(12805)}`,
      `• Local 104 — ${formatHours(88)} hours, ${money(1760)}`,
    ].join("\n"),
    stresses: "union local numbers as identifiers beside hours and money for the same row",
  },
  {
    id: "ratio",
    question: "are we in ratio?",
    tools: [
      {
        data: { month: "2026-09", locals: [{ local: "213", journeymanHours: 520, apprenticeHours: 120.25, requiredRatio: "1:5", inRatio: true }] },
        summary: { localsChecked: 1, localsOutOfRatio: 0, worstExcessHours: 0 },
      },
    ],
    answer: `In ratio for 2026-09. Local 213 ran ${formatHours(520)} journeyman hours against ${formatHours(120.25)} apprentice, inside the 1:5 requirement.`,
    stresses: "a ratio written with a colon, which is an identifier and not two quantities",
  },
  {
    id: "emr",
    question: "what's our mod rate this year?",
    tools: [{ data: { year: 2026, experienceModRate: 0.92, bureau: "NCCI", effectiveOn: "2026-01-01" }, summary: { onFile: 1 } }],
    answer: "0.92 for 2026, from NCCI, effective 2026-01-01.",
    stresses: "a sub-one decimal rate, where a stray 100x would be invisible to a reader",
  },
  {
    id: "bids-out",
    question: "what bids have we got out?",
    tools: [
      {
        data: [
          { project: "Northgate Apartments", gc: "Skanska", dueOn: "2026-10-03", value: 875000 },
          { project: "Harbor Point", gc: "Turner", dueOn: "2026-10-17", value: 240500 },
        ],
        summary: { openBids: 2, dueThisWeek: 0 },
      },
    ],
    answer: [
      "2 bids out.",
      "",
      `• Northgate Apartments, Skanska — ${money(875000)}, due 10/3`,
      `• Harbor Point, Turner — ${money(240500)}, due 10/17`,
    ].join("\n"),
    stresses: "slashed dates written back from ISO dates, which is the spelling a person reads",
  },
  {
    id: "vendor-quote",
    question: "what did we get quoted for 5/8 type X?",
    tools: [
      {
        data: [
          { item: "5/8 type X", vendor: "Allied Building", unitPrice: 14.2, unit: "sheet", quotedOn: "2026-08-14", expiresOn: "2026-10-14" },
        ],
        summary: { quotes: 1, expired: 0 },
      },
    ],
    answer: `Allied Building quoted ${money(14.2)} a sheet on 2026-08-14. Good until 2026-10-14.`,
    stresses: "a unit price whose formatter adds a cent digit the payload does not carry",
  },
  {
    id: "schedule-days",
    question: "how many days have we got left on Riverside?",
    tools: [
      {
        data: { job: "Riverside Medical", startOn: "2026-05-04", endOn: "2026-11-30", daysRemaining: 69, scheduleElapsedPercent: 67 },
        summary: { jobs: 1 },
      },
    ],
    answer: "69 days left on Riverside — it runs to 2026-11-30, and 67% of the window has gone.",
    stresses: "a whole-number percentage beside a day count and a date",
  },
  {
    id: "crew",
    question: "who is assigned to Riverside?",
    tools: [
      {
        data: [
          { person: "Mike Alvarez", craft: "Drywall finisher" },
          { person: "Dan Petrie", craft: "Framer" },
          { person: "Luis Roman", craft: "Framer" },
        ],
        summary: { assigned: 3 },
      },
    ],
    answer: "3 assigned: Mike Alvarez (drywall finisher), Dan Petrie and Luis Roman (framers). That is the roster, not who turned up.",
    stresses: "a bare count with names and no other figures",
  },
  {
    id: "payapp",
    question: "where is our last pay application sitting?",
    tools: [
      {
        data: [
          { payApplication: 4, job: "Riverside Medical", gc: "Turner", submittedOn: "2026-08-31", status: "SUBMITTED", daysWithGc: 22, amount: 214500 },
        ],
        summary: { open: 1, disputed: 0 },
      },
    ],
    answer: `Pay app 4 on Riverside — ${money(214500)}, with Turner 22 days, submitted 2026-08-31.`,
    stresses: "a pay-application number that is a label sitting next to a day count that is not",
  },
  {
    id: "change-orders",
    question: "what change orders is the GC sitting on?",
    tools: [
      {
        data: [
          { changeOrder: 3, job: "Riverside Medical", gc: "Turner", amount: 42100.75, submittedOn: "2026-07-22", status: "PENDING" },
          { changeOrder: 4, job: "Riverside Medical", gc: "Turner", amount: 6800, submittedOn: "2026-09-01", status: "PENDING" },
        ],
        summary: { pending: 2, pendingValue: 48900.75 },
      },
    ],
    answer: `Turner is sitting on 2, worth ${money(48900.75)}. CO 3 at ${money(42100.75)} since 2026-07-22; CO 4 at ${money(6800)} since 2026-09-01.`,
    stresses: "a total that is also in the summary, and change-order numbers beside money",
  },
  {
    id: "backcharges",
    question: "what is Turner charging back to us?",
    tools: [
      {
        data: [{ job: "Riverside Medical", gc: "Turner", claimed: 3450, objectionDueOn: "2026-09-30", daysToObject: 8 }],
        summary: { open: 1, claimedTotal: 3450 },
      },
    ],
    answer: `${money(3450)} on Riverside. 8 days left to object — the deadline is 2026-09-30.`,
    stresses: "a four-figure money value that also appears as a summary total",
  },
  {
    id: "compliance-licence",
    question: "when does our contractor licence come up for renewal?",
    tools: [
      {
        data: [{ kind: "Contractor licence", reference: "NV 0079412", expiresOn: "2027-02-28", daysLeft: 159 }],
        summary: { onFile: 1, expiringWithin60Days: 0, expired: 0 },
      },
    ],
    answer: "Licence NV 0079412 runs to 2027-02-28 — 159 days off.",
    stresses: "a licence number with a leading zero, which is a literal and not a value",
  },
  {
    id: "aging-user-number",
    question: "how much of what we're owed is more than 60 days out?",
    tools: [
      {
        data: {
          buckets: [
            { bucket: "0-30", amount: 41000 },
            { bucket: "31-60", amount: 12500 },
            { bucket: "61-90", amount: 30000 },
          ],
        },
        summary: { totalOutstanding: 83500 },
      },
    ],
    answer: `${money(30000)} sits past 60 days, out of ${money(83500)} owed.`,
    stresses: "the person's own 60 coming back in the answer, and bucket labels with a dash",
  },
  {
    id: "email-landed",
    question: "did that lien waiver email actually reach them?",
    tools: [
      {
        data: [{ subject: "Conditional lien waiver — Riverside", to: "ruth@halvorsen.example", sentOn: "2026-09-18", status: "DELIVERED" }],
        summary: { sent: 1, bounced: 0 },
      },
    ],
    answer: "Delivered on 2026-09-18 to ruth@halvorsen.example. Nothing has bounced.",
    stresses: "an answer whose only digits are a date, plus a zero from the summary spelled in words",
  },
  {
    id: "drawings",
    question: "am I building off the latest sheet on Riverside?",
    tools: [
      {
        data: [{ sheet: "A-201", currentRevision: 4, revisionIssuedOn: "2026-09-15", received: false }],
        summary: { sheets: 1, notReceived: 1 },
      },
    ],
    answer: "No. A-201 revision 4 was issued 2026-09-15 and is not in hand. That is a live risk, not a pending delivery.",
    stresses: "a sheet number with a dash and a revision number, side by side",
  },
  {
    id: "estimate-detail",
    question: "what's in the Northgate estimate?",
    tools: [
      {
        data: [
          { line: "5/8 type X board", quantity: 1200, unit: "sheet", unitPrice: 14.2, extended: 17040 },
          { line: "Metal stud 3-5/8", quantity: 4800, unit: "lf", unitPrice: 2.05, extended: 9840 },
        ],
        summary: { lines: 2, total: 26880 },
      },
    ],
    answer: [
      `2 lines, ${money(26880)}.`,
      "",
      `• 1200 sheets of 5/8 type X at ${money(14.2)} — ${money(17040)}`,
      `• 4800 lf of 3-5/8 stud at ${money(2.05)} — ${money(9840)}`,
    ].join("\n"),
    stresses: "quantities, unit prices and extensions together, with fractional sizes in the line names",
  },
  {
    id: "field-report",
    question: "what happened on Riverside yesterday?",
    tools: [
      {
        data: [
          { reportedOn: "2026-09-21", crewSize: 6, work: "Hung board on level 2", delayHours: 3, delayReason: "Hoist down" },
        ],
        summary: { reports: 1, withDelays: 1 },
      },
    ],
    answer: "Crew of 6 hung board on level 2. The hoist was down 3 hours — that is the only delay written up on 2026-09-21.",
    stresses: "a crew size, a delay in hours and a level number in one sentence",
  },
  {
    id: "gc-relationship",
    question: "is our master agreement with Turner still current?",
    tools: [
      {
        data: [{ gc: "Turner", masterAgreementExpiresOn: "2026-12-31", prequalExpiresOn: "2026-10-09", openJobs: 2 }],
        summary: { gcs: 1, lapsed: 0 },
      },
    ],
    answer: "Yes, to 2026-12-31. The prequal is the tighter one — it lapses 2026-10-09, and we have 2 jobs open with them.",
    stresses: "two dates and a small count with no money anywhere",
  },
  {
    id: "intake",
    question: "what came in this week that nobody has filed yet?",
    tools: [{ data: [{ fileName: "Turner-COI-2026.pdf", arrivedOn: "2026-09-19", filed: false }], summary: { unfiled: 1 } }],
    answer: "1 — Turner-COI-2026.pdf, in since 2026-09-19.",
    stresses: "a year inside a file name, which is a literal the model copied",
  },
  {
    id: "lien",
    question: "when does our lien deadline run out on Riverside?",
    tools: [
      {
        data: [{ job: "Riverside Medical", kind: "Preliminary notice", deadlineOn: "2026-10-20", daysLeft: 28, enteredBy: "Cyrus" }],
        summary: { deadlines: 1, within30Days: 1 },
      },
    ],
    answer: "2026-10-20 for the preliminary notice — 28 days. That date was typed in, not worked out here.",
    stresses: "the app's rule that it never computes a legal date, said next to the date",
  },
  {
    id: "warranty",
    question: "are we still on the hook for Cedar Park?",
    tools: [
      {
        data: [{ job: "Cedar Park", substantialCompletionOn: "2026-06-30", warrantyMonths: 12, warrantyEndsOn: "2027-06-30", inForce: true }],
        summary: { jobs: 1, inForce: 1 },
      },
    ],
    answer: "Yes — 12 months from 2026-06-30, so it runs to 2027-06-30.",
    stresses: "a duration in months beside the two dates it sits between",
  },
  {
    id: "missing-hours",
    question: "whose hours haven't been turned in for last week?",
    tools: [
      {
        data: [
          { person: "Luis Roman", plannedDays: 4, daysWithNoHours: 2 },
          { person: "Dan Petrie", plannedDays: 5, daysWithNoHours: 1 },
        ],
        summary: { people: 2, plannedDaysWithNoHours: 3 },
      },
    ],
    answer: "3 planned days have no hours against them: Luis Roman 2 of 4, Dan Petrie 1 of 5. Nobody logged them — it does not say they were absent.",
    stresses: "several single-digit counts in one line, the weakest case for this guard",
  },
  {
    id: "certified-payroll",
    question: "is certified payroll in for last week on Riverside?",
    tools: [
      {
        data: { weekEnding: "2026-09-19", job: "Riverside Medical", submitted: false, workers: 8, hours: 312.5 },
        summary: { weeks: 1, outstanding: 1 },
      },
    ],
    answer: `Not yet. Week ending 2026-09-19 has 8 workers and ${formatHours(312.5)} hours on it, unsubmitted.`,
    stresses: "an hour total with a half, rendered by the app's own formatter",
  },
  {
    id: "cash-flow",
    question: "what's coming in next month?",
    tools: [
      {
        data: { month: "2026-10", rows: [{ gc: "Turner", expected: 214500, dueOn: "2026-10-15" }, { gc: "Halvorsen", expected: 18400, dueOn: "2026-10-28" }] },
        summary: { expectedTotal: 232900 },
      },
    ],
    answer: `${money(232900)} expected in 2026-10 — ${money(214500)} from Turner on 10/15, ${money(18400)} from Halvorsen on 10/28.`,
    stresses: "a month written as a year-month, and slashed dates derived from ISO ones",
  },
  {
    id: "unavailable-quoted",
    question: "what's left to set up on my account?",
    tools: [{ data: { unavailable: "No invoices raised yet. Once a job is billed, what each GC still owes shows up here, longest overdue first." } }],
    answer: "No invoices raised yet. Once a job is billed, what each GC still owes shows up here, longest overdue first.",
    stresses: "a tool's own sentence quoted back verbatim",
  },
  {
    id: "no-tool-capability",
    question: "are those prices still good or have they run out?",
    ownWords: true,
    tools: [],
    answer: "There are no purchase orders here. I can record a material order against a job and log its deliveries.",
    stresses: "the capability answer the prompt requires, with no tool call and no numbers",
  },
  {
    id: "no-tool-clarify",
    question: "how much is Turner still holding on Riverside?",
    ownWords: true,
    tools: [],
    answer: "Which Riverside — Riverside Medical or Riverside Commons?",
    stresses: "a clarifying question, which is an answer built from no data at all",
  },
  {
    id: "dispute",
    question: "is anything we billed in dispute?",
    tools: [
      {
        data: [{ payApplication: 3, job: "Maple Street", gc: "Turner", disputedAmount: 7250.4, disputedOn: "2026-09-04", reason: "Backcharge offset" }],
        summary: { open: 3, disputed: 1 },
      },
    ],
    answer: `One — pay app 3 on Maple Street, ${money(7250.4)} held back since 2026-09-04 against a backcharge offset.`,
    stresses: "a money figure with one decimal in the payload and two on screen",
  },
];

/**
 * How many entries there are, declared rather than counted from the array.
 *
 * Same reasoning as `TOTAL_QUESTIONS` next door and the counter census: a
 * corpus that can shrink without failing is a corpus that has already
 * shrunk, and "the guard blocked none of them" is worth exactly nothing if
 * "them" quietly became six. Editing this number is a diff somebody reads.
 */
export const CORPUS_ENTRIES = 43;

/**
 * How many numeric CLAIMS the guard should find across the whole corpus —
 * figures plus identifiers, ignored list markers excluded.
 *
 * This is the size assertion the `scratch-cleanup-order` scar is about, and
 * it is the one that matters most here. A number-extracting pattern that
 * matches nothing refuses nothing, passes every answer in this file, and
 * reports a false-positive rate of zero — which is exactly the headline
 * figure this change is judged on. Without a literal to check the parse
 * against, breaking the extractor makes the result LOOK BETTER.
 *
 * Derived by running the extractor and then read back here by hand, the way
 * the counter census does it. It moves only when somebody edits the corpus,
 * and then it moves in the same diff.
 */
export const CORPUS_CLAIMS = 153;
