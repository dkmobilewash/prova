import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASK_MAX_LENGTH,
  DICTATION_TRUNCATED_NOTE,
  finalTranscript,
  mergeDictation,
  speechRecognitionFrom,
} from "./speechInput";

describe("which browsers get a mic button", () => {
  it("finds the unprefixed constructor", () => {
    expect(speechRecognitionFrom({ SpeechRecognition: function () {} })).toBeTypeOf("function");
  });

  it("finds the webkit-prefixed one, which is what Chrome and Safari actually ship", () => {
    expect(speechRecognitionFrom({ webkitSpeechRecognition: function () {} })).toBeTypeOf("function");
  });

  it("returns null on a browser with neither, so no button renders", () => {
    // Firefox today. A mic that is visible and does nothing is worse than an
    // absent one: the person taps it, nothing happens, and they conclude the
    // feature is broken rather than not offered here.
    expect(speechRecognitionFrom({})).toBeNull();
  });

  it("returns null rather than throwing when there is no window at all", () => {
    // Server render. This module is imported by a client component, but the
    // module graph is still evaluated on the server.
    expect(speechRecognitionFrom(undefined)).toBeNull();
    expect(speechRecognitionFrom(null)).toBeNull();
  });

  it("refuses a non-callable that happens to sit under the right key", () => {
    expect(speechRecognitionFrom({ SpeechRecognition: true })).toBeNull();
  });
});

describe("reading one result event", () => {
  const event = (results: { transcript: string; isFinal: boolean }[], resultIndex = 0) => ({
    resultIndex,
    results: results.map((r) => Object.assign([{ transcript: r.transcript }], { isFinal: r.isFinal })),
  });

  it("joins the final phrases", () => {
    expect(finalTranscript(event([{ transcript: "log eight hours ", isFinal: true }]))).toBe("log eight hours");
  });

  it("DROPS interim results, which is the whole reason this function exists", () => {
    // An interim result rewrites itself as the recogniser changes its mind.
    // Appending them puts the same words in the box three times, and the
    // person watches their own sentence stutter.
    const mixed = event([
      { transcript: "log eight", isFinal: false },
      { transcript: "log eight hours", isFinal: true },
    ]);
    expect(finalTranscript(mixed)).toBe("log eight hours");
  });

  it("starts at resultIndex, not at zero", () => {
    // The event carries every result so far, and resultIndex says which are
    // new. Reading from zero re-appends the entire dictation on every event.
    const later = event(
      [
        { transcript: "already handled", isFinal: true },
        { transcript: "the new part", isFinal: true },
      ],
      1,
    );
    expect(finalTranscript(later)).toBe("the new part");
  });

  it("is empty when nothing has been finalised yet", () => {
    expect(finalTranscript(event([{ transcript: "lo", isFinal: false }]))).toBe("");
  });
});

describe("merging speech into what is already typed", () => {
  it("fills an empty box", () => {
    expect(mergeDictation("", "start an estimate")).toEqual({ text: "start an estimate", truncated: false });
  });

  it("joins typed text and spoken text into one sentence", () => {
    expect(mergeDictation("log 8 hours", "for Tino on Riverside").text).toBe("log 8 hours for Tino on Riverside");
  });

  it("does not double the space when the typed text already ends in one", () => {
    expect(mergeDictation("log 8 hours ", "for Tino").text).toBe("log 8 hours for Tino");
  });

  it("appends rather than replaces, so a three-phrase sentence survives", () => {
    // The failure this prevents: assigning each chunk leaves only the last
    // phrase, which is the most confident-looking way to lose what was said.
    let box = "";
    for (const phrase of ["log eight hours", "for Tino", "on Riverside"]) {
      box = mergeDictation(box, phrase).text;
    }
    expect(box).toBe("log eight hours for Tino on Riverside");
  });

  it("ignores an empty or whitespace-only phrase", () => {
    expect(mergeDictation("keep this", "   ")).toEqual({ text: "keep this", truncated: false });
  });
});

describe("the cap, which is the half a screen cannot show you", () => {
  it("never exceeds the limit", () => {
    const existing = "x".repeat(ASK_MAX_LENGTH - 10);
    const result = mergeDictation(existing, "one two three four five six seven");
    expect(result.text.length).toBeLessThanOrEqual(ASK_MAX_LENGTH);
  });

  it("REPORTS that it capped, instead of silently dropping the tail", () => {
    // The whole reason this returns an object. A speaker gets no feedback
    // from a full field the way a typist does — they keep talking and the
    // words go nowhere.
    const existing = "x".repeat(ASK_MAX_LENGTH - 10);
    expect(mergeDictation(existing, "one two three four five six seven").truncated).toBe(true);
  });

  it("cuts at a word boundary, never mid-word", () => {
    const existing = "x".repeat(ASK_MAX_LENGTH - 12);
    const { text } = mergeDictation(existing, "Riverside Northgate");
    const tail = text.slice(ASK_MAX_LENGTH - 12).trim();
    // Whatever landed, it is whole words — a half word reads as a bug the
    // person will try to fix rather than as a limit they have reached.
    expect(tail === "" || "Riverside Northgate".startsWith(tail)).toBe(true);
    expect(tail).not.toMatch(/^Riversi.$/);
  });

  it("keeps the person's own typing when not one more word fits", () => {
    // It must never trim what they typed to make room for speech they
    // cannot see.
    const full = "x".repeat(ASK_MAX_LENGTH);
    expect(mergeDictation(full, "and one more thing")).toEqual({ text: full, truncated: true });
  });

  it("does not claim truncation when everything fit", () => {
    // The other direction. A warning that fires on a successful dictation
    // teaches the person to ignore it.
    expect(mergeDictation("short", "also short").truncated).toBe(false);
  });

  it("has a note that tells the person what to DO", () => {
    expect(DICTATION_TRUNCATED_NOTE).toMatch(/second question/i);
  });
});

describe("the cap is the same number in both places", () => {
  it("matches the input's own maxLength", () => {
    // A cap enforced in two places is a cap enforced in neither. This reads
    // the component rather than trusting that somebody kept them in step,
    // and it is the assertion that fails when a future edit raises one.
    const source = readFileSync(join(process.cwd(), "components/AskPanel.tsx"), "utf8");
    const declared = source.match(/maxLength=\{(\d+)\}/);
    expect(declared, "AskPanel no longer declares a maxLength on the Ask input").not.toBeNull();
    expect(Number(declared![1])).toBe(ASK_MAX_LENGTH);
  });
});
