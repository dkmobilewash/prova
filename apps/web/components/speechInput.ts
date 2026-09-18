/**
 * Dictation into the Ask box, as arithmetic rather than as a component.
 *
 * The button itself is six lines in AskPanel. Everything that can be WRONG
 * about dictation is here, because a component cannot be unit-tested in this
 * repo and this logic has two failure modes that are invisible on screen.
 *
 * WHY DICTATION NEEDS ITS OWN MERGE AT ALL, rather than setting the value.
 * Speech recognition hands back a final phrase at a time, not one string at
 * the end. Somebody dictating "log eight hours for Tino on Riverside" can
 * get that as three results. Assigning each one to the box would leave only
 * the last phrase, which is the most confident-looking way to lose most of
 * what a person said. So chunks append, and typing before or between them
 * survives.
 *
 * WHY THE CAP IS LOAD-BEARING. The input carries maxLength={1000}, and a
 * typed field enforces that visibly — the characters stop appearing and the
 * person stops typing. Dictation has no such feedback: the speaker keeps
 * talking, the browser keeps producing text, and a naive append either blows
 * past the limit the server also enforces or silently drops the tail. This
 * returns `truncated` so the panel can say so out loud. Saying "that is as
 * much as the box holds" is the whole product's rule applied to a microphone:
 * do not quietly do less than what was asked and let it look like success.
 */

/** The Ask box's own limit. Must equal the `maxLength` on the input in
 * AskPanel, and `askInputLimit.test.ts` fails the build if the two drift —
 * a cap enforced in two places is a cap enforced in neither. */
export const ASK_MAX_LENGTH = 1000;

/** The shape this module needs from a SpeechRecognition instance. Deliberately
 * structural and minimal: `SpeechRecognition` is not in TypeScript's DOM lib
 * at all, `webkitSpeechRecognition` is a vendor prefix, and importing a types
 * package for one button is not worth a dependency. */
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechResultEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The constructor this browser offers, or null.
 *
 * Null is a real answer and the button must not render on it. A mic that is
 * visible and does nothing is worse than no mic: the person taps it, nothing
 * happens, and they conclude the feature is broken rather than absent. Chrome
 * and Safari have this; Firefox does not, at time of writing.
 *
 * Takes the window rather than reading the global so the decision is testable
 * without a browser — which is the only reason this is a function. */
export function speechRecognitionFrom(win: unknown): SpeechRecognitionCtor | null {
  if (typeof win !== "object" || win === null) return null;
  const candidate =
    (win as Record<string, unknown>).SpeechRecognition ??
    (win as Record<string, unknown>).webkitSpeechRecognition;
  return typeof candidate === "function" ? (candidate as SpeechRecognitionCtor) : null;
}

/** Every FINAL phrase in one result event, joined. Interim results are
 * deliberately dropped: they rewrite themselves as the recogniser changes its
 * mind, and appending them produces the same words three times. */
export function finalTranscript(event: SpeechResultEventLike): string {
  let out = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result || !result.isFinal) continue;
    const alternative = result[0];
    if (alternative) out += alternative.transcript;
  }
  return out.trim();
}

export type Dictated = {
  /** What the box should now hold. */
  text: string;
  /** True when the cap stopped some of what was said from landing. The panel
   * says so; it is never silently dropped. */
  truncated: boolean;
};

/**
 * Add a dictated phrase to what is already in the box.
 *
 * Spacing is decided here rather than by the caller because the two sources
 * interleave: a person types "log 8 hours", taps the mic, says "for Tino on
 * Riverside", and the join between them has to read like one sentence.
 *
 * On overflow this keeps as much of the new phrase as fits and cuts at a WORD
 * boundary — a half word ("Riversi") reads as a bug the person will try to
 * fix, where a short sentence plus an explicit warning reads as a limit.
 */
export function mergeDictation(existing: string, chunk: string, limit = ASK_MAX_LENGTH): Dictated {
  const phrase = chunk.trim();
  if (phrase === "") return { text: existing, truncated: false };

  const needsSpace = existing !== "" && !/\s$/.test(existing);
  const candidate = existing + (needsSpace ? " " : "") + phrase;
  if (candidate.length <= limit) return { text: candidate, truncated: false };

  // No room for even one more word: keep what the person already had rather
  // than trimming their own typing to fit speech they cannot see.
  const room = limit - existing.length - (needsSpace ? 1 : 0);
  if (room <= 0) return { text: existing, truncated: true };

  const kept = phrase.slice(0, room);
  const atBoundary = /\s/.test(phrase.charAt(room));
  const trimmed = atBoundary ? kept : kept.slice(0, kept.lastIndexOf(" "));
  const usable = trimmed.trim();
  if (usable === "") return { text: existing, truncated: true };

  return { text: existing + (needsSpace ? " " : "") + usable, truncated: true };
}

/** What the person is told when the cap bit. Its own export so the test
 * asserts the sentence rather than a boolean — a warning that says nothing
 * useful is the same as no warning. */
export const DICTATION_TRUNCATED_NOTE =
  "That is as much as the box holds. Send this, then dictate the rest as a second question.";
