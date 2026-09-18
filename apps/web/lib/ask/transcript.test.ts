import { describe, expect, it } from "vitest";
import {
  type TranscriptEntry,
  MAX_ENTRY_CHARS,
  MAX_TRANSCRIPT,
  answeredAgo,
  boundTranscript,
  SUMMARY_CHARS,
  staleIndices,
  stalenessNote,
  summarizeQuestion,
} from "./transcript";
import { MAX_TURNS } from "./turns";

/** A well-formed entry. Typed, because `staleIndices` takes real entries —
 * the deliberately malformed ones below go straight to `boundTranscript`,
 * whose whole job is that it accepts anything. */
const at = (askedAt: number, over: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  question: "what is overdue?",
  answer: "$32,300 from Brackett, 15 days.",
  citations: [{ label: "Cash flow", href: "/cash-flow" }],
  askedAt,
  ...over,
});

/** The same shape with the types taken off, for the parse tests. */
const raw = (over: Record<string, unknown>) => ({
  question: "what is overdue?",
  answer: "$32,300 from Brackett, 15 days.",
  citations: [{ label: "Cash flow", href: "/cash-flow" }],
  askedAt: 1000,
  ...over,
});

describe("the transcript is not the wire format", () => {
  it("holds more than the model is ever sent", () => {
    // The point of two modules. The scrollback can grow without adding one
    // byte of prompt weight or one field for the server to validate.
    expect(MAX_TRANSCRIPT).toBeGreaterThan(MAX_TURNS);
  });

  it("keeps the most recent when it overflows", () => {
    const many = Array.from({ length: MAX_TRANSCRIPT + 5 }, (_, i) => at(1000 + i, { question: `q${i}` }));
    const bounded = boundTranscript(many);
    expect(bounded).toHaveLength(MAX_TRANSCRIPT);
    expect(bounded[bounded.length - 1].question).toBe(`q${MAX_TRANSCRIPT + 4}`);
  });
});

describe("reading back what a browser stored", () => {
  it("survives anything", () => {
    // Every one of these has been a real crash somewhere.
    expect(boundTranscript(null)).toEqual([]);
    expect(boundTranscript("not an array")).toEqual([]);
    expect(boundTranscript([null, 3, "x", {}])).toEqual([]);
  });

  it("drops an entry with no timestamp rather than inventing one", () => {
    // A stamped "now" would make an old answer look fresh, which is the
    // one failure this whole feature exists to prevent.
    expect(boundTranscript([{ question: "q", answer: "a", citations: [] }])).toEqual([]);
    expect(boundTranscript([raw({ askedAt: Number.NaN })])).toEqual([]);
  });

  it("keeps a question whose answer failed", () => {
    // "I asked and it could not" is part of the conversation somebody is
    // reading, and dropping it makes the scrollback lie by omission.
    const [entry] = boundTranscript([raw({ answer: "" })]);
    expect(entry.question).toBe("what is overdue?");
    expect(entry.answer).toBe("");
  });

  it("caps a huge entry instead of refusing the lot", () => {
    const [entry] = boundTranscript([raw({ answer: "x".repeat(MAX_ENTRY_CHARS + 500) })]);
    expect(entry.answer).toHaveLength(MAX_ENTRY_CHARS);
  });

  it("REFUSES a citation that points off-site", () => {
    // A stored transcript is browser input like any other. A link rendered
    // from it must not be able to leave the app.
    const [entry] = boundTranscript([
      raw({
        citations: [
          { label: "Cash flow", href: "/cash-flow" },
          { label: "Free money", href: "https://evil.example/phish" },
          { label: "Protocol-relative", href: "//evil.example" },
          { label: "Not a string", href: 7 },
        ],
      }),
    ]);
    expect(entry.citations).toEqual([{ label: "Cash flow", href: "/cash-flow" }]);
  });
});

