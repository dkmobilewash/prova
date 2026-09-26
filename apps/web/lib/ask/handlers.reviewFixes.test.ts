import { describe, expect, it, vi } from "vitest";
import { addMonthsClamped } from "./handlers";
import { forModel } from "./answer";

/**
 * The five defects a review of #303 found in #303, pinned so they cannot
 * come back.
 *
 * Worth recording HOW they got through, because it is the same shape four
 * times: each of the original tests asserted the thing I was thinking about
 * and not the thing that breaks.
 *
 *   - the field-report empty state was tested for its WORDING while the
 *     query underneath returned the wrong set. A fixture of three reports
 *     never exceeds `take: 40`, so no test written that way could see it;
 *   - the submittal empty state was split for the COMPANY register and the
 *     identical per-job case was never considered;
 *   - the row cap was assumed to apply because the tools "return rows",
 *     when what it actually checks is whether the whole result is an array;
 *   - the message summary was tested against a fixture smaller than its own
 *     cap;
 *   - the warranty date was tested on a start day that exists in every
 *     month.
 */

describe("the row cap follows the rows, wherever they are", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ n: i }));

  it("caps rows wrapped in an object, which used to walk straight past it", () => {
    // certification_expiry, apprentice_ratio and fringe_remittance all
    // return `{ …, rows }`. Before this they shipped every row into the
    // prompt with no cap and no note.
    const capped = forModel({ month: "2026-09", rows }) as {
      month: string;
      count: number;
      rows: unknown[];
      note?: string;
    };
    expect(capped.count).toBe(50);
    expect(capped.rows).toHaveLength(40);
    expect(capped.note).toContain("first 40 of 50");
  });

  it("keeps the wrapper's own keys, so a month or a window still reaches the model", () => {
    const capped = forModel({ withinDays: 60, rows: [{ n: 1 }] }) as { withinDays: number; count: number };
    expect(capped.withinDays).toBe(60);
    expect(capped.count).toBe(1);
  });

  it("leaves an object with no rows alone", () => {
    expect(forModel({ filed: true })).toEqual({ filed: true });
  });
});

