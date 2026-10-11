import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { regretLetter, shareableSentence, omissionNote, type RegretLetterFacts } from "./regret-letter";
import { DECLINE_REASONS, type DeclineReason } from "./bid-decline";

/**
 * THE ONE THING THESE TESTS ARE REALLY FOR.
 *
 * A regret letter exists to keep a sub on a GC's bid list. The internal reason
 * a bid was declined is for the sub's own reporting, and six of the nine must
 * never reach a letter addressed to the GC — "we will not sign your
 * indemnity", "you have paid us late before", "your drawings were not complete
 * enough to price" are all true, all useful internally, and all the opposite of
 * what this document is for.
 *
 * So most of what follows is about what the letter does NOT say.
 */

const facts = (over: Partial<RegretLetterFacts> = {}): RegretLetterFacts => ({
  fromCompany: "Hart Construction",
  toCompany: "Mesa Ridge Builders",
  toPerson: "Dana Whitfield",
  projectName: "Mesa Ridge Medical Office Building",
  dueDate: "14 October 2026",
  tradeScope: "metal framing and drywall",
  reason: "CAPACITY",
  ...over,
});

/** Everything a letter could print, as one string. */
const printed = (over: Partial<RegretLetterFacts> = {}) => {
  const letter = regretLetter(facts(over));
  return [letter.greeting, ...letter.paragraphs, letter.signOff].join(" ");
};

describe("what never reaches the GC", () => {
  const WITHHELD: DeclineReason[] = [
    "BONDING",
    "CONTRACT_TERMS",
    "DRAWINGS_INCOMPLETE",
    "PRICE_RISK",
    "RELATIONSHIP",
    "OTHER",
  ];

  it("CONTRIBUTES NO SENTENCE for any of the six withheld reasons", () => {
    for (const reason of WITHHELD) {
      expect(shareableSentence(reason), reason).toBeNull();
    }
  });

  it("NEVER PRINTS THE REASON'S OWN LABEL, for any reason at all", () => {
    // The blunt version of the rule: whatever the letter says, it must not be
    // the words the dropdown used. `RELATIONSHIP` is "Not this GC" — on a
    // letter addressed to them.
    for (const reason of Object.keys(DECLINE_REASONS) as DeclineReason[]) {
      const body = printed({ reason });
      expect(body, reason).not.toContain(DECLINE_REASONS[reason].label);
      expect(body, reason).not.toContain(reason);
    }
  });

  it("says nothing about bonding, payment history or the drawings", () => {
    for (const reason of WITHHELD) {
      const body = printed({ reason }).toLowerCase();
      expect(body, reason).not.toMatch(/bond|capital|indemnit|retainage|paid late|payment history/);
      expect(body, reason).not.toMatch(/incomplete|unclear|risk|cannot price|could not price/);
    }
  });

  it("TELLS THE SENDER why it was left out, for exactly those six", () => {
    // An omission nobody is told about reads as a bug.
    for (const reason of WITHHELD) {
      expect(omissionNote(reason), reason).toMatch(/deliberately not in the letter/i);
    }
  });

  it("says nothing to the sender when there is nothing to explain", () => {
    expect(omissionNote(null)).toBeNull();
    expect(omissionNote("CAPACITY")).toBeNull();
    expect(regretLetter(facts({ reason: "CAPACITY" })).senderNote).toBeNull();
  });
});

describe("the three that are worth saying", () => {
  it("SHARES SCOPE_MISMATCH, because the GC will keep inviting you otherwise", () => {
    const body = printed({ reason: "SCOPE_MISMATCH" });
    expect(body).toMatch(/outside the scope we take on/i);
    expect(body).toMatch(/our own trade/i);
  });

  it("shares capacity and schedule as facts about our own book", () => {
    expect(printed({ reason: "CAPACITY" })).toMatch(/crews are committed/i);
    expect(printed({ reason: "SCHEDULE" })).toMatch(/schedule for this package does not fit/i);
  });

  it("neither blames nor apologises in a way that reads as incompetence", () => {
    for (const reason of ["CAPACITY", "SCHEDULE", "SCOPE_MISMATCH"] as DeclineReason[]) {
      const body = printed({ reason }).toLowerCase();
      expect(body, reason).not.toMatch(/sorry|apolog|unfortunately|regret to inform|our mistake/);
      expect(body, reason).not.toMatch(/your fault|you failed|you did not/);
    }
  });
});

