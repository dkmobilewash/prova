/**
 * WHETHER THE JOB SCREEN'S ASK BOX CAN ASK, decided on the server before the
 * box is drawn — so a person whose company switched AI off sees the sentence
 * saying so, not a live-looking input that fails after they have typed.
 *
 * Pure: the layout reads the three facts (`askAccessLoad.ts`) and this turns
 * them into what the box shows. Client-safe, because the box imports the type.
 *
 * WHAT IT DOES NOT REPLACE. Every gate `/api/ask` applies still applies on
 * every question, in the same order AskPanel meets them: the server key, the
 * per-company AI switch, the courtesy rate limits and the paid monthly cap,
 * each arriving as an `error` event the box renders as a sentence. This is
 * only the first two read early, so the page can say them up front. A switch
 * flipped after the page loaded is still refused, by the server, in words.
 *
 * `canChange` is the capability half: the Bid box offers commands that need
 * MANAGE_ESTIMATING and VIEW_JOB_COSTS (`lib/ask/surface.ts`). Someone who
 * holds neither can still ASK about the job — the commands are simply not
 * offered to them, exactly as in the CRM — and the box says that instead of
 * letting "add a line" fail mysteriously.
 */
export type BidAskAccess =
  | { available: true; canChange: boolean }
  | { available: false; reason: string };

export const ASK_NOT_CONFIGURED = "Asking isn't set up on this server yet.";

export function bidAskAccess(facts: {
  /** `anthropicIsConfigured()` — the server has a model key at all. */
  configured: boolean;
  /** `aiFeatureRefusal(settings, "ASK")` — the company's own switch's sentence, or null. */
  refusal: string | null;
  /** Whether any command the Bid box offers is one this person may run. */
  canChange: boolean;
}): BidAskAccess {
  if (!facts.configured) return { available: false, reason: ASK_NOT_CONFIGURED };
  if (facts.refusal) return { available: false, reason: facts.refusal };
  return { available: true, canChange: facts.canChange };
}