describe("adding months does not roll into the next one", () => {
  it("clamps a month-end start to the last day of the target month", () => {
    // The bug: setUTCMonth(+6) on 2026-08-31 targets 2027-02-31 and
    // JavaScript normalises it to 2027-03-03, so a warranty read as in
    // force for two days after it ended.
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("handles a leap February", () => {
    expect(addMonthsClamped("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("leaves an ordinary date exactly where it lands", () => {
    expect(addMonthsClamped("2026-03-01", 12)).toBe("2027-03-01");
    expect(addMonthsClamped("2026-09-15", 6)).toBe("2027-03-15");
  });
});

/* ------------------------------------------------------------------ */

const TODAY = "2026-09-17";

/** 45 reports, all on OTHER jobs, newer than the one we will ask about —
 * so the old code's `take: 40` swallowed the whole page before the job
 * filter ever ran. */
const RECENT_OTHER_JOBS = Array.from({ length: 45 }, (_, i) => ({
  reportDate: new Date(`2026-09-${String((i % 16) + 1).padStart(2, "0")}T00:00:00.000Z`),
  workPerformed: "Board",
  crewPresent: null,
  weather: null,
  delays: null,
  job: { name: "Riverside Medical" },
  filedBy: null,
}));

const OLD_ON_CEDAR = {
  reportDate: new Date("2026-08-01T00:00:00.000Z"),
  workPerformed: "Ceiling grid, east corridor",
  crewPresent: "Hector",
  weather: null,
  delays: "Hoist down half a day",
  job: { name: "Cedar Park Elementary" },
  filedBy: null,
};

/** One structured delay, on the SAME day as the report the 40-cap hides.
 *
 * This is the only fixture in the repo where the report cap and the delay read
 * interact, and it is what the delay query's `date: { gte: oldestReportDate }`
 * bound exists for. Company-wide, Cedar's 1 Aug report falls outside the 40
 * most recent, so a delay read with no lower bound finds this delay, finds no
 * report for that day IN VIEW, and files it as a day nobody wrote up — a
 * confident, specific, false claim about the paperwork a delay claim is built
 * from, which is the same defect this whole file is named after wearing the
 * delay log as a disguise. */
const DELAY_ON_CEDAR = {
  date: new Date("2026-08-01T00:00:00.000Z"),
  cause: "EQUIPMENT",
  responsibleParty: "OURSELVES",
  responsibleName: null,
  startMinute: null,
  endMinute: null,
  workersAffected: 2,
  hoursLost: "4.00",
  description: "Hoist down half the morning",
  gcNotifiedHow: null,
  gcNotifiedWho: null,
  gcNotifiedAt: null,
  changeOrder: null,
  job: { name: "Cedar Park Elementary" },
};

/** 60 messages — deliberately MORE than the old `take: 50`, with the
 * bounces spread so that some fall outside it. A fixture smaller than the
 * cap is what let this ship: the summary was asserted against 3 messages
 * and the cap never engaged. */
const MESSAGES = Array.from({ length: 60 }, (_, i) => ({
  toAddress: `pm${i}@turner.example`,
  toName: null,
  subject: `Message ${i}`,
  createdAt: new Date(2026, 6, 1 + i),
  job: null,
  // Every tenth one bounced: indices 0, 10, 20, 30, 40, 50 — six in all,
  // and the two oldest fall outside the newest 50.
  events:
    i % 10 === 0
      ? [{ type: "BOUNCED", occurredAt: new Date(2026, 6, 1 + i), detail: "550 mailbox unavailable" }]
      : [{ type: "DELIVERED", occurredAt: new Date(2026, 6, 1 + i), detail: null }],
}));

const SUBMITTALS = [
  {
    number: 1,
    title: "Ceiling grid",
    specSection: null,
    job: { name: "Riverside Medical" },
    revisions: [
      {
        revisionNumber: 1,
        sentOn: new Date("2026-08-01T00:00:00.000Z"),
        dueBack: null,
        returnedOn: new Date("2026-08-20T00:00:00.000Z"),
      },
    ],
  },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    dailyFieldReport: {
      // Honours the WHERE the handler now sends, which is the whole point:
      // with the filter in the query the limit applies to the right set.
      findMany: async ({ where, take }: { where: { job?: { name?: { contains?: string } } }; take?: number }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        const all = [...RECENT_OTHER_JOBS, OLD_ON_CEDAR];
        const scoped = wanted ? all.filter((r) => r.job.name.toLowerCase().includes(wanted)) : all;
        const ordered = [...scoped].sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime());
        return take ? ordered.slice(0, take) : ordered;
      },
    },
    // Honours the job filter AND the `date: { gte }` bound, because the real
    // one does and because that bound is the whole subject of the last test in
    // this file.
    delayEvent: {
      findMany: async ({
        where,
      }: {
        where: { job?: { name?: { contains?: string } }; date?: { gte?: Date } };
      }) => {
        const wanted = where.job?.name?.contains?.toLowerCase();
        const gte = where.date?.gte;
        return [DELAY_ON_CEDAR].filter(
          (d) =>
            (wanted ? d.job.name.toLowerCase().includes(wanted) : true) &&
            (gte ? d.date.getTime() >= gte.getTime() : true),
        );
      },
    },
    submittal: { findMany: async () => SUBMITTALS },
    outboundMessage: {
      // Honours `take` if one is passed, so the mutation can reinstate it.
      findMany: async ({ take }: { take?: number }) => {
        const ordered = [...MESSAGES].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? ordered.slice(0, take) : ordered;
      },
    },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return ["Riverside Medical", "Cedar Park Elementary", "Northgate Apartments"].some((n) =>
          n.toLowerCase().includes(wanted),
        )
          ? { id: "job-1" }
          : null;
      },
    },
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: string, input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name as any, input);
}

