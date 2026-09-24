import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addDays,
  committeeDeliverability,
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

describe("whether a committee can be sent to at all", () => {
  /**
   * THE DEFECT THIS DESCRIBE EXISTS FOR, because every case below looks
   * harmless in isolation: lib/das-print.ts tested the JOINED address, which is
   * a non-null string when only a city (or only a ZIP) is recorded. So a
   * committee with no street line, no email and no fax printed on a DAS 140 as
   * though its address were complete, with no red sentence anywhere — while the
   * directory on /union-compliance called the same row undeliverable. A box that
   * looks filled in on a document the state receives is worse than an empty
   * one, and there is a documented penalty for sending a 142 to the wrong
   * committee.
   */
  const full = {
    addressLine1: "500 Trade Center Dr",
    addressLine2: null,
    city: "Fresno",
    state: "CA",
    postalCode: "93706",
    email: null,
    fax: null,
  };

  it("posts to a whole address, and joins it the way an envelope reads", () => {
    const d = committeeDeliverability(full);
    expect(d.channels).toEqual(["post"]);
    expect(d.deliverable).toBe(true);
    expect(d.postalAddress).toBe("500 Trade Center Dr, Fresno, CA 93706");
    expect(d.postalOnFile).toBeNull();
    expect(d.addressGap).toBeNull();
  });

  it("A CITY ON ITS OWN IS NOT AN ADDRESS", () => {
    // The case that shipped as "complete".
    const d = committeeDeliverability({
      ...full,
      addressLine1: null,
      state: null,
      postalCode: null,
    });
    expect(d.postalAddress).toBeNull();
    expect(d.channels).toEqual([]);
    expect(d.deliverable).toBe(false);
    // What IS on file is still reported, so "half an address" and "no address"
    // stay two different facts on screen.
    expect(d.postalOnFile).toBe("Fresno");
    expect(d.addressGap).toContain("street line");
    expect(d.addressGap).toContain("state or ZIP");
  });

  it("A ZIP ON ITS OWN IS NOT AN ADDRESS EITHER", () => {
    const d = committeeDeliverability({
      ...full,
      addressLine1: null,
      city: null,
      state: null,
    });
    expect(d.postalAddress).toBeNull();
    expect(d.deliverable).toBe(false);
    expect(d.postalOnFile).toBe("93706");
    expect(d.addressGap).toContain("street line");
    expect(d.addressGap).toContain("city");
  });

  it("says nothing is recorded when nothing is, rather than naming a fragment", () => {
    const d = committeeDeliverability({
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      email: null,
      fax: null,
    });
    expect(d.postalOnFile).toBeNull();
    expect(d.addressGap).toMatch(/^No address is recorded/);
  });

  it("treats a field holding only spaces as empty, which is what a form leaves", () => {
    const d = committeeDeliverability({ ...full, addressLine1: "   " });
    expect(d.deliverable).toBe(false);
    expect(d.postalAddress).toBeNull();
  });

  it("takes a state or a ZIP, not both", () => {
    expect(committeeDeliverability({ ...full, state: null }).postalAddress).toBe(
      "500 Trade Center Dr, Fresno, 93706",
    );
    expect(committeeDeliverability({ ...full, postalCode: null }).postalAddress).toBe(
      "500 Trade Center Dr, Fresno, CA",
    );
  });

  it("is reachable by email or fax alone — the rule names both", () => {
    const email = committeeDeliverability({
      ...full,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      email: "dispatch@example.org",
    });
    expect(email.channels).toEqual(["email"]);
    expect(email.deliverable).toBe(true);
    const fax = committeeDeliverability({
      ...full,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      fax: "559-555-0199",
    });
    expect(fax.channels).toEqual(["fax"]);
  });

  it("still reports the address gap on a committee reachable by email", () => {
    // Reachable, so nothing is BLOCKING — but the postal box on the printed
    // form cannot be filled from "Fresno", and both screens say so.
    const d = committeeDeliverability({
      ...full,
      addressLine1: null,
      state: null,
      postalCode: null,
      email: "dispatch@example.org",
    });
    expect(d.deliverable).toBe(true);
    expect(d.postalAddress).toBeNull();
    expect(d.addressGap).toContain("Fresno");
  });

  it("gives the gap sentence something to do rather than naming a field", () => {
    const d = committeeDeliverability({ ...full, addressLine1: null });
    expect(d.addressGap).toMatch(/DIR/);
    expect(d.addressGap!.length).toBeGreaterThan(80);
  });
});