describe("how long ago, in words", () => {
  const now = 1_700_000_000_000;
  const ago = (ms: number) => answeredAgo(now - ms, now);

  it("reads the way a person says it", () => {
    expect(ago(5_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(9 * 60_000)).toBe("9 minutes ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(3 * 60 * 60_000)).toBe("3 hours ago");
    expect(ago(30 * 60 * 60_000)).toBe("1 day ago");
  });

  it("never reads as being in the future, whatever the clock did", () => {
    // A browser clock can move. "answered in -2 minutes" is the kind of
    // detail that makes somebody distrust the whole panel.
    expect(answeredAgo(now + 60_000, now)).toBe("just now");
  });

  it("stays coarse, because the underlying question is not precise", () => {
    expect(ago(2 * 60 * 60_000 + 14 * 60_000)).toBe("2 hours ago");
  });
});

describe("which answers are marked", () => {
  it("marks every one except the newest", () => {
    const entries = [at(1), at(2), at(3)];
    expect(staleIndices(entries)).toEqual([0, 1]);
  });

  it("marks nothing when there is only the current answer", () => {
    expect(staleIndices([at(1)])).toEqual([]);
    expect(staleIndices([])).toEqual([]);
  });

  it("marks a two-second-old answer, because age is not the rule", () => {
    // The rule is "read at a different moment", not "older than N minutes".
    // A time threshold makes a two-minute-old figure look authoritative,
    // which is the reading the original no-scrollback decision guarded
    // against — see the module header.
    const now = 1_700_000_000_000;
    expect(staleIndices([at(now - 2_000), at(now)])).toEqual([0]);
  });
});

describe("what the mark says", () => {
  it("says the figures were read THEN, and what to do about it", () => {
    const now = 1_700_000_000_000;
    const note = stalenessNote(now - 3 * 60 * 60_000, now);
    expect(note).toContain("3 hours ago");
    expect(note).toMatch(/read then/i);
    // A warning that does not say what to do is decoration.
    expect(note).toMatch(/ask again/i);
  });
});

describe("what a closed row says", () => {
  it("leaves a short question exactly as it was typed", () => {
    expect(summarizeQuestion("what is overdue?")).toBe("what is overdue?");
  });

  it("cuts a long one at a word, and marks the cut", () => {
    const long =
      "which invoices are overdue on Riverside Medical and how much of that is retainage the GC is still holding";
    const summary = summarizeQuestion(long);
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_CHARS + 1);
    expect(summary.endsWith("…")).toBe(true);
    const kept = summary.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    // The cut landed ON a word boundary — the next character in the
    // original is a space, so the last word kept is whole rather than a
    // stump. A plain slice at SUMMARY_CHARS lands mid-word here, which is
    // what this asserts against; without it the word-boundary search could
    // be deleted and every other assertion would still pass.
    expect(long[kept.length]).toBe(" ");
    expect(summary.slice(-2, -1)).not.toBe(" ");
  });

  it("flattens dictation into one line", () => {
    // Speech-to-text arrives as one run and a pasted question carries
    // newlines; a row is one line either way.
    expect(summarizeQuestion("what is\n  overdue\ton Riverside?")).toBe("what is overdue on Riverside?");
  });

  it("still cuts a question with no spaces in it", () => {
    const wall = "x".repeat(200);
    const summary = summarizeQuestion(wall);
    expect(summary).toHaveLength(SUMMARY_CHARS + 1);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("NEVER summarises the answer, which is the whole point", () => {
    // The obvious summary is the answer's first sentence, and it is the one
    // thing that must not go on a closed row: this answer clipped to its
    // first sentence reads as a clean bill on the exact question somebody
    // asked because they were worried.
    const answer = "Nothing is overdue on Riverside. $32,300 is overdue on Brackett, 15 days out.";
    const summary = summarizeQuestion("is anything overdue?");
    expect(answer).toContain("Nothing is overdue");
    expect(summary).not.toContain("Nothing is overdue");
    expect(summary).toBe("is anything overdue?");
  });
});

describe("an attached file in the scrollback", () => {
  it("keeps the file's NAME on the row, bounded, and nothing else about it", () => {
    const [entry] = boundTranscript([
      { question: "what's the bid date?", answer: "Oct 10.", citations: [], askedAt: 1, attachmentName: `  ${"x".repeat(300)}.pdf ` },
    ]);
    expect(entry.attachmentName?.length).toBe(120);
    expect(Object.keys(entry).sort()).toEqual(["answer", "askedAt", "attachmentName", "citations", "question"]);
  });

  it("drops a name that is not a string, and adds no key for a question without a file", () => {
    const [withJunk, without] = boundTranscript([
      { question: "a", answer: "", citations: [], askedAt: 1, attachmentName: { url: "https://evil" } },
      { question: "b", answer: "", citations: [], askedAt: 2 },
    ]);
    expect(withJunk).not.toHaveProperty("attachmentName");
    expect(without).not.toHaveProperty("attachmentName");
  });
});