describe("what it always says", () => {
  it("NAMES THIS PACKAGE, so it cannot be mistaken for another", () => {
    const body = printed();
    expect(body).toContain("Mesa Ridge Medical Office Building");
    expect(body).toContain("14 October 2026");
  });

  it("names the project alone when the invitation carried no date", () => {
    const body = printed({ dueDate: null });
    expect(body).toContain("Mesa Ridge Medical Office Building");
    expect(body).not.toMatch(/bidding\s*,/);
  });

  it("thanks them, which is the whole point", () => {
    expect(printed()).toMatch(/thank you for inviting/i);
    expect(regretLetter(facts()).signOff).toMatch(/thank you again/i);
  });

  it("ASKS FOR THE NEXT ONE — a regret letter without this is a resignation", () => {
    expect(printed()).toMatch(/would very much like to be included/i);
  });

  it("names the trade in that ask, where one is known", () => {
    // "Keep us in mind" is forgettable. "Invite us on metal framing and
    // drywall" is a note somebody can act on.
    expect(printed()).toContain("next metal framing and drywall package");
    expect(printed({ tradeScope: null })).toMatch(/next project/i);
  });

  it("says plainly that no price is coming, and prints no figure", () => {
    const body = printed();
    expect(body).toMatch(/not to submit a price/i);
    // A CURRENCY SYMBOL or a money-shaped number. The first version of this
    // asserted no run of three digits and failed on the year in the bid date —
    // the assertion was wrong, not the letter, and a date is the one number
    // this document SHOULD carry.
    expect(body).not.toMatch(/[$£€]/);
    expect(body).not.toMatch(/\d[\d,]*\.\d{2}\b/);
    expect(body).not.toMatch(/\b\d{1,3}(,\d{3})+\b/);
  });

  it("greets a person by name, and a team when there is no name", () => {
    expect(regretLetter(facts()).greeting).toBe("Dear Dana Whitfield,");
    expect(regretLetter(facts({ toPerson: null })).greeting).toBe(
      "To the estimating team at Mesa Ridge Builders,",
    );
  });

  it("holds together with no reason recorded at all", () => {
    const letter = regretLetter(facts({ reason: null }));
    expect(letter.paragraphs).toHaveLength(2);
    expect(letter.senderNote).toBeNull();
    expect(printed({ reason: null })).toMatch(/would very much like to be included/i);
  });

  it("promises nothing about future availability", () => {
    // "We will be ready to price it" is willingness. A commitment to be
    // available would be one somebody has to honour.
    const body = printed().toLowerCase();
    expect(body).not.toMatch(/we will have capacity|guarantee|we commit to/);
  });
});

/**
 * AND THAT THE SCREENS USE IT.
 *
 * Two PRs running, a mutation that gated a call site left every test green —
 * the suites exercised the module directly and said nothing about anybody
 * calling it. #665's shape. These read the call sites with comments STRIPPED,
 * because both files print the symbol names in prose.
 */
describe("the screens' own use of it", () => {
  const strip = (raw: string) =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const read = (rel: string) => strip(readFileSync(resolve(__dirname, rel), "utf8"));
  const letterPage = read("../app/(app)/bids/[id]/regret/page.tsx");
  const bidsPage = read("../app/(app)/bids/page.tsx");

  it("PARSED SOMETHING — so a broken strip fails loudly rather than passing everything", () => {
    expect(letterPage.length).toBeGreaterThan(1_500);
    expect(bidsPage.length).toBeGreaterThan(5_000);
  });

  it("the letter page composes through the module, not inline", () => {
    // THE ASSIGNMENT, not a mention: a mutation that built the letter inline
    // while leaving `regretLetter(...)` unused would pass a looser check.
    expect(letterPage).toMatch(/const letter = regretLetter\(/);
    expect(letterPage).toMatch(/letter\.paragraphs\.map/);
    expect(letterPage).toMatch(/letter\.greeting/);
    expect(letterPage).toMatch(/letter\.signOff/);
  });

  it("KEEPS THE SENDER NOTE OFF THE PRINTED PAGE", () => {
    // The safety property of this whole feature, asserted on the source
    // because no test here can print. Both the note and the internal reason
    // must sit inside a print:hidden element.
    const noteBlock = letterPage.slice(letterPage.indexOf("letter.senderNote !== null"));
    expect(noteBlock).toMatch(/print:hidden/);
    const labelAt = letterPage.indexOf("declineLabel(");
    expect(labelAt).toBeGreaterThan(-1);
    expect(letterPage.slice(0, labelAt)).toMatch(/print:hidden/);
  });

  it("does not disable either block with a literal false", () => {
    expect(letterPage).not.toMatch(/\{\s*(false|null|0)\s*&&/);
  });

  it("/bids LINKS TO IT, or the page is one nobody finds", () => {
    expect(bidsPage).toMatch(/\/regret/);
    expect(bidsPage).toMatch(/bid\.status === "DECLINED" && \(/);
  });
});
