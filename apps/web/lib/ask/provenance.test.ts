import { describe, expect, it } from "vitest";
import { checkNumberProvenance, describeUnaccounted } from "./provenance";

/**
 * What the number-provenance guard catches, what it lets through, and
 * where exactly the line between them is.
 *
 * `provenanceCorpus.test.ts` is the other half and the more important one:
 * it measures how many LEGITIMATE answers this would block. This file is
 * the half that proves the guard is not simply passing everything, which is
 * what a check with a broken extractor does while reporting a perfect
 * false-positive rate.
 *
 * The rounding cases are written as PAIRS on purpose. A tolerance is only
 * meaningful if both sides of it are pinned — a test that only proves
 * "46.95 said as 47 is fine" is equally satisfied by a guard that accepts
 * anything at all.
 */

/** A tool result as the executor hands it over: JSON, one string. */
const rows = (data: unknown, summary?: Record<string, number>) =>
  JSON.stringify(summary ? { ...summary, count: 1, rows: [data] } : { count: 1, rows: [data] });

const check = (answer: string, tools: string[] = [], question = "what's overdue?") =>
  checkNumberProvenance(answer, tools, question);

describe("a figure no tool returned", () => {
  it("refuses, and names the figure and the nearest thing the rows held", () => {
    // The failure this whole file exists for: a plausible dollar amount
    // that came from nowhere. $41.20 was in the rows; $47 was not.
    const tools = [rows({ invoice: 9, gc: "Turner", outstanding: 41.2, daysOverdue: 21 })];
    const report = check("Turner owes $47.00 on Cedar Park.", tools);

    expect(report.ok).toBe(false);
    expect(report.unaccounted.map((claim) => claim.text)).toEqual(["47.00"]);
    expect(describeUnaccounted(report)).toBe("47.00 (nearest in the rows: 41.2)");
  });

  it("refuses a total the model added up itself", () => {
    // Two invoices, no total anywhere in the result. Summing them is the
    // arithmetic the system prompt forbids in those words, and the sum is
    // the one figure a person skims.
    const tools = [
      JSON.stringify({ count: 2, rows: [{ outstanding: 30000 }, { outstanding: 18400 }] }),
    ];
    const report = check("Turner owes $48,400.00 across two invoices.", tools);
    expect(report.ok).toBe(false);
    expect(report.unaccounted[0].text).toBe("48,400.00");
  });

  it("refuses a date nothing issued", () => {
    // A date is a fact about this company like any other, and the prompt
    // says every fact comes from a tool. An invented deadline is worse
    // than an invented dollar.
    const tools = [rows({ job: "Riverside", deadlineOn: "2026-10-20" })];
    expect(check("The deadline is 2026-11-04.", tools).ok).toBe(false);
  });

  it("refuses a phone number that is not in the contact row", () => {
    const tools = [rows({ name: "Ruth Kessler", phone: "555-0142" })];
    expect(check("Ruth Kessler — 555-0199.", tools).ok).toBe(false);
  });

  it("refuses everything numeric when no tool ran at all", () => {
    // An answer with no tool call has no knowledge of this company, by the
    // prompt's own standing rule. A figure in one came from the model.
    const report = check("You're owed $12,400.00.", [], "how are we doing?");
    expect(report.ok).toBe(false);
    expect(report.offered).toBe(0);
  });
});

describe("the rounding rule: half a unit of the last digit WRITTEN", () => {
  const owed = (value: number) => [rows({ outstanding: value })];

  it("accepts about $47 from 46.95", () => {
    expect(check("About $47 outstanding.", owed(46.95)).ok).toBe(true);
  });

  it("accepts it right on the boundary, at 46.50", () => {
    expect(check("About $47 outstanding.", owed(46.5)).ok).toBe(true);
  });

  it("refuses it one cent outside, at 46.49", () => {
    // The pair above and this one are the whole rule. Without this case the
    // suite is satisfied by a guard with no tolerance limit at all.
    expect(check("About $47 outstanding.", owed(46.49)).ok).toBe(false);
  });

  it("refuses $47 from 41.20 — the case this guard exists for", () => {
    expect(check("About $47 outstanding.", owed(41.2)).ok).toBe(false);
  });

  it("tightens the window when the answer writes more decimals", () => {
    // Two decimals written means half a CENT, not half a dollar.
    expect(check("$1,173.70 outstanding.", owed(1173.704)).ok).toBe(true);
    expect(check("$1,173.70 outstanding.", owed(1173.706)).ok).toBe(false);
  });

  it("refuses significant-figure rounding: about $47,000 from 46,950", () => {
    // DELIBERATE, and it is the one place this guard is stricter than
    // ordinary English. "$47,000" is written to the units place, so the
    // window is half a dollar — not five hundred. Allowing a sig-fig
    // reading would let that string stand for anything in
    // [46,500, 47,500) on a figure somebody takes to a GC, and the system
    // prompt already forbids the model from rounding ("not 'roughly'").
    expect(check("About $47,000 outstanding.", owed(46950)).ok).toBe(false);
    expect(check("$46,950.00 outstanding.", owed(46950)).ok).toBe(true);
  });
});

