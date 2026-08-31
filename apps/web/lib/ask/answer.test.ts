import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, forModel } from "./answer";
import { KNOWN_GAPS, TOOLS } from "./tools";

/** The model call itself needs an API key and is not tested here. What is
 * testable without one is the shape of what the model is handed — which is
 * where this feature's honesty actually lives. */
describe("forModel", () => {
  it("passes a short list through untouched", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(forModel(rows)).toBe(rows);
  });

  it("passes a non-array through untouched", () => {
    const value = { unavailable: "Nothing is overdue." };
    expect(forModel(value)).toBe(value);
  });

  it("caps a long list and SAYS it capped it", () => {
    // The cap itself is fine. A cap the model cannot see is not: it would
    // answer "you have 40 overdue invoices" when there are 200, which is a
    // wrong number stated with confidence — the exact failure this whole
    // feature is built to avoid.
    const rows = Array.from({ length: 200 }, (_, index) => ({ index }));
    const capped = forModel(rows) as { rows: unknown[]; note: string };
    expect(capped.rows).toHaveLength(40);
    expect(capped.note).toContain("200");
    expect(capped.note.toLowerCase()).toContain("longer");
  });

  it("does not cap a list sitting exactly on the limit", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ index }));
    expect(forModel(rows)).toBe(rows);
  });
});

describe("what the model is told", () => {
  it("names every known gap, with its reason", () => {
    // A gap the prompt does not mention is a question the model will
    // cheerfully approximate an answer to. Asserted against the built
    // prompt, not the source text — the gaps are interpolated in, so the
    // file itself contains the loop and not the words.
    for (const gap of KNOWN_GAPS) {
      expect(SYSTEM_PROMPT, `${gap.topic} is not in the prompt`).toContain(gap.topic);
      expect(SYSTEM_PROMPT, `${gap.topic} has no reason`).toContain(gap.why);
    }
  });

  it("forbids arithmetic in as many words", () => {
    // The single rule the whole design rests on. If a future edit softens
    // this sentence, every number in every answer becomes suspect.
    expect(SYSTEM_PROMPT).toMatch(/never do arithmetic/i);
  });

  it("states the two claims the data cannot support", () => {
    // Both are cases where a tool name reads stronger than the rows: an
    // assignment is not attendance, and a booking is not a location.
    expect(SYSTEM_PROMPT).toMatch(/assignment roster/i);
    expect(SYSTEM_PROMPT).toMatch(/no gps/i);
  });

  it("offers every tool it has a handler for", () => {
    // TOOLS is what gets sent to the model. handlers.test.ts asserts the
    // other half — that each of these can actually run.
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.description.length, `${tool.name} needs a real description`).toBeGreaterThan(40);
    }
  });
});
