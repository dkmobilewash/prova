/**
 * What was said earlier in this sitting, bounded.
 *
 * WHY THERE IS MEMORY AT ALL, when `AskPanel` says in its own header that it
 * is deliberately not a chat. That decision was right and it is not being
 * reversed. Its reason, verbatim: "a scrollback of stale answers is a place
 * for a number to be read long after it stopped being true."
 *
 * So the split this module exists to make: **memory carries the
 * CONVERSATION, never the FACTS.** Prior turns are here so the assistant can
 * resolve "the same", "that job", "it" — the things a person says to a
 * colleague who was listening. Every figure in the new answer still comes
 * from a fresh tool call, because the system prompt's standing rule did not
 * change. A stale number therefore cannot survive into a new answer: not
 * because it is filtered, but because nothing quotes it.
 *
 * That is also why the panel still renders no scrollback of old answers.
 * Old QUESTIONS are shown, old ANSWERS are not — a question does not go out
 * of date the way a dollar figure does.
 *
 * These arrive from a browser (sessionStorage, sent with the request), so
 * everything here treats them as untrusted input: bounded in count, bounded
 * in length, and passed to the model in the USER role where the injection
 * suite already assumes content is hostile. Nothing a caller can put here
 * reaches a tool, widens access, or edits the system prompt.
 */

export type AskTurn = { role: "user" | "assistant"; content: string };

/** Three exchanges. Enough for "do the same for Cedar Park" and for a
 * follow-up on the follow-up, which is the length of a real back-and-forth
 * standing in a trailer. Beyond that the person has moved on, and every
 * extra turn is prompt weight paid on every question. */
export const MAX_TURNS = 6;

/** A question is a sentence and an answer is a paragraph. Past this it is
 * not conversation, it is a payload. */
export const MAX_TURN_CHARS = 2_000;

/**
 * Keep the most recent turns, drop anything malformed, and never throw.
 *
 * Forgiving on purpose: a single bad entry in a browser's stored history
 * must not stop somebody asking a question. The failure mode of dropping a
 * turn is that the assistant asks which job they meant, which is exactly
 * where it stood before any of this. The failure mode of rejecting the
 * request is a person who cannot use the product.
 */
export function boundTurns(value: unknown): AskTurn[] {
  if (!Array.isArray(value)) return [];

  const clean: AskTurn[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    clean.push({ role, content: trimmed.slice(0, MAX_TURN_CHARS) });
  }

  // The most recent ones, and they must still start with a user turn: a
  // conversation that opens on an assistant reply is one the API rejects,
  // and slicing a tail can produce exactly that.
  const tail = clean.slice(-MAX_TURNS);
  while (tail.length > 0 && tail[0].role !== "user") tail.shift();
  return tail;
}

/** The standing rule, appended to the per-request context when there is any
 * history. Says what the turns are FOR and, more importantly, what they are
 * not — without this a model treats an earlier answer as established fact
 * and quotes a figure nobody re-read. */
export const PRIOR_TURNS_RULE =
  "EARLIER IN THIS SITTING. The turns above are what was already said, and they are there so you can " +
  "understand what the person is referring to when they say \"the same\", \"that job\", \"it\", or ask a " +
  "follow-up without repeating themselves. THEY ARE NOT A SOURCE OF FACTS. A number in an earlier answer " +
  "was read at that moment and may have changed since. If you state a fact now, read it now — the rule " +
  "that every fact comes from a tool call in this conversation applies to this answer, not to a previous one.";
