import { describe, expect, it } from "vitest";
import {
  addDays,
  DAS142_LEAD_TIME_CAVEATS,
  DAS140_STATUS_LABEL,
  DAS140_STATUS_TONE,
  DAS142_STATUS_LABEL,
  DAS142_STATUS_TONE,
  DAS_CITATIONS,
  DAS_UNVERIFIED_FOR_COUNSEL,
  das140DueOn,
  das140Standing,
  das140TenDayBound,
  das142Standing,
  dasCitation,
  dasProposals,
  daysBetweenDays,
  isWeekend,
  latestSendDayIgnoringHolidays,
  type DasObligationInput,
} from "./das-forms";

/**
 * The DAS deadline arithmetic, the standing it produces, and the proposals.
 *
 * WHAT THIS FILE IS REALLY FOR, in order of how expensive being wrong is:
 *
 *   1. A DEADLINE THIS APP GUESSED AND WAS WRONG ABOUT. The 72-hour rule
 *      excludes holidays and is counted to the hour; this app holds neither.
 *      So the tests below pin that the answer is named as an approximation,
 *      that its caveats travel WITH it as data rather than as prose on one
 *      screen, and that the approximation can only ever be the safe way round.
 *   2. A RULE PRESENTED AS CONFIRMED WHEN NOBODY HAS READ IT. Every citation
 *      is `verified: false` and every screen says so. If somebody flips one,
 *      the test demands the primary URL that would justify it.
 *   3. A PROPOSAL THAT FABRICATES. `dasProposals` must stay silent on a job
 *      whose public-works flag is NULL — "nobody recorded it" is not "yes".
 */

describe("day arithmetic", () => {
  it("counts whole calendar days in UTC, either direction", () => {
    expect(daysBetweenDays("2026-09-01", "2026-09-11")).toBe(10);
    expect(daysBetweenDays("2026-09-11", "2026-09-01")).toBe(-10);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    // Across a DST boundary in the reader's zone, which is exactly where a
    // local-time implementation returns 9 or 11 days instead of 10.
    expect(daysBetweenDays("2026-10-30", "2026-11-09")).toBe(10);
  });

  it("knows a weekend from a weekday", () => {
    expect(isWeekend("2026-09-26")).toBe(true); // Saturday
    expect(isWeekend("2026-09-27")).toBe(true); // Sunday
    expect(isWeekend("2026-09-25")).toBe(false); // Friday
    expect(isWeekend("2026-09-28")).toBe(false); // Monday
  });
});

describe("the DAS 140 deadline", () => {
  it("is ten calendar days after the contract was executed", () => {
    expect(das140TenDayBound("2026-09-01")).toBe("2026-09-11");
  });

  it("moves to the first day anybody worked, when that is earlier", () => {
    expect(das140DueOn("2026-09-01", "2026-09-04")).toEqual({
      dueOn: "2026-09-04",
      bound: "FIRST_WORKER",
    });
  });

  it("stays on the ten days when the crew started later", () => {
    expect(das140DueOn("2026-09-01", "2026-09-20")).toEqual({
      dueOn: "2026-09-11",
      bound: "TEN_DAYS",
    });
  });

  it("stays on the ten days when nobody has worked yet — which is not 'unknown'", () => {
    // The distinction that matters: null means no hours are logged, so only
    // one bound applies. A null read as "unknown" would have to refuse to
    // show a deadline, and the ten-day one is perfectly knowable.
    expect(das140DueOn("2026-09-01", null)).toEqual({ dueOn: "2026-09-11", bound: "TEN_DAYS" });
  });

  it("names WHICH bound decided, because 'due the 11th' is unarguable and unhelpful", () => {
    expect(das140DueOn("2026-09-01", "2026-09-11").bound).toBe("FIRST_WORKER");
  });
});

