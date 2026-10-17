import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyDecisions, type FindingView } from "./findings";
import { COVERAGES, ENDORSEMENTS, proposeInsurance } from "./insurance";
import { subcontractObligationAlerts } from "./obligationAlerts";
import { dayOfMonthIn, nextMonthlyDate, proposeObligation } from "./obligations";
import { extractPdfPages } from "./pageText";
import { buildRiderDraft, riderBlocks } from "./rider";
import { renderRiderPdf } from "./riderPdf";

const view = (over: Partial<FindingView>): FindingView => ({
  id: "f", key: "k", category: "OTHER", subtype: null, severity: "MEDIUM", title: "t", quote: "q",
  sourceLabel: "Subcontract agreement", pageStart: 1, pageEnd: 1, sectionRef: null, explanation: "e",
  suggestedPosition: "p", questionForGc: null, ...over,
});

describe("the rider draft — built by code from what the person decided", () => {
  const [negotiated, open] = applyDecisions(
    [
      view({ key: "pay", title: "Pay-if-paid", sectionRef: "3.2", suggestedPosition: "Pay-when-paid, 60-day outside date.", pageStart: 2 }),
      view({ key: "ld", title: "LDs", suggestedPosition: "Cap LDs." }),
    ],
    [{ key: "pay", decision: "NEGOTIATED", note: null, editedSeverity: null, editedExplanation: null, editedPosition: "Payment within 7 days of the GC being paid, and in any event within 45 days." }],
  );

  const draft = buildRiderDraft({
    jobName: "ZZ Office",
    gcName: "Example Builders",
    companyName: "ZZ Drywall",
    versionNumber: 2,
    clauses: [
      { id: "c1", kind: "EXCLUSION", text: "Fire caulking is excluded." },
      { id: "c2", kind: "CLARIFICATION", text: "Single mobilization." },
      { id: "c3", kind: "INCLUSION", text: "Level 4 finish." },
    ],
    negotiated: [negotiated!, open!],
  });

  it("carries exclusions, clarifications and ONLY negotiated findings, in the person's edited words", () => {
    expect(draft.body).toContain("for ZZ Office, version 2.");
    expect(draft.body).toContain("## Exclusions\n- Fire caulking is excluded.");
    expect(draft.body).toContain("## Clarifications\n- Single mobilization.");
    expect(draft.body).toContain("- Section 3.2: Payment within 7 days of the GC being paid, and in any event within 45 days.");
    expect(draft.body).not.toContain("Cap LDs.");
    expect(draft.body).not.toContain("Level 4 finish."); // an inclusion is our scope, not a term to add
    expect(draft.sourceKeys).toEqual(["clause:c1", "clause:c2", "finding:pay"]);
  });

  it("parses back into the blocks the printed page and the PDF both render", () => {
    const kinds = riderBlocks(draft.body).map((b) => b.kind);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(3);
    expect(kinds.filter((k) => k === "item")).toHaveLength(3);
  });

  it("renders to a real PDF whose text reads back, and survives a character the font cannot encode", async () => {
    const pdf = await renderRiderPdf("Rider — ZZ Office", `${draft.body}\n- Emoji survives: 👷`);
    const pages = await extractPdfPages(pdf);
    const text = pages.flat().join(" ");
    expect(text).toContain("Fire caulking is excluded.");
    expect(text).toContain("Payment within 7 days of the GC being paid");
    expect(text).toContain("Page 1 of");
  });
});

describe("deadlines proposed from findings", () => {
  const terms = (over: Record<string, unknown>) => ({ noticeHours: null, noticeDays: null, noticeRecipient: null, noticeForm: null, ...over });

  it("turns a stated notice window into a NOTICE_WINDOW, with who and how", () => {
    const [f] = applyDecisions([view({ category: "NOTICE", subtype: "DELAY_NOTICE", terms: terms({ noticeHours: 48, noticeRecipient: "the Project Manager", noticeForm: "in writing" }) })], []);
    expect(proposeObligation(f!)).toEqual({
      kind: "NOTICE_WINDOW", label: "48-hour delay notice", windowHours: 48, windowDays: null, dayOfMonth: null,
      recipient: "the Project Manager", form: "in writing",
    });
  });

  it("proposes nothing for a notice clause that states no window — a person adds it by hand", () => {
    const [f] = applyDecisions([view({ category: "NOTICE", terms: terms({}) })], []);
    expect(proposeObligation(f!)).toBeNull();
  });

  it("reads a monthly billing cutoff, and finds the next one, clamped to a short month", () => {
    expect(dayOfMonthIn("no later than the 20th day of each month for Work completed")).toBe(20);
    expect(dayOfMonthIn("by the 25th of every month")).toBe(25);
    expect(dayOfMonthIn("within 30 days of approval")).toBeNull();
    expect(nextMonthlyDate(20, "2026-10-17")).toBe("2026-10-20");
    expect(nextMonthlyDate(15, "2026-10-17")).toBe("2026-11-15");
    expect(nextMonthlyDate(31, "2026-04-02")).toBe("2026-04-30");
    expect(nextMonthlyDate(10, "2026-12-20")).toBe("2027-01-10");
  });
});

