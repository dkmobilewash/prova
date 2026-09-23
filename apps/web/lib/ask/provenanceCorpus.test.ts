import { describe, expect, it } from "vitest";
import { checkNumberProvenance, describeUnaccounted } from "./provenance";
import { CORPUS_CLAIMS, CORPUS_ENTRIES, PROVENANCE_CORPUS, type CorpusEntry } from "./provenance.corpus";
import { toolResultContent } from "./answer";
import { TOP_QUESTIONS } from "./eval/top-questions";

/**
 * THE FALSE-POSITIVE MEASUREMENT.
 *
 * The number this whole change is judged on is not what the guard catches —
 * anybody can write a check that refuses things. It is how many LEGITIMATE
 * answers it would have blocked, because a guard that refuses good answers
 * gets switched off within a week and then catches nothing at all.
 *
 * So this file runs `checkNumberProvenance` over every entry in
 * `provenance.corpus.ts` and requires the blocked count to be ZERO,
 * printing the offending figure and what the rows offered when it is not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THIS FILE ASSERTS ABOUT ITSELF, and why each one is
 * separately necessary. CLAUDE.md has paid for all three.
 *
 * 1. SIZE — `CORPUS_CLAIMS`. A number-extracting pattern that matches
 *    nothing refuses nothing and reports a false-positive rate of zero.
 *    Breaking the extractor makes the headline figure LOOK BETTER, which is
 *    the `scratch-cleanup-order` scar exactly: 180 foreign keys instead of
 *    181, thirteen tests green. So the total number of claims found across
 *    the corpus is checked against a literal a person edits.
 *
 * 2. SCOPE — the sources. A check can have the right pattern and the wrong
 *    scope, and no size assertion sees that (`theme-contrast`): nothing is
 *    ever missing from a directory you do not walk. Here the scope question
 *    is "is the text I am checking the text that reaches the screen, and
 *    are the sources the bytes the model was handed". The second half is
 *    settled by building every source with `toolResultContent` — the
 *    executor's own function — rather than a lookalike. The first half is
 *    `provenanceScope.test.ts` next door.
 *
 * 3. PARSE INTEGRITY — digit coverage. A walk can satisfy both of the above
 *    and still mean nothing if its output silently misaligns. Every digit
 *    character in every answer must belong to exactly one claim; if the
 *    tokenizer ever stops covering the text, `digits.covered` falls below
 *    `digits.total` and this goes red, rather than a shorter list of claims
 *    passing quietly.
 */

/** The sources a turn offers, built the way the executor builds them. */
function sourcesFor(entry: CorpusEntry): string[] {
  return entry.tools.map((tool) => toolResultContent(tool));
}

function reportFor(entry: CorpusEntry) {
  return checkNumberProvenance(entry.answer, sourcesFor(entry), entry.question);
}

describe("the corpus itself", () => {
  it("is the size it says it is", () => {
    // Declared, not counted. A corpus that can shrink without failing is a
    // corpus that has already shrunk, and "it blocked none of them" means
    // nothing if "them" quietly became six.
    expect(PROVENANCE_CORPUS).toHaveLength(CORPUS_ENTRIES);
  });

  it("gives every entry a distinct id", () => {
    const ids = PROVENANCE_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("asks questions a contractor actually asks, taken from the hundred", () => {
    // The questions are not mine to reword. Taking them verbatim from the
    // census means the corpus cannot drift toward phrasings that happen to
    // suit the matcher — and the exemption is counted so it cannot grow
    // silently either.
    const census = new Set(TOP_QUESTIONS.map((q) => q.question));
    const borrowed = PROVENANCE_CORPUS.filter((entry) => !entry.ownWords);
    for (const entry of borrowed) {
      expect(census.has(entry.question), `${entry.id}: "${entry.question}" is not in top-questions.ts`).toBe(true);
    }
    expect(borrowed.length).toBe(CORPUS_ENTRIES - 4);
  });

  it("explains what every entry is stressing", () => {
    for (const entry of PROVENANCE_CORPUS) {
      expect(entry.stresses.length, `${entry.id} has no note`).toBeGreaterThan(20);
    }
  });
});

describe("the parse meant something", () => {
  it("finds the declared number of claims across the corpus", () => {
    // THE SIZE ASSERTION. Break the extractor so it matches nothing and the
    // false-positive rate becomes a perfect zero — this is the line that
    // goes red instead.
    const claims = PROVENANCE_CORPUS.reduce((total, entry) => total + reportFor(entry).checked, 0);
    expect(claims).toBe(CORPUS_CLAIMS);
  });

  it("claims every digit character in every answer", () => {
    // PARSE INTEGRITY. A digit that belongs to no claim is a number nobody
    // checked, and it looks identical to a clean answer.
    for (const entry of PROVENANCE_CORPUS) {
      const { digits } = reportFor(entry);
      expect(digits.covered, `${entry.id} left digits unclaimed`).toBe(digits.total);
    }
  });

  it("is looking at answers that actually contain numbers", () => {
    // The corpus must not become a pile of prose. Most entries carry
    // figures; the handful that deliberately carry none are the no-tool and
    // nothing-overdue cases, and they are counted rather than assumed.
    const numberless = PROVENANCE_CORPUS.filter((entry) => reportFor(entry).checked === 0);
    expect(numberless.map((entry) => entry.id)).toEqual([
      // Nothing overdue, said as good news in one line — the prompt's own
      // instruction for an honest "nothing".
      "receivables-nothing",
      // A tool's `unavailable` sentence quoted back. It happens to carry no
      // digits, which is what a refusal sentence looks like.
      "unavailable-quoted",
      // No tool ran at all: a capability answer and a clarifying question.
      "no-tool-capability",
      "no-tool-clarify",
    ]);
  });
});

describe("how many legitimate answers the guard would block", () => {
  it("blocks none of them", () => {
    const blocked = PROVENANCE_CORPUS.map((entry) => ({ entry, report: reportFor(entry) })).filter(
      ({ report }) => !report.ok,
    );
    // The failure message is the useful part: which answer, which figure,
    // and how close the rows came. A bare "expected 0, got 3" would send
    // somebody back to re-derive it by hand.
    const detail = blocked
      .map(({ entry, report }) => `${entry.id}: ${describeUnaccounted(report)} — ${entry.stresses}`)
      .join("\n");
    expect(blocked.length, `answers this guard would wrongly refuse:\n${detail}`).toBe(0);
  });

  it("is checking each one against sources, not against an empty set", () => {
    // A guard whose source set came back empty would refuse everything, and
    // the test above would catch that. The opposite — a source set so large
    // that everything matches — would not, so the sizes are printed here
    // and pinned at the top end: no entry may offer more than a few dozen
    // distinct values, which is what a real tool result holds.
    for (const entry of PROVENANCE_CORPUS) {
      const report = reportFor(entry);
      // Whether anything CAN be offered is a property of the source bytes,
      // not of the matcher: a tool that returned an `unavailable` sentence
      // and no rows has no digits to offer, and that is correct.
      const sourceHasDigits = [...sourcesFor(entry), entry.question].some((text) => /\d/.test(text));
      if (!sourceHasDigits) {
        expect(report.offered, `${entry.id} invented values from digit-free sources`).toBe(0);
      } else {
        expect(report.offered, `${entry.id} offered nothing`).toBeGreaterThan(0);
        expect(report.offered, `${entry.id} offered implausibly many values`).toBeLessThan(60);
      }
    }
  });
});
