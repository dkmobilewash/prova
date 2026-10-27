import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { bidFormSections, proposalPresentation, type ProposalLineInput } from "@/lib/estimating/proposal-presentation";
import {
  PROPOSAL_DIVIDER,
  deploymentSendRefusal,
  priceStillMatches,
  proposalCoverNote,
  proposalEmailBody,
  proposalEmailText,
  proposalSendBlocker,
  proposalSendSubject,
  type ProposalDocument,
} from "./proposal-send";

/**
 * The decisions behind C Stream Bid's "Send the proposal to <GC>", without a
 * database: what the email says, when it may not go, and the one guard that
 * keeps a preview from emailing a real GC.
 */

const lines: ProposalLineInput[] = [
  { id: "a", description: "W2 5/8 Type X board", unit: "SF", quantity: 1000, unitPrice: 2.5, wallType: { code: "W2", name: "Rated" }, tradeScope: null },
  { id: "b", description: "Shaftwall", unit: "SF", quantity: 100, unitPrice: 10, wallType: null, tradeScope: null },
  { id: "c", description: "General conditions", unit: null, quantity: 1, unitPrice: null, wallType: null, tradeScope: null },
];

function doc(over: Partial<ProposalDocument> = {}): ProposalDocument {
  return {
    title: "Riverside Medical",
    companyName: "Cyrus Drywall",
    addressedTo: "Turner Construction",
    dateLabel: "10/27/2026",
    location: "12 River Rd",
    scope: "Framing and board, levels 1-3.",
    presentation: proposalPresentation(lines, "lump"),
    bidForm: null,
    clauseGroups: [
      { heading: "Inclusions", texts: ["Layout"] },
      { heading: "Exclusions", texts: ["Insulation", "Taping above ceilings"] },
    ],
    ...over,
  };
}

describe("what the GC receives", () => {
  it("leads the subject with the project, then the sender", () => {
    expect(proposalSendSubject("Riverside Medical", "Cyrus Drywall")).toBe("Proposal — Riverside Medical — Cyrus Drywall");
  });

  it("writes a short note naming the GC, the project and the company", () => {
    const note = proposalCoverNote({ gcName: "Turner Construction", projectName: "Riverside Medical", companyName: "Cyrus Drywall" });
    expect(note).toContain("Hello Turner Construction,");
    expect(note).toContain("Riverside Medical");
    expect(note.trim().endsWith("Cyrus Drywall")).toBe(true);
  });

  it("prints a lump sum as ONE price, the same figure the page prints", () => {
    const text = proposalEmailText(doc(), money);
    expect(text).toContain("PROPOSAL — Riverside Medical");
    expect(text).toContain("Cyrus Drywall to Turner Construction · 10/27/2026");
    expect(text).toContain("SCOPE OF WORK\nFraming and board, levels 1-3.");
    expect(text).toContain("Lump sum for the work described in this proposal: $3,500.00");
    // A lump sum names no line, no unit price and no scope split.
    expect(text).not.toContain("Shaftwall");
    expect(text).not.toContain("$2.50");
  });

  it("prints scope subtotals that add to the total", () => {
    const text = proposalEmailText(doc({ presentation: proposalPresentation(lines, "scope") }), money);
    expect(text).toContain("W2 — Rated: $2,500.00");
    expect(text).toContain("Other work: $1,000.00");
    expect(text).toContain("Total bid: $3,500.00");
  });

  it("prints every line with its unit price only when itemized, and a cost-only line with no price", () => {
    const text = proposalEmailText(doc({ presentation: proposalPresentation(lines, "itemized") }), money);
    expect(text).toContain("SCHEDULE OF VALUES");
    expect(text).toContain("W2 5/8 Type X board — 1000 SF @ $2.50 = $2,500.00");
    expect(text).toContain("General conditions — 1 @ — = —");
    expect(text).toContain("Total bid: $3,500.00");
  });

  it("prints a GC's own price, and the adjustment row when itemized", () => {
    const lump = proposalEmailText(doc({ presentation: proposalPresentation(lines, "lump", 360_000) }), money);
    expect(lump).toContain(": $3,600.00");
    const itemized = proposalEmailText(doc({ presentation: proposalPresentation(lines, "itemized", 340_000) }), money);
    expect(itemized).toContain("Price adjustment: −$100.00");
    expect(itemized).toContain("Total bid: $3,400.00");
  });

  it("prints the GC's alternates and unit prices, a blank as No bid", () => {
    const bidForm = bidFormSections(
      [
        { kind: "ALTERNATE", label: "Alt 1", description: "Level 4", amount: 12000, unit: null, unitPrice: null },
        { kind: "ALTERNATE", label: "Alt 2", description: null, amount: null, unit: null, unitPrice: null },
        { kind: "UNIT_PRICE", label: "UP-1", description: "Extra board", amount: null, unit: "SF", unitPrice: 3 },
      ],
      money,
    );
    const text = proposalEmailText(doc({ bidForm }), money);
    expect(text).toContain("ALTERNATES\nAlt 1 — Level 4: Add $12,000.00\nAlt 2: No bid");
    expect(text).toContain("UNIT PRICES\nUP-1 — Extra board: $3.00 per SF");
  });

  it("prints every clause under its heading", () => {
    const text = proposalEmailText(doc(), money);
    expect(text).toContain("INCLUSIONS\n- Layout");
    expect(text).toContain("EXCLUSIONS\n- Insulation\n- Taping above ceilings");
  });

  it("leaves out an empty scope and location rather than printing blanks", () => {
    const text = proposalEmailText(doc({ scope: "  ", location: null }), money);
    expect(text).not.toContain("SCOPE OF WORK");
    expect(text.split("\n")[2]).toBe("");
  });

  it("puts the note, a divider and the document in that order", () => {
    const body = proposalEmailBody("  Hello  \n", "PROPOSAL — X");
    expect(body).toBe(`Hello\n\n${PROPOSAL_DIVIDER}\n\nPROPOSAL — X`);
  });
});

