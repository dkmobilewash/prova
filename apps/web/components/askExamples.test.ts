import { describe, expect, it } from "vitest";
import { EXAMPLES, isInstruction } from "./askExamples";
import { SYSTEM_PROMPT } from "@/lib/ask/answer";

/**
 * The ask box can do sixteen things and used to advertise none of them.
 * These two tests are what stops it quietly going back to that — a
 * regression here is invisible to typecheck, lint and every other test in
 * the repo, because "all four examples happen to be questions" is not a
 * defect any of them can see.
 */
describe("what the ask box advertises", () => {
  it("offers at least two INSTRUCTIONS, not only questions", () => {
    const instructions = EXAMPLES.filter(isInstruction);
    expect(
      instructions.length,
      `Only ${instructions.length} of ${EXAMPLES.length} examples ask the assistant to DO something: ` +
        `[${EXAMPLES.join(" | ")}]. There are sixteen commands behind this box. If every example is a ` +
        `question, the first thing a new person learns is that it answers things — which is how a ` +
        `reviewer concluded the assistant could not act at all.`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("classifies openers the way a reader would", () => {
    // The census above is only worth anything if this is right, so it is
    // pinned separately rather than trusted.
    expect(isInstruction("What's overdue and who do I chase first?")).toBe(false);
    expect(isInstruction("Which drawings am I behind on?")).toBe(false);
    expect(isInstruction("Anything expiring I should renew?")).toBe(false);
    expect(isInstruction("Start an estimate for a new job")).toBe(true);
    expect(isInstruction("Log today's field report")).toBe(true);
    expect(isInstruction("Raise an RFI about the head-of-wall detail")).toBe(true);
  });

  it("keeps every example short enough to read as a chip", () => {
    for (const example of EXAMPLES) {
      expect(example.length, example).toBeLessThanOrEqual(64);
    }
  });
});

describe("the prompt tells the assistant to name what it CAN do", () => {
  it("carries the capability near-miss rule", () => {
    // The failure this exists for: a correct, narrow "this app does not
    // hold purchase orders" read by a reviewer as "the assistant cannot do
    // anything". A bare refusal teaches people the box is empty.
    expect(SYSTEM_PROMPT).toMatch(/NAME THE NEAREST THING YOU ACTUALLY DO/);
  });

  it("does NOT let that relax the rule about facts, which is the dangerous direction", () => {
    // Offering an adjacent ACTION is help. Offering an adjacent NUMBER is
    // how somebody mis-bids a job. The prompt has to say both, and the
    // second sentence is the one worth guarding.
    expect(SYSTEM_PROMPT).toMatch(/Offer an adjacent ACTION, never an adjacent ANSWER/);
    expect(SYSTEM_PROMPT).toMatch(/does not relax the paragraph above/i);
    // And the original rule must still be there, unweakened.
    expect(SYSTEM_PROMPT).toMatch(/do not approximate from something adjacent/i);
  });
});