describe("the DAS 140 standing", () => {
  const executed = "2026-09-01"; // due 2026-09-11

  it("is due while there is time left", () => {
    const standing = das140Standing({ contractExecutedOn: executed, sentOn: null }, null, "2026-09-05");
    expect(standing.status).toBe("DUE");
    expect(standing.daysRemaining).toBe(6);
  });

  it("is overdue the day after, and says how far past", () => {
    const standing = das140Standing({ contractExecutedOn: executed, sentOn: null }, null, "2026-09-14");
    expect(standing.status).toBe("OVERDUE");
    expect(standing.daysRemaining).toBe(-3);
  });

  it("counts the due day itself as still in time", () => {
    expect(
      das140Standing({ contractExecutedOn: executed, sentOn: null }, null, "2026-09-11").status,
    ).toBe("DUE");
    expect(
      das140Standing({ contractExecutedOn: executed, sentOn: "2026-09-11" }, null, "2026-09-20").status,
    ).toBe("SENT_IN_TIME");
  });

  it("records a late send as late — it does not become fine by waiting", () => {
    const standing = das140Standing(
      { contractExecutedOn: executed, sentOn: "2026-09-15" },
      null,
      "2026-12-01",
    );
    expect(standing.status).toBe("SENT_LATE");
    expect(standing.daysLate).toBe(4);
    // Once sent, "how long have I got" stops being the question.
    expect(standing.daysRemaining).toBeNull();
  });

  it("judges a sent notice against the FIRST-WORKER bound too", () => {
    // Sent on the 9th, within ten days — but somebody was on site on the 4th,
    // so it was already late. A ten-days-only implementation calls this fine.
    const standing = das140Standing(
      { contractExecutedOn: executed, sentOn: "2026-09-09" },
      "2026-09-04",
      "2026-09-20",
    );
    expect(standing.status).toBe("SENT_LATE");
    expect(standing.daysLate).toBe(5);
  });
});

describe("the DAS 142 lead time", () => {
  it("counts back three days, skipping Saturdays and Sundays", () => {
    // Needed Wednesday 2026-09-30 -> Tue 29, Mon 28, Fri 25.
    expect(latestSendDayIgnoringHolidays("2026-09-30")).toBe("2026-09-25");
  });

  it("never lands on a weekend itself", () => {
    for (const day of [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]) {
      expect(isWeekend(latestSendDayIgnoringHolidays(day)), `${day}`).toBe(false);
    }
  });

  it("gives a Monday need-date the previous Wednesday, not the Friday", () => {
    // Monday 2026-09-28 -> Fri 25, Thu 24, Wed 23. A naive "minus three days"
    // returns Friday the 25th, which is one business day of notice.
    expect(latestSendDayIgnoringHolidays("2026-09-28")).toBe("2026-09-23");
  });

  it("is ALWAYS reported with what it could not account for", () => {
    const standing = das142Standing(
      { neededFrom: "2026-09-30", requestedOn: null, outcome: null },
      "2026-09-20",
    );
    // The caveats are data on the standing, not prose on one screen, so no
    // renderer can show the date without them. Both must be present.
    expect(standing.caveats).toBe(DAS142_LEAD_TIME_CAVEATS);
    expect(standing.caveats).toHaveLength(2);
    expect(standing.caveats.join(" ")).toMatch(/[Hh]olidays are NOT excluded/);
    expect(standing.caveats.join(" ")).toMatch(/counted in hours/);
  });

  it("names the field so nobody calls it the deadline", () => {
    const standing = das142Standing(
      { neededFrom: "2026-09-30", requestedOn: null, outcome: null },
      "2026-09-20",
    );
    expect(Object.keys(standing)).toContain("latestSendDay");
    expect(Object.keys(standing)).not.toContain("deadline");
  });
});

describe("the DAS 142 standing", () => {
  const needed = "2026-09-30"; // latest send day 2026-09-25

  it("is due while there is time", () => {
    const standing = das142Standing({ neededFrom: needed, requestedOn: null, outcome: null }, "2026-09-21");
    expect(standing.status).toBe("DUE");
    expect(standing.daysRemaining).toBe(4);
  });

  it("says sending now is already short, once the send day passes", () => {
    const standing = das142Standing({ neededFrom: needed, requestedOn: null, outcome: null }, "2026-09-28");
    expect(standing.status).toBe("TOO_LATE_TO_SEND");
  });

  it("does not call a day that has already gone 'overdue'", () => {
    const standing = das142Standing({ neededFrom: needed, requestedOn: null, outcome: null }, "2026-10-05");
    expect(standing.status).toBe("NEEDED_DAY_PASSED_UNSENT");
  });

  it("is in time by day count when sent on the latest send day", () => {
    expect(
      das142Standing({ neededFrom: needed, requestedOn: "2026-09-25", outcome: null }, "2026-10-05").status,
    ).toBe("SENT_IN_TIME_BY_DAY");
  });

  it("is short notice when sent after it, and says how short", () => {
    const standing = das142Standing(
      { neededFrom: needed, requestedOn: "2026-09-29", outcome: null },
      "2026-10-05",
    );
    expect(standing.status).toBe("SENT_SHORT_NOTICE");
    expect(standing.daysShort).toBe(4);
  });

  it("keeps 'nothing recorded' apart from 'no reply came back'", () => {
    // The whole value of the record: NO_RESPONSE means somebody checked, and
    // that is the thing that defends a crew with no apprentice on it.
    expect(
      das142Standing({ neededFrom: needed, requestedOn: "2026-09-25", outcome: null }, "2026-10-05").outcome,
    ).toBe("NOT_RECORDED");
    expect(
      das142Standing(
        { neededFrom: needed, requestedOn: "2026-09-25", outcome: "NO_RESPONSE" },
        "2026-10-05",
      ).outcome,
    ).toBe("NO_RESPONSE");
  });
});