describe("only one place decides it", () => {
  /**
   * The point of the fix, not a decoration on it: two screens disagreed for as
   * long as each did its own arithmetic. So this asserts that nothing in the
   * app derives deliverability from the raw contact fields except the function
   * above.
   *
   * SCOPE IS DERIVED AND THEN PINNED, per CLAUDE.md: a census that walks the
   * wrong directory is green because the offender was never a candidate. So the
   * walk's own result is asserted to contain the two files that disagreed.
   */
  const ROOT = fileURLToPath(new URL("..", import.meta.url));

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|dbtest)\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const candidates = walk(ROOT)
    .map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, "utf8") }))
    .filter((f) => /committee/i.test(f.text));

  it("looks at the files that could hold the defect, including both that held it", () => {
    const names = candidates.map((c) => c.file);
    // A walk that returns nothing passes every assertion below it.
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names).toContain(join("lib", "das-print.ts"));
    expect(names).toContain(join("components", "ApprenticeshipCommitteePanel.tsx"));
    expect(names).toContain(join("lib", "das-forms.ts"));
  });

  it("finds nobody else deciding it from the raw fields", () => {
    // A boolean test on a contact field — `addressLine1 ? … : …`,
    // `city && …`, `postalCode !== null`. `?? ""` on a form default is not one
    // and is deliberately not matched.
    const deriving = /(addressLine1|postalCode|\bcity\b)\s*(\?(?!\?)|&&|\|\||[!=]==\s*null)/;
    const offenders = candidates
      .filter((c) => c.file !== join("lib", "das-forms.ts"))
      .filter((c) => deriving.test(c.text))
      .map((c) => c.file);
    expect(offenders).toEqual([]);
  });
});

