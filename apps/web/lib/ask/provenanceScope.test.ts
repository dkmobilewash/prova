import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NOTHING_SHOWN, showing, shownText } from "./answer";

/**
 * IS THE TEXT THE GUARD CHECKS THE TEXT THAT REACHES THE SCREEN?
 *
 * This is the SCOPE question, and CLAUDE.md's `theme-contrast` entry is
 * about why it needs its own file. That census had the right pattern and a
 * correct size assertion and was green for the whole time the one offending
 * button in the repo sat outside the directory it walked: **nothing is ever
 * missing from a set you do not look at.** A number-provenance guard
 * pointed at the wrong string has exactly that failure — it would check a
 * real string, find nothing wrong with it, and never see the figure the
 * person actually read.
 *
 * The string on screen is not the concatenation of the `text` deltas. Some
 * of those are preamble the loop throws away with `reset`; some go to the
 * progress slot rather than the answer. `answer.ts`'s `showing` mirrors
 * `components/AskPanel.tsx`, and there are two halves to proving that:
 *
 *   1. the reducer does what AskPanel does, on the four event orders that
 *      actually occur — tested by running it;
 *   2. AskPanel still does that. A .tsx component cannot be rendered in
 *      this suite, so the second half is a census over its source, and it
 *      asserts its own SIZE: a rule whose pattern stops matching fails
 *      here rather than quietly reducing the set of rules checked.
 */

const panelSource = readFileSync(
  fileURLToPath(new URL("../../components/AskPanel.tsx", import.meta.url)),
  "utf8",
);

const text = (delta: string) => ({ type: "text", delta });

function run(events: { type: string; delta?: string }[]): string {
  return shownText(events.reduce(showing, NOTHING_SHOWN));
}

describe("what the person ends up reading", () => {
  it("is the answer after the tools ran, not the preamble before them", () => {
    // The ordinary multi-tool shape, straight out of
    // packages/integrations/src/ask.ts: some thinking-out-loud text, a
    // reset when the model asks for tools, then the real answer.
    expect(
      run([
        text("Let me check that…"),
        { type: "reset" },
        { type: "answering" },
        text("2 invoices are past due."),
      ]),
    ).toBe("2 invoices are past due.");
  });

  it("is the provisional text when no tool ever ran", () => {
    // A refusal or a clarifying question never gets `answering`, so
    // everything it said is in the progress slot. AskPanel moves it across
    // at `done`; if this reducer did not, the guard would check an empty
    // string and pass every tool-free answer — which is precisely the class
    // of answer with no source at all.
    expect(run([text("There are no purchase orders here.")])).toBe("There are no purchase orders here.");
  });

  it("drops a whole round of preamble when the model reaches for tools twice", () => {
    expect(
      run([
        text("One moment…"),
        { type: "reset" },
        { type: "answering" },
        text("Checking the other side too…"),
        { type: "reset" },
        { type: "answering" },
        text("$18,400.00 releasable."),
      ]),
    ).toBe("$18,400.00 releasable.");
  });

  it("joins the deltas without inventing whitespace", () => {
    expect(run([{ type: "answering" }, text("$1,"), text("173.70"), text(" owed")])).toBe("$1,173.70 owed");
  });
});

describe("AskPanel still assembles it that way", () => {
  /** The rules `showing` mirrors, each as a fragment that must be present in
   * AskPanel's stream reducer. Small and exact rather than clever: a regex
   * loose enough to survive any rewrite proves nothing. */
  const RULES: { rule: string; fragment: RegExp }[] = [
    { rule: "reset clears the answer", fragment: /case "reset":\s*\n\s*setAnswer\(""\)/ },
    { rule: "reset clears the progress", fragment: /case "reset":[\s\S]{0,120}?progressRef\.current = ""/ },
    { rule: "answering stops text being provisional", fragment: /case "answering":[\s\S]{0,400}?provisionalRef\.current = false/ },
    { rule: "provisional text goes to progress", fragment: /if \(provisionalRef\.current\) \{\s*\n\s*progressRef\.current \+= event\.delta/ },
    { rule: "settled text goes to the answer", fragment: /answerRef\.current \+= event\.delta/ },
    { rule: "done promotes progress when nothing was ever settled", fragment: /if \(provisionalRef\.current && progressRef\.current\) \{\s*\n\s*answerRef\.current = progressRef\.current/ },
    { rule: "text starts provisional on every question", fragment: /provisionalRef\.current = true/ },
    { rule: "an error clears the answer, which is what retracts it", fragment: /case "error":\s*\n\s*setAnswer\(""\)/ },
  ];

  it("follows every rule the guard's mirror depends on", () => {
    const missing = RULES.filter(({ fragment }) => !fragment.test(panelSource)).map(({ rule }) => rule);
    expect(missing, "AskPanel no longer assembles the answer the way lib/ask/answer.ts assumes").toEqual([]);
  });

  it("checks the number of rules it says it checks", () => {
    // THE SIZE ASSERTION. A census whose list can shrink is a census that
    // has already shrunk — and here the shrink is silent, because a rule
    // that stops being checked makes the test above pass more easily.
    expect(RULES).toHaveLength(8);
    expect(new Set(RULES.map((r) => r.rule)).size).toBe(8);
  });

  it("is reading a file that exists and is the panel", () => {
    // `theme-contrast` again, at its smallest: a census pointed at a file
    // that has moved reads an empty string and finds nothing wrong with it.
    expect(panelSource.length).toBeGreaterThan(1000);
    expect(panelSource).toContain("function apply(event: AskStreamEvent)");
  });
});