describe("formatting must not decide the answer", () => {
  it("reconciles a thousands separator with a bare number", () => {
    // Drop separator handling and this is the case that goes red — the
    // mutation recorded in the changelog entry.
    expect(check("$1,173.70 outstanding.", [rows({ outstanding: 1173.7 })]).ok).toBe(true);
  });

  it("reconciles trailing zeros the currency formatter adds", () => {
    expect(check("$18,400.00 held.", [rows({ held: 18400 })]).ok).toBe(true);
  });

  it("reconciles the floating-point hour sum render-hours.ts exists for", () => {
    // 7 + 7 + 7 + 7.1 + 7.2 is 35.300000000000004 in JavaScript, which is
    // what a certified-payroll screen printed once. The answer says 35.3.
    const sum = 7 + 7 + 7 + 7.1 + 7.2;
    expect(check("35.3 hours logged.", [rows({ hoursLogged: sum })]).ok).toBe(true);
  });

  it("reconciles a percentage the handler pre-formatted as a string", () => {
    expect(check("41.0% complete.", [rows({ percentComplete: "41.0%" })]).ok).toBe(true);
  });

  it("does not require the sign to match", () => {
    // `money()` renders a negative as "-$500.00" and this app's answers
    // carry direction in words. A wrong SIGN is a real defect and this
    // guard does not claim to see it.
    expect(check("$500.00 underbilled.", [rows({ overbilledBy: -500 })]).ok).toBe(true);
  });
});

describe("numbers that are labels, not quantities", () => {
  it("accepts an ISO date written back as a slashed one", () => {
    expect(check("Due 10/3.", [rows({ dueOn: "2026-10-03" })]).ok).toBe(true);
  });

  it("accepts a date written back in words", () => {
    // "September 8" is the day number out of 2026-09-08, and it is checked
    // as a figure rather than exempted — it passes because the day IS in
    // the tool text.
    expect(check("Due September 8.", [rows({ dueOn: "2026-09-08" })]).ok).toBe(true);
  });

  it("accepts invoice, pay-app and case numbers from the rows", () => {
    const tools = [rows({ invoice: 5, payApplication: 4, caseNumber: "2026-03" })];
    expect(check("Invoice 5, pay app 4, case 2026-03.", tools).ok).toBe(true);
  });

  it("accepts a sheet size and a grid reference", () => {
    const tools = [rows({ item: "5/8 type X", location: "2B" })];
    expect(check("200 sheets of 5/8 type X at 2B.", [...tools, rows({ ordered: 200 })]).ok).toBe(true);
  });

  it("ignores a numbered-list marker at the start of a line", () => {
    const report = check("1. Chase Turner\n2. File the notice", []);
    expect(report.ok).toBe(true);
    expect(report.claims.map((claim) => claim.kind)).toEqual(["ignored", "ignored"]);
    expect(report.checked).toBe(0);
  });

  it("does not mistake a figure mid-sentence for a list marker", () => {
    // The ignore rule is narrow on purpose: line start, one or two digits,
    // a dot or bracket, then whitespace. "$47." at the end of a sentence
    // must still be checked.
    const report = check("Turner owes 47.", []);
    expect(report.checked).toBe(1);
    expect(report.ok).toBe(false);
  });
});

describe("the person's own question is a source", () => {
  it("accepts a number they typed coming back in the answer", () => {
    const report = checkNumberProvenance(
      "$30,000.00 sits past 60 days.",
      [rows({ bucket: "61-90", amount: 30000 })],
      "how much of what we're owed is more than 60 days out?",
    );
    expect(report.ok).toBe(true);
  });

  it("does not let the question launder a figure it never mentioned", () => {
    const report = checkNumberProvenance("You're owed $61,000.00.", [], "what about the 60 day stuff?");
    expect(report.ok).toBe(false);
  });
});

describe("the parse itself", () => {
  it("claims every digit character in the answer", () => {
    // PARSE INTEGRITY, asserted here on the awkward shapes rather than only
    // across the corpus. A tokenizer that silently skipped a run would
    // leave digits uncovered, and the "is anything unaccounted?" question
    // cannot see that: nothing is ever missing from an empty list.
    const answer = "Invoice 5 — $1,173.70, due 2026-09-08, 555-0142, 5/8 type X, 3:30 pm, 41.0%.";
    const report = check(answer, []);
    expect(report.digits.covered).toBe(report.digits.total);
    expect(report.digits.total).toBe((answer.match(/\d/g) ?? []).length);
  });

  it("splits a run on the character between digits, not on the sentence period", () => {
    const report = check("Turner owes 42. Halvorsen owes 18,400.00.", []);
    expect(report.claims.map((claim) => claim.text)).toEqual(["42", "18,400.00"]);
  });

  it("treats a joined run as an identifier and a plain one as a figure", () => {
    const report = check("2026-09-08 and 1,173.70", []);
    expect(report.claims.map((claim) => claim.kind)).toEqual(["identifier", "figure"]);
    expect(report.claims[1].value).toBe(1173.7);
    expect(report.claims[1].decimals).toBe(2);
  });

  it("reports nothing to check on an answer with no digits", () => {
    const report = check("Nothing is overdue.", [rows({ outstanding: 0 })]);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(0);
    expect(report.digits).toEqual({ total: 0, covered: 0 });
  });
});

describe("what it cannot do, pinned so nobody assumes otherwise", () => {
  it("cannot see a count spelled out in words", () => {
    // The original production defect — "three overdue invoices" against a
    // tile reading four — carries no digits and is invisible here. What
    // addresses it is `forModel` putting a count in every rowed result,
    // not this guard.
    const tools = [JSON.stringify({ count: 4, rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }] })];
    expect(check("You have three overdue invoices.", tools).ok).toBe(true);
  });

  it("is weak on small integers, because a rowed result already holds them all", () => {
    // Forty rows of anything contain most integers under thirty somewhere.
    // The guard is strong exactly where the money is and weak here, and
    // that is a property of the approach rather than a bug to fix later.
    const tools = [JSON.stringify({ count: 2, rows: [{ invoice: 5 }, { invoice: 7 }] })];
    expect(check("5 of them are late.", tools).ok).toBe(true);
  });
});