describe("what a job owes", () => {
  /**
   * `craftName` differs between the committee and the classification in EVERY
   * fixture here, and that is the fixture doing its job. The committee's craft
   * is the craft in the committee's words ("Drywall/Lathers"); the company's
   * classification is the craft in the company's words ("Drywall"). The schema
   * says they routinely differ and adds `craftClassificationId` for the join.
   * A fixture where they happened to match is what let a name-matching
   * implementation look correct for a week.
   */
  const CRAFT = "cc_drywall";
  const LOCAL = "ul_carpenters_2361";
  const base: DasObligationInput = {
    publicWorks: true,
    contracted: true,
    crafts: [
      {
        craftClassificationId: CRAFT,
        unionLocalId: LOCAL,
        craftName: "Drywall",
        journeymanHours: 184,
        apprenticeHours: 0,
        unclassifiedHours: 0,
      },
    ],
    committees: [
      {
        id: "c1",
        name: "Central Valley Drywall/Lathing JATC",
        craftName: "Drywall/Lathers",
        craftClassificationId: CRAFT,
        unionLocalId: LOCAL,
        approvedToTrainUs: true,
      },
    ],
    notices140: [],
    requests142: [],
    today: "2026-09-20",
  };

  const kindsOf = (input: DasObligationInput) => dasProposals(input).map((p) => p.kind);

  it("proposes the missing DAS 140 and the missing dispatch request", () => {
    const kinds = kindsOf(base);
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
    expect(proposal.observed).toMatch(/no committee in your directory is linked/i);
    expect(proposal.suggestion).toMatch(/look the committee up on DIR/i);
  });

  it("JOINS ON THE LINK, so a sent notice actually clears the proposal", () => {
    // THE BUG: the craft was matched between the committee's free-text
    // craftName and the classification's name, which the schema says routinely
    // differ — so DAS140_MISSING never cleared however many notices went out,
    // and the suggestion told the contractor to add a committee that was
    // already in the directory.
    const proposals = dasProposals({
      ...base,
      notices140: [
        { id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: "2026-09-05" },
      ],
    });
    expect(proposals.some((p) => p.kind.startsWith("DAS140"))).toBe(false);
  });

  it("asks for the LINK rather than for a committee that already exists", () => {
    // A committee whose wording matches the craft exactly, and no link. A
    // name-matching implementation calls this covered; the honest answer is
    // that the directory does not say it covers this classification.
    const proposal = dasProposals({
      ...base,
      committees: [
        {
          id: "c1",
          name: "Central Valley Drywall/Lathing JATC",
          craftName: "Drywall",
          craftClassificationId: null,
          unionLocalId: null,
          approvedToTrainUs: true,
        },
      ],
    }).find((p) => p.kind === "DAS140_MISSING")!;
    expect(proposal.observed).toMatch(/no committee in your directory is linked/i);
    expect(proposal.suggestion).toMatch(/set its classification/i);
    expect(proposal.suggestion).not.toMatch(/^Look the committee up on DIR/);
  });

  it("CHASES AN UNSENT NOTICE BEFORE ANYBODY HAS LOGGED AN HOUR", () => {
    // THE BUG: DAS140_UNSENT was raised from inside the loop over crafts WITH
    // HOURS, so a notice recorded the day the contract was executed raised
    // nothing at all until somebody logged an hour — and the ten days it has to
    // go out in are usually over before anybody does. The DAS 142 side already
    // iterated its own rows; this now does too.
    const proposals = dasProposals({
      ...base,
      crafts: [],
      notices140: [{ id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: null }],
    });
    const unsent = proposals.find((p) => p.kind === "DAS140_UNSENT");
    expect(unsent?.recordId).toBe("n1");
    expect(unsent?.observed).toContain("Central Valley Drywall/Lathing JATC");
  });

  it("chases a notice that exists and was never sent, and stops calling it missing", () => {
    const proposals = dasProposals({
      ...base,
      notices140: [{ id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: null }],
    });
    expect(proposals.find((p) => p.kind === "DAS140_UNSENT")?.recordId).toBe("n1");
    expect(proposals.some((p) => p.kind === "DAS140_MISSING")).toBe(false);
  });

  it("stops chasing once it is sent", () => {
    const proposals = dasProposals({
      ...base,
      notices140: [
        { id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: "2026-09-05" },
      ],
    });
    expect(proposals.some((p) => p.kind.startsWith("DAS140"))).toBe(false);
  });

  describe("two committees covering one craft", () => {
    // THE BUG: the notice map was keyed on the CRAFT, so several committees
    // covering one craft collapsed to one entry — one notice suppressed the
    // proposal for all of them, and of two notices on one craft only the last
    // one written to the map was ever examined for UNSENT.
    const two: DasObligationInput = {
      ...base,
      committees: [
        {
          id: "c1",
          name: "Central Valley JATC",
          craftName: "Drywall/Lathers",
          craftClassificationId: CRAFT,
          unionLocalId: LOCAL,
          approvedToTrainUs: false,
        },
        {
          // The SAME craft wording as c1 — two committees in one area routinely
          // describe the craft identically, which is what made keying the
          // notices on the craft name look like it worked.
          id: "c2",
          name: "Valley Interior Systems JATC",
          craftName: "Drywall/Lathers",
          craftClassificationId: CRAFT,
          unionLocalId: LOCAL,
          approvedToTrainUs: false,
        },
      ],
    };

    it("does not let one notice stand in for the other", () => {
      const missing = dasProposals({
        ...two,
        notices140: [
          { id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: "2026-09-05" },
        ],
      }).filter((p) => p.kind === "DAS140_MISSING");
      expect(missing).toHaveLength(1);
      expect(missing[0].observed).toContain("Valley Interior Systems JATC");
      expect(missing[0].observed).not.toContain("Central Valley JATC");
    });

    it("examines EVERY unsent notice, not just the newest", () => {
      const unsent = dasProposals({
        ...two,
        notices140: [
          { id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: null },
          { id: "n2", committeeId: "c2", craftName: "Drywall/Lathers", sentOn: null },
        ],
      }).filter((p) => p.kind === "DAS140_UNSENT");
      expect(unsent.map((p) => p.recordId).sort()).toEqual(["n1", "n2"]);
    });

    it("raises one observation per committee with nothing on file", () => {
      const missing = dasProposals(two).filter((p) => p.kind === "DAS140_MISSING");
      expect(missing).toHaveLength(2);
    });
  });

  describe("how many notices an award owes", () => {
    // `approvedToTrainUs` decides it — and it is three-valued. A blank must
    // make this function DECLINE to answer rather than pick a branch, and even
    // a recorded value cannot be turned into a count here, because
    // `das140-recipients` is verified:false: nobody has asked counsel whether
    // one notice to a signatory's own JATC discharges the craft.
    const twoCommittees = (second: boolean | null): DasObligationInput => ({
      ...base,
      committees: [
        {
          id: "c1",
          name: "Central Valley JATC",
          craftName: "Drywall/Lathers",
          craftClassificationId: CRAFT,
          unionLocalId: LOCAL,
          approvedToTrainUs: true,
        },
        {
          id: "c2",
          name: "Valley Interior Systems JATC",
          craftName: "Lathing",
          craftClassificationId: CRAFT,
          unionLocalId: LOCAL,
          approvedToTrainUs: second,
        },
      ],
    });

    it("declines to answer when one committee's approval is not recorded", () => {
      const proposal = dasProposals(twoCommittees(null)).find(
        (p) => p.kind === "DAS140_RECIPIENTS_UNKNOWN",
      )!;
      expect(proposal.observed).toContain("Valley Interior Systems JATC");
      expect(proposal.observed).toMatch(/not going to tell you a number/i);
      expect(proposal.suggestion).toMatch(/NOT confirmed/);
    });

    it("guesses no count anywhere, on any proposal, when it is not recorded", () => {
      for (const proposal of dasProposals(twoCommittees(null))) {
        expect(proposal.observed).not.toMatch(/owes (one|two|1|2) notices?/i);
        expect(proposal.suggestion).not.toMatch(/you owe/i);
      }
    });

    it("keeps quiet about the count once every committee's approval is recorded", () => {
      expect(kindsOf(twoCommittees(false))).not.toContain("DAS140_RECIPIENTS_UNKNOWN");
      expect(kindsOf(twoCommittees(true))).not.toContain("DAS140_RECIPIENTS_UNKNOWN");
    });

    it("keeps quiet when one committee covers the craft — the count is one either way", () => {
      const single = {
        ...base,
        committees: [{ ...base.committees[0], approvedToTrainUs: null }],
      };
      expect(kindsOf(single)).not.toContain("DAS140_RECIPIENTS_UNKNOWN");
      // And the blank is still SAID, in the proposal that is raised.
      expect(dasProposals(single)[0].observed).toMatch(/not recorded whether they approved/);
    });

    it("keeps quiet once every linked committee has a notice, blank or not", () => {
      expect(
        kindsOf({
          ...twoCommittees(null),
          notices140: [
            { id: "n1", committeeId: "c1", craftName: "Drywall/Lathers", sentOn: "2026-09-05" },
            { id: "n2", committeeId: "c2", craftName: "Lathing", sentOn: "2026-09-05" },
          ],
        }),
      ).not.toContain("DAS140_RECIPIENTS_UNKNOWN");
    });

    it("states each committee's approval as a fact rather than a verdict", () => {
      const missing = dasProposals(twoCommittees(false)).filter(
        (p) => p.kind === "DAS140_MISSING",
      );
      expect(missing.map((p) => p.observed).join(" ")).toMatch(
        /recorded as having approved you to train/,
      );
      expect(missing.map((p) => p.observed).join(" ")).toMatch(
        /recorded as not having approved you to train/,
      );
    });
  });

  describe("a trade whose tiers are separate classifications", () => {
    /**
     * `CraftClassification` is unique on `(unionLocalId, name)`, so a trade's
     * journeyman tier and its apprentice tier are two different rows — proved
     * against a real Postgres, not assumed. A committee links to ONE of them,
     * and the directory refuses a duplicate committee, so matching a craft on
     * the classification exactly would raise "no committee is linked" on every
     * apprentice-tier craft forever. The union local is the trade.
     */
    const APPRENTICE_CRAFT = "cc_drywall_apprentice";
    const OTHER_LOCAL = "ul_iupat_294";
    const bothTiers: DasObligationInput = {
      ...base,
      crafts: [
        ...base.crafts,
        {
          craftClassificationId: APPRENTICE_CRAFT,
          unionLocalId: LOCAL,
          craftName: "Drywall Apprentice",
          journeymanHours: 0,
          apprenticeHours: 40,
          unclassifiedHours: 0,
        },
      ],
    };

    it("raises ONE proposal for the trade, not one per tier", () => {
      const missing = dasProposals(bothTiers).filter((p) => p.kind === "DAS140_MISSING");
      expect(missing).toHaveLength(1);
      // And it names both crafts the hours are on, so the sentence is checkable.
      expect(missing[0].observed).toContain("Drywall and Drywall Apprentice");
    });

    it("counts the apprentice tier's hours as apprentice hours on the trade", () => {
      // Counted per classification, the journeyman row reads zero apprentice
      // hours on every job forever — a dispatch request proposed on a craft
      // that already has apprentices on it, permanently.
      expect(kindsOf(bothTiers)).not.toContain("DAS142_NO_APPRENTICES");
      expect(kindsOf(base)).toContain("DAS142_NO_APPRENTICES");
    });

    it("does not let a committee reach into another local", () => {
      const twoLocals = dasProposals({
        ...base,
        crafts: [
          ...base.crafts,
          {
            craftClassificationId: "cc_painters_drywall",
            unionLocalId: OTHER_LOCAL,
            craftName: "Taper",
            journeymanHours: 16,
            apprenticeHours: 0,
            unclassifiedHours: 0,
          },
        ],
      }).filter((p) => p.kind === "DAS140_MISSING");
      expect(twoLocals).toHaveLength(2);
      const orphan = twoLocals.find((p) => p.craftName === "Taper")!;
      expect(orphan.observed).toMatch(/no committee in your directory is linked/i);
    });
  });

  describe("hours nobody has tagged to a craft", () => {
    // THE BUG: the untagged pseudo-row went into the proposal engine as though
    // it were a craft, so any job with one untagged hour showed "Add the
    // apprenticeship committee for this craft and area first" — permanently.
    // No committee can ever be linked to "no craft tag", so nothing could
    // clear it.
    const untagged: DasObligationInput = {
      ...base,
      crafts: [
        {
          craftClassificationId: null,
          unionLocalId: null,
          craftName: "Hours with no craft tag",
          journeymanHours: 0,
          apprenticeHours: 0,
          unclassifiedHours: 6.5,
        },
      ],
    };

    it("never owes a notice to a committee", () => {
      const kinds = kindsOf(untagged);
      expect(kinds).not.toContain("DAS140_MISSING");
      expect(kinds).not.toContain("DAS142_NO_APPRENTICES");
      expect(kinds).not.toContain("DAS140_RECIPIENTS_UNKNOWN");
    });

    it("raises nothing a person cannot clear", () => {
      for (const proposal of dasProposals(untagged)) {
        expect(proposal.suggestion).not.toMatch(/committee for this craft and area/i);
        expect(proposal.observed).not.toMatch(/no DAS 140 is recorded on this job to/);
      }
    });

    it("still says the hours exist, and what clears it", () => {
      const proposal = dasProposals(untagged).find((p) => p.kind === "HOURS_WITHOUT_CRAFT")!;
      expect(proposal.observed).toContain("6.5");
      expect(proposal.suggestion).toMatch(/[Tt]ag those hours/);
      expect(proposal.recordId).toBeNull();
    });

    it("is silent when the row carries no hours at all", () => {
      expect(
        kindsOf({
          ...untagged,
          crafts: [{ ...untagged.crafts[0], unclassifiedHours: 0 }],
        }),
      ).not.toContain("HOURS_WITHOUT_CRAFT");
    });

    it("does not stop the real crafts on the same job being proposed for", () => {
      const kinds = kindsOf({ ...untagged, crafts: [...untagged.crafts, ...base.crafts] });
      expect(kinds).toContain("HOURS_WITHOUT_CRAFT");
      expect(kinds).toContain("DAS140_MISSING");
    });
  });

  it("flags a request that is unsent and already past its send day", () => {
    const proposals = dasProposals({
      ...base,
      requests142: [
        {
          id: "r1",
          committeeId: "c1",
          craftName: "Drywall/Lathers",
          neededFrom: "2026-09-21",
          requestedOn: null,
        },
      ],
    });
    const late = proposals.find((p) => p.kind === "DAS142_UNSENT_AND_LATE");
    expect(late?.recordId).toBe("r1");
  });

  it("leaves a request alone while there is still time to send it", () => {
    const proposals = dasProposals({
      ...base,
      today: "2026-09-10",
      requests142: [
        {
          id: "r1",
          committeeId: "c1",
          craftName: "Drywall/Lathers",
          neededFrom: "2026-09-30",
          requestedOn: null,
        },
      ],
    });
    expect(proposals.some((p) => p.kind === "DAS142_UNSENT_AND_LATE")).toBe(false);
  });

  it("stops asking for a dispatch once a request is on file for that craft", () => {
    // Matched through the COMMITTEE's link, not through the craft wording —
    // the same join the 140 side gets wrong when it reads names.
    const proposals = dasProposals({
      ...base,
      requests142: [
        {
          id: "r1",
          committeeId: "c1",
          craftName: "Drywall/Lathers",
          neededFrom: "2026-09-30",
          requestedOn: "2026-09-20",
        },
      ],
      today: "2026-09-21",
    });
    expect(proposals.some((p) => p.kind === "DAS142_NO_APPRENTICES")).toBe(false);
  });

  it("says why a request it cannot match is not counted", () => {
    // A request on a committee with no classification link cannot be matched
    // to a craft. Rather than nag silently, the suggestion says what to check.
    const proposal = dasProposals({
      ...base,
      committees: [
        base.committees[0],
        {
          id: "c9",
          name: "Unlinked JATC",
          craftName: "Lathing",
          craftClassificationId: null,
          unionLocalId: null,
          approvedToTrainUs: null,
        },
      ],
      requests142: [
        {
          id: "r1",
          committeeId: "c9",
          craftName: "Lathing",
          neededFrom: "2026-09-30",
          requestedOn: "2026-09-20",
        },
      ],
      today: "2026-09-21",
    }).find((p) => p.kind === "DAS142_NO_APPRENTICES")!;
    expect(proposal.suggestion).toMatch(/classification link/);
  });

  it("does not ask for a dispatch when apprentices are already on the job", () => {
    const proposals = dasProposals({
      ...base,
      crafts: [{ ...base.crafts[0], apprenticeHours: 40 }],
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
        {
          craftClassificationId: CRAFT,
          unionLocalId: LOCAL,
          craftName: "Drywall",
          journeymanHours: 0,
          apprenticeHours: 0,
          unclassifiedHours: 184,
        },
      ],
    });
    expect(proposals.some((p) => p.kind === "DAS142_NO_APPRENTICES")).toBe(false);
  });
});
