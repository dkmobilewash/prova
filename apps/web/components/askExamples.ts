/**
 * What the ask box offers before anybody types.
 *
 * A PLAIN MODULE, not part of `AskPanel.tsx`, and for the reason CLAUDE.md
 * already records against `Hint.tsx`: a constant exported from a
 * `"use client"` file arrives across the RSC boundary as a client-reference
 * proxy rather than as its value, and `client-boundary.test.ts` is right to
 * fail on it. `components/hintTiming.ts` is the same shape and the same
 * fix — the constant lives beside the component, never inside it.
 *
 * THE OLDER RULE THESE WERE WRITTEN UNDER STILL HOLDS: each one must be
 * something this app can actually do, because an example that comes back
 * with "I don't have that" teaches people the feature does not work. And
 * none of them names a specific job — one did once, the job did not exist
 * in the data, and a chip asking about a job you do not have is the same
 * broken promise wearing a worked example.
 *
 * WHAT CHANGED, 2026-09-16. Every example used to be a QUESTION. So the
 * first thing anyone learned about this box was that it answers things,
 * while sixteen commands sat behind it that nobody had any reason to
 * suspect. A construction manager reviewing the app concluded the assistant
 * could not act at all — off one correct answer about a record type that
 * does not exist — and he was reading the only evidence he had.
 *
 * Two of the four are now INSTRUCTIONS. Both still obey the rule above:
 *
 *   - "Start an estimate for a new job" requires nothing that must already
 *     exist. A name is the only required input.
 *   - "Log today's field report" resolves the job from the page when you
 *     are standing on one, and otherwise asks which — the clarify path
 *     working, not a broken promise. A question back is not a failure.
 */
export const EXAMPLES = [
  "What's overdue and who do I chase first?",
  "Which drawings am I not building to the latest revision of?",
  "Start an estimate for a new job",
  "Log today's field report",
  "Anything expiring I should renew?",
] as const;

/** Question words an example can open with. Anything not starting with one
 * of these is an instruction — which is the property the census below
 * actually cares about, since "does this box do things" is answered by
 * shape long before anybody reads the words. */
const QUESTION_OPENERS = [
  "what", "which", "who", "when", "where", "why", "how",
  "is", "are", "do", "does", "did", "can", "should", "anything", "any",
];

export function isInstruction(example: string): boolean {
  const first = example.trim().toLowerCase().split(/[\s']/)[0];
  return !QUESTION_OPENERS.includes(first);
}
