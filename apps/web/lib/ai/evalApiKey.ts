/**
 * THE KEY CHECK EVERY EVAL MAKES, in one place.
 *
 * Each eval here refuses to start without an API key rather than passing on
 * nothing, for the reason they all give: **a green run of zero cases and a green
 * run of nine look identical in a terminal.** That much was already shared by
 * convention — three copies of the same four lines.
 *
 * Then one of them grew a second check the others did not have, and that is why
 * this file exists rather than a fourth copy.
 *
 * ── THE SECOND CHECK, AND THE BUG THAT EARNED IT ──
 *
 * "Is the variable set" is satisfied perfectly by the placeholder in the eval's
 * OWN run instructions. Those read `ANTHROPIC_API_KEY=sk-ant-…`, and a person
 * pasting that unedited sets the variable to one character, sails past the
 * guard, and fails forty seconds later as an authentication error against the
 * API — which reads like a broken eval rather than an unedited command.
 *
 * Checked by LENGTH rather than by an `sk-ant-` prefix, so a gateway or proxy
 * key is not refused for not looking like one. The key itself is never printed;
 * the message gives a character count and names the likely cause.
 *
 * Shared because the alternative was three copies drifting — `document-uploads.ts`
 * records what that cost when five actions each declared their own 15MB limit,
 * and `LOCATION_TYPES` is the repo's standing example of a second copy of a list
 * coming to disagree with the first.
 */
export function requireEvalApiKey(evalName: string): void {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(`ANTHROPIC_API_KEY is not set: the ${evalName} did not run. It is not a pass.`);
  }
  if (key.length < 20) {
    throw new Error(
      `ANTHROPIC_API_KEY is set to ${key.length} character(s), which is too short to be a key: the ` +
        `${evalName} did not run. If you pasted the command with its "…" placeholder still in it, that is this.`,
    );
  }
}