describe("daily_field_reports scopes before it limits", () => {
  it("FINDS a job's older report even when 45 newer ones exist elsewhere", async () => {
    // The defect: `take: 40` ran company-wide and the job filter ran after,
    // so this answered "No field report has been filed on that job. That
    // means nobody wrote one up, not that nothing happened." It had been.
    const result = await ask("daily_field_reports", { jobName: "Cedar Park" });
    expect(result.unavailable).toBeUndefined();
    const rows = result.data as { job: string; date: string | null; hasDelay: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].job).toBe("Cedar Park Elementary");
    expect(rows[0].date).toBe("2026-08-01");
    // And the delay on it — the thing a claim is actually built from. This
    // one is the pre-2026-09-18 free-text note, which is all that day has.
    expect(rows[0].hasDelay).toBe(true);
  });

  it("does not call a day unreported because the 40-cap hid its report", async () => {
    // THE DATE BOUND. Cedar's 1 Aug report is the oldest of 46 and falls
    // outside the company-wide 40, so its delay's day is not in view. Read the
    // delays with no lower bound and that delay becomes a row saying nobody
    // filed a report for Cedar on 1 Aug. Somebody did.
    const rows = (await ask("daily_field_reports")).data as { date: string | null; reportFiled: boolean }[];
    expect(rows.find((row) => row.date === "2026-08-01")).toBeUndefined();
    expect(rows.every((row) => row.reportFiled)).toBe(true);
  });

  it("still attaches that delay to its report when the job IS asked for", async () => {
    // The other half, and what makes the test above a bound rather than a
    // silent drop: scoped to Cedar the report is in view, so the delay belongs
    // to it.
    const rows = (await ask("daily_field_reports", { jobName: "Cedar Park" })).data as {
      date: string | null;
      reportFiled: boolean;
      delays: { crewHoursLost: number | null }[];
      legacyDelayNote: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].reportFiled).toBe(true);
    expect(rows[0].delays).toHaveLength(1);
    expect(rows[0].delays[0].crewHoursLost).toBe(4);
    // And the day's older typed note is still there beside it, unmerged.
    expect(rows[0].legacyDelayNote).toBe("Hoist down half a day");
  });

  it("still limits the unfiltered company-wide read", async () => {
    // And the result is still a flat ARRAY, which is what `forModel` caps.
    // Wrapping the reports and the delay-only days in an object would have
    // walked straight past the cap — the first defect in this file, wearing
    // the delay log as a disguise.
    const rows = (await ask("daily_field_reports")).data as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(40);
  });
});

describe("open_submittals distinguishes a job with none from a job with none OUT", () => {
  it("says none has been RAISED on a job that never had one", async () => {
    // Northgate exists, the company has submittals, but none on Northgate.
    // The old answer was "every submittal sent has come back", which reads
    // as confirmation that the job's log is clean and current.
    const result = await ask("open_submittals", { jobName: "Northgate" });
    expect(result.unavailable).toMatch(/No submittal has been raised on that job/i);
    expect(result.unavailable).not.toMatch(/come back/i);
  });

  it("still says they came back on a job whose submittals were all returned", async () => {
    const result = await ask("open_submittals", { jobName: "Riverside" });
    expect(result.unavailable).toMatch(/every submittal sent has come back/i);
  });
});

describe("outbound_messages counts everything, not the newest page", () => {
  it("reports the TRUE totals, not the ones inside a query cap", async () => {
    // The defect: `take: 50` ran in the query and the summary was computed
    // from it, so 60 messages with 6 bounces answered "50 messages, 4 need
    // attention" — presented as company-wide totals with nothing saying a
    // cap had been applied.
    const result = await ask("outbound_messages");
    expect(result.summary).toMatchObject({ messages: 60, needingAttention: 6, delivered: 54 });
  });

  it("still bounds what reaches the model, and says so", async () => {
    // The cap belongs downstream, where it can carry a note. forModel is
    // applied by the answer loop rather than by the handler, so assert it
    // directly on this handler's rows.
    const rows = (await ask("outbound_messages")).data as unknown[];
    expect(rows).toHaveLength(60);
    const capped = forModel(rows) as { count: number; rows: unknown[]; note?: string };
    expect(capped.count).toBe(60);
    expect(capped.rows).toHaveLength(40);
    expect(capped.note).toContain("first 40 of 60");
  });
});