describe("the labels", () => {
  it("covers every status, both forms", () => {
    // A missing key renders `undefined` on a compliance screen.
    for (const status of Object.keys(DAS140_STATUS_TONE)) {
      expect(DAS140_STATUS_LABEL[status as keyof typeof DAS140_STATUS_LABEL]).toBeTruthy();
    }
    for (const status of Object.keys(DAS142_STATUS_TONE)) {
      expect(DAS142_STATUS_LABEL[status as keyof typeof DAS142_STATUS_LABEL]).toBeTruthy();
    }
  });

  it("never paints a problem green", () => {
    expect(DAS140_STATUS_TONE.OVERDUE).not.toContain("green");
    expect(DAS140_STATUS_TONE.SENT_LATE).not.toContain("green");
    expect(DAS142_STATUS_TONE.TOO_LATE_TO_SEND).not.toContain("green");
    expect(DAS142_STATUS_TONE.SENT_SHORT_NOTICE).not.toContain("green");
    expect(DAS142_STATUS_TONE.NEEDED_DAY_PASSED_UNSENT).not.toContain("green");
  });
});

describe("the citations", () => {
  it("is not empty — an empty table makes every check below vacuous", () => {
    expect(DAS_CITATIONS.length).toBeGreaterThanOrEqual(8);
  });

  it("says out loud that nothing has been read off a primary DIR page", () => {
    // FEATURE-AUDIT.md already carries this failure once, for the
    // prevailing-wage determination rule. Repeating it silently is how an
    // unconfirmed sentence becomes a fact.
    expect(DAS_CITATIONS.every((c) => c.verified === false)).toBe(true);
    expect(DAS_UNVERIFIED_FOR_COUNSEL).toHaveLength(DAS_CITATIONS.length);
  });

  it("demands a primary URL from anything claiming to be verified", () => {
    for (const citation of DAS_CITATIONS) {
      if (!citation.verified) continue;
      expect(citation.primaryUrl, citation.key).toMatch(/^https:\/\/(www\.)?dir\.ca\.gov\//);
    }
  });

  it("gives every rule a question a staff attorney can answer", () => {
    for (const citation of DAS_CITATIONS) {
      expect(citation.question.length, citation.key).toBeGreaterThan(20);
      expect(citation.authority.length, citation.key).toBeGreaterThan(3);
      expect(citation.primaryUrl, citation.key).toMatch(/^https:\/\//);
    }
  });

  it("has unique keys, so a screen asking for one gets the one it meant", () => {
    expect(new Set(DAS_CITATIONS.map((c) => c.key)).size).toBe(DAS_CITATIONS.length);
  });

  it("throws on an unknown key rather than rendering nothing", () => {
    expect(() => dasCitation("no-such-rule")).toThrow(/No DAS citation/);
    expect(dasCitation("das142-72-hours").authority).toContain("230.1");
  });

  it("records that neither form carries a number this app could issue", () => {
    // The counter decision, written down where it can be checked: CLAUDE.md's
    // counter rules apply to a form with a number box, and these have none.
    expect(dasCitation("das-no-form-number").claim).toMatch(/carries a contractor-issued sequence or reference number/i);
  });
});

describe("what a job owes", () => {
  const base: DasObligationInput = {
    publicWorks: true,
    contracted: true,
    crafts: [{ craftName: "Drywall", journeymanHours: 184, apprenticeHours: 0, unclassifiedHours: 0 }],
    committees: [{ id: "c1", craftName: "Drywall" }],
    notices140: [],
    requests142: [],
    today: "2026-09-20",
  };

  it("proposes the missing DAS 140 and the missing dispatch request", () => {
    const kinds = dasProposals(base).map((p) => p.kind);
    expect(kinds).toContain("DAS140_MISSING");
    expect(kinds).toContain("DAS142_NO_APPRENTICES");
  });

  it("says nothing at all when nobody has recorded whether the job is public works", () => {
    // NULL IS NOT "NO", and it is not "yes" either. A DAS 140 on a private
    // job is a notice to a committee with no jurisdiction over the work.
    expect(dasProposals({ ...base, publicWorks: null })).toEqual([]);
  });

  it("says nothing on a private job", () => {
    expect(dasProposals({ ...base, publicWorks: false })).toEqual([]);
  });

  it("says nothing before there is an award to notify anybody about", () => {
    expect(dasProposals({ ...base, contracted: false })).toEqual([]);
  });

  it("names the evidence rather than delivering a verdict", () => {
    const proposal = dasProposals(base).find((p) => p.kind === "DAS142_NO_APPRENTICES")!;
    // Checkable: hours counted, and the words "no dispatch request is on
    // file". NOT "you are out of ratio" — this function applies no ratio and
    // is not entitled to that verdict (see the ratio-one-to-five citation).
    expect(proposal.observed).toContain("184 journeyman hours");
    expect(proposal.observed).toMatch(/no dispatch request is on file/);
    expect(proposal.observed).not.toMatch(/out of ratio|1:5|non-?compliant/i);
  });

  it("applies no statutory ratio anywhere", () => {
    // The five is the number this app must not assume. Proved over a case
    // that would tempt it: journeyman hours and nothing else.
    for (const proposal of dasProposals(base)) {
      expect(proposal.observed).not.toMatch(/\b5\b hours|one in five|1 in 5/i);
      expect(proposal.suggestion).not.toMatch(/\bmust employ\b/i);
    }
  });

  it("says so when there is no committee to send anything to", () => {
    const proposal = dasProposals({ ...base, committees: [] }).find(
      (p) => p.kind === "DAS140_MISSING",
    )!;
    expect(proposal.observed).toMatch(/No committee is recorded/);
    expect(proposal.suggestion).toMatch(/look it up on DIR/i);
  });

  it("chases a notice that exists and was never sent", () => {
    const proposals = dasProposals({
      ...base,
      notices140: [{ id: "n1", craftName: "Drywall", sentOn: null }],
    });
    const unsent = proposals.find((p) => p.kind === "DAS140_UNSENT");
    expect(unsent?.recordId).toBe("n1");
    expect(proposals.some((p) => p.kind === "DAS140_MISSING")).toBe(false);
  });

  it("stops chasing once it is sent", () => {
    const proposals = dasProposals({
      ...base,
      notices140: [{ id: "n1", craftName: "Drywall", sentOn: "2026-09-05" }],
    });
    expect(proposals.some((p) => p.kind.startsWith("DAS140"))).toBe(false);
  });

  it("matches a craft across spacing and case, not by string equality", () => {
    const proposals = dasProposals({
      ...base,
      crafts: [
        { craftName: "Drywall / Lathers", journeymanHours: 8, apprenticeHours: 0, unclassifiedHours: 0 },
      ],
      committees: [{ id: "c1", craftName: "drywall  /  lathers" }],
      notices140: [{ id: "n1", craftName: "DRYWALL / LATHERS", sentOn: "2026-09-02" }],
    });
    expect(proposals.some((p) => p.kind.startsWith("DAS140"))).toBe(false);
  });

  it("flags a request that is unsent and already past its send day", () => {
    const proposals = dasProposals({
      ...base,
      requests142: [{ id: "r1", craftName: "Drywall", neededFrom: "2026-09-21", requestedOn: null }],
    });
    const late = proposals.find((p) => p.kind === "DAS142_UNSENT_AND_LATE");
    expect(late?.recordId).toBe("r1");
  });

  it("leaves a request alone while there is still time to send it", () => {
    const proposals = dasProposals({
      ...base,
      today: "2026-09-10",
      requests142: [{ id: "r1", craftName: "Drywall", neededFrom: "2026-09-30", requestedOn: null }],
    });
    expect(proposals.some((p) => p.kind === "DAS142_UNSENT_AND_LATE")).toBe(false);
  });

  it("does not ask for a dispatch when apprentices are already on the job", () => {
    const proposals = dasProposals({
      ...base,
      crafts: [
        { craftName: "Drywall", journeymanHours: 184, apprenticeHours: 40, unclassifiedHours: 0 },
      ],
    });
    expect(proposals.some((p) => p.kind === "DAS142_NO_APPRENTICES")).toBe(false);
  });

  it("never counts untiered hours as journeyman hours", () => {
    // The apprentice-ratio rule, applied here for the same reason: a
    // half-configured company must not be handed a confident proposal built
    // on hours nobody has classified. 0 journeyman hours means no DAS 142
    // proposal, however many untagged hours there are.
    const proposals = dasProposals({
      ...base,
      crafts: [
        { craftName: "Drywall", journeymanHours: 0, apprenticeHours: 0, unclassifiedHours: 184 },
      ],
    });
    expect(proposals.some((p) => p.kind === "DAS142_NO_APPRENTICES")).toBe(false);
  });
});