describe("deadlines as alerts", () => {
  const base = { jobId: "j1", jobName: "ZZ Office", recipient: "the PM", form: "in writing", dayOfMonth: null, dueOn: null };
  it("makes a notice window a STANDING alert with no fake date", () => {
    const [alert] = subcontractObligationAlerts([{ ...base, id: "o1", kind: "NOTICE_WINDOW", label: "48-hour delay notice" }], "2026-10-17");
    expect(alert).toMatchObject({ kind: "SUBCONTRACT_OBLIGATION", severity: "STANDING", dueOn: null, href: "/jobs/j1/subcontract-review" });
    expect(alert!.detail).toContain("48-hour delay notice — in writing, to the PM.");
  });

  it("raises a monthly day inside the horizon, never as overdue, and nothing further out", () => {
    const soon = subcontractObligationAlerts([{ ...base, id: "o2", kind: "MONTHLY_DAY", label: "Pay app", dayOfMonth: 20 }], "2026-10-17");
    expect(soon).toMatchObject([{ severity: "DUE_SOON", dueOn: "2026-10-20", daysUntil: 3 }]);
    expect(subcontractObligationAlerts([{ ...base, id: "o2", kind: "MONTHLY_DAY", label: "Pay app", dayOfMonth: 5 }], "2026-10-17")).toEqual([]);
  });

  it("raises a dated deadline as OVERDUE once past, with the date in the key so a corrected date is a new alert", () => {
    const [alert] = subcontractObligationAlerts([{ ...base, id: "o3", kind: "DATED", label: "COIs before mobilization", dueOn: "2026-10-10" }], "2026-10-17");
    expect(alert).toMatchObject({ severity: "OVERDUE", daysUntil: -7, key: "SUBCONTRACT_OBLIGATION:o3:2026-10-10" });
  });
});

describe("insurance asks proposed from findings", () => {
  it("reads the coverage and endorsements from the quote, and the limits from the verified figures", () => {
    const [f] = applyDecisions(
      [view({
        category: "INSURANCE",
        quote: "commercial general liability insurance of $1,000,000 per occurrence, naming Contractor as additional insured on a primary and non-contributory basis with a waiver of subrogation",
        terms: { limitPerOccurrence: 1000000, limitAggregate: null, completedOpsYears: null },
      })],
      [],
    );
    expect(proposeInsurance(f!)).toEqual({
      coverage: "GENERAL_LIABILITY", limitPerOccurrence: 1000000, limitAggregate: null,
      endorsements: ["ADDITIONAL_INSURED", "PRIMARY_NONCONTRIBUTORY", "WAIVER_OF_SUBROGATION"], completedOpsYears: null,
    });
  });

  it("does not mistake an umbrella or a workers' comp clause for general liability", () => {
    const umbrella = applyDecisions([view({ category: "INSURANCE", quote: "umbrella liability of $5,000,000 over general liability" })], [])[0]!;
    expect(proposeInsurance(umbrella)!.coverage).toBe("UMBRELLA_EXCESS");
    const wc = applyDecisions([view({ category: "INSURANCE", quote: "Workers' Compensation as required by statute" })], [])[0]!;
    expect(proposeInsurance(wc)!.coverage).toBe("WORKERS_COMP");
    expect(proposeInsurance(applyDecisions([view({ category: "PAYMENT" })], [])[0]!)).toBeNull();
  });
});

describe("the Phase 3 vocabularies equal their Prisma enums", () => {
  const schema = readFileSync(fileURLToPath(new URL("../../../../packages/db/prisma/schema/subcontract-review.prisma", import.meta.url)), "utf8");
  const members = (name: string) =>
    schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`))![1]!.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter((l) => /^[A-Z_]+$/.test(l));
  it("coverages, endorsements and obligation kinds", () => {
    expect(members("SubcontractCoverage")).toEqual([...COVERAGES]);
    expect(members("SubcontractEndorsement")).toEqual([...ENDORSEMENTS]);
    expect(members("SubcontractObligationKind")).toEqual(["NOTICE_WINDOW", "MONTHLY_DAY", "DATED"]);
  });
});