describe("A PREVIEW MUST NEVER EMAIL A REAL GC", () => {
  it("allows the production deployment only", () => {
    expect(deploymentSendRefusal({ VERCEL_ENV: "production" })).toBeNull();
  });

  it.each([
    [{ VERCEL_ENV: "preview" }, "a preview"],
    [{ VERCEL_ENV: "development" }, "the development deployment"],
    [{}, "this copy of the app"],
    [{ NODE_ENV: "production" }, "this copy of the app"],
    [{ VERCEL_ENV: "Production" }, "the Production deployment"],
  ])("refuses %o with a sentence naming where it is", (env, where) => {
    const refusal = deploymentSendRefusal(env as Record<string, string>);
    expect(refusal).toContain(where);
    expect(refusal).toContain("nothing is sent from here");
  });
});

describe("when the send is disabled, and with which sentence", () => {
  const base = {
    deploymentProblem: null,
    setupProblem: null,
    status: "INVITED" as const,
    lineCount: 3,
    totalCents: 350_000,
    recipientProblem: null,
  };

  it("is sendable when nothing is wrong, and when already sent once (a revision)", () => {
    expect(proposalSendBlocker(base)).toBeNull();
    expect(proposalSendBlocker({ ...base, status: "SUBMITTED" })).toBeNull();
  });

  it("puts the deployment first, then the install's sending", () => {
    expect(proposalSendBlocker({ ...base, deploymentProblem: "preview", setupProblem: "no key", recipientProblem: "x" })).toBe("preview");
    expect(proposalSendBlocker({ ...base, setupProblem: "no key", recipientProblem: "x" })).toBe("no key");
  });

  it.each(["WON", "LOST", "DECLINED"] as const)("refuses a bid marked %s", (status) => {
    expect(proposalSendBlocker({ ...base, status })).toBe(`This bid is marked ${status.toLowerCase()}, so there is no proposal to send for it.`);
  });

  it("refuses a proposal with no price, or no lines", () => {
    expect(proposalSendBlocker({ ...base, totalCents: 0 })).toMatch(/no price/);
    expect(proposalSendBlocker({ ...base, lineCount: 0 })).toMatch(/no price/);
  });

  it("refuses with the contact's own sentence when there is no address", () => {
    expect(proposalSendBlocker({ ...base, recipientProblem: "There's no email address on file for Turner." })).toBe(
      "There's no email address on file for Turner.",
    );
  });
});

describe("the price the person read is the price that goes", () => {
  it("matches whole cents exactly", () => {
    expect(priceStillMatches("350000", 350_000)).toBe(true);
    expect(priceStillMatches(" 350000 ", 350_000)).toBe(true);
  });

  it.each(["350001", "3500.00", "", "abc", "3.5e5"])("refuses %j", (shown) => {
    expect(priceStillMatches(shown, 350_000)).toBe(false);
  });
});
