/**
 * The conversation as a PERSON reads it, which is a different thing from
 * the conversation the model reads.
 *
 * WHY TWO, and why this file is not just `turns.ts` with extra fields.
 * `turns.ts` is the WIRE format: bounded to six, capped per turn, sent with
 * every request, and bounded again on the server because it arrives from a
 * browser. Every byte in it is prompt weight paid on every question. This is
 * the TRANSCRIPT: it never leaves the browser, carries what the screen needs
 * (when it was asked, what it cited) and nothing the model needs, and is
 * bounded by what a person will scroll rather than by what a context window
 * will hold.
 *
 * Keeping them apart means the scrollback can grow, or gain a timestamp, or
 * keep citations, without changing one byte of what is sent to the model or
 * what the server has to validate.
 *
 * WHY STALENESS IS MARKED AT ALL, and the argument it answers. AskPanel's
 * own header refused a scrollback, in terms worth keeping: "a scrollback of
 * stale answers is a place for a number to be read long after it stopped
 * being true." That is correct and it is not an argument against a
 * scrollback — it is a specification for one. The model was already handled:
 * PRIOR_TURNS_RULE tells it the turns are not a source of facts. Nothing was
 * telling the PERSON, who is the one who scrolls up, reads "$32,300
 * overdue", and acts on a figure that was read on Tuesday.
 *
 * So every answer except the newest is marked, with its age in words. The
 * rule is deliberately NOT "older than five minutes": an earlier answer's
 * figures were read at that moment whatever the clock says, and an invoice
 * can be paid in the thirty seconds since. The age tells a person how much
 * to care; the mark tells them it is a different read.
 */

import type { Citation } from "./tools";

export type TranscriptEntry = {
  /** The person's own words. */
  question: string;
  /** What came back. Empty for a question that failed or was refused —
   * those are still worth keeping, because "I asked and it could not" is
   * part of the conversation the person is reading. */
  answer: string;
  /** Where the figures came from, so an old answer is still clickable
   * through to the page that would say what is true NOW. That is the real
   * remedy for staleness: not hiding the number, but making the live one
   * one tap away. */
  citations: Citation[];
  /** Epoch milliseconds. Browser-local and never compared across devices. */
  askedAt: number;
};

/** What a person will scroll, not what a model will hold. Twenty is well
 * past a single sitting's questions and still trivial to render; the wire
 * format stays at six regardless, in turns.ts. */
export const MAX_TRANSCRIPT = 20;

/** Same cap turns.ts uses, for the same reason: past this it is not
 * conversation, it is a payload — and a browser can put anything here. */
export const MAX_ENTRY_CHARS = 2_000;

/**
 * Parse whatever the browser stored, drop anything malformed, never throw.
 *
 * Forgiving for the reason turns.ts is forgiving: one bad entry in stored
 * history must not stop somebody asking a question. The failure mode of
 * dropping an entry is a shorter scrollback. The failure mode of rejecting
 * the lot is a person who cannot use the product.
 */
export function boundTranscript(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];

  const clean: TranscriptEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { question, answer, citations, askedAt } = entry as Record<string, unknown>;
    if (typeof question !== "string") continue;
    const asked = question.trim();
    if (!asked) continue;
    if (typeof askedAt !== "number" || !Number.isFinite(askedAt)) continue;

    clean.push({
      question: asked.slice(0, MAX_ENTRY_CHARS),
      answer: typeof answer === "string" ? answer.trim().slice(0, MAX_ENTRY_CHARS) : "",
      citations: Array.isArray(citations)
        ? citations.flatMap((citation) => {
            if (typeof citation !== "object" || citation === null) return [];
            const { label, href } = citation as Record<string, unknown>;
            if (typeof label !== "string" || typeof href !== "string") return [];
            // Relative, in-app hrefs only. A stored transcript is browser
            // input like any other, and a link rendered from it must not be
            // able to point off-site.
            if (!href.startsWith("/") || href.startsWith("//")) return [];
            return [{ label, href }];
          })
        : [],
      askedAt,
    });
  }

  return clean.slice(-MAX_TRANSCRIPT);
}

/**
 * How long ago, in the words a person uses.
 *
 * Coarse on purpose. "2 hours ago" is what somebody needs to decide whether
 * to trust a figure; "2 hours 14 minutes ago" is a precision the underlying
 * question does not have, and printing it implies the number decays on a
 * schedule somebody could calculate.
 */
export function answeredAgo(askedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - askedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Which entries carry figures that were read at a different moment.
 *
 * EVERY entry except the last, and that is the whole rule. Not "older than
 * N minutes": an earlier answer's numbers were read when they were read,
 * and an invoice can be paid in the thirty seconds since. A time threshold
 * would make a two-minute-old figure look authoritative, which is the
 * exact reading the original no-scrollback decision was protecting against.
 *
 * Returns indices rather than mutating, so the caller renders and this
 * stays testable without a DOM.
 */
export function staleIndices(entries: readonly TranscriptEntry[]): number[] {
  if (entries.length <= 1) return [];
  return entries.slice(0, -1).map((_entry, index) => index);
}

/** What the mark says. Its own export so a test asserts the sentence rather
 * than a boolean — a warning that does not say what to do is decoration. */
export function stalenessNote(askedAt: number, now: number): string {
  return `Answered ${answeredAgo(askedAt, now)} — the figures were read then. Ask again for what is true now.`;
}

/** How long a collapsed row's question is allowed to run before it is cut.
 * Roughly one line on a phone; the full text is one tap away. */
export const SUMMARY_CHARS = 72;

/**
 * The one line a collapsed entry shows: the person's OWN QUESTION, cut to
 * fit, never a fragment of the answer.
 *
 * THIS IS THE WHOLE DESIGN DECISION AND IT IS DELIBERATE. The obvious
 * "summary" of an exchange is the first sentence of the answer, and it is
 * the one thing that must not go here. "Nothing is overdue on Riverside.
 * $32,300 is overdue on Brackett." clipped to its first sentence reads as
 * a clean bill on the exact question somebody asked because they were
 * worried. A truncated ANSWER makes a new, shorter, false claim; a
 * truncated QUESTION is visibly the reader's own words with an ellipsis on
 * the end, and the worst it can do is fail to remind them which question
 * it was — which the tap fixes.
 *
 * So the collapsed row carries the question, the age, and the pages the
 * figures came from. No number is on screen until the row is open, which
 * is also why the staleness note lives in the expanded view: the mark
 * travels with the figures it is about.
 */
export function summarizeQuestion(question: string, limit: number = SUMMARY_CHARS): string {
  // Dictation arrives as one long run and a pasted question can carry
  // newlines; either way a row is one line.
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  // A question with no space in `limit` characters is one enormous token;
  // cutting mid-word beats returning the whole thing and blowing the row.
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
