/**
 * Whether Procore is set up on THIS install, and what the card offers.
 *
 * Pure, so the card's states are unit-tested without a page. Same rule as
 * lib/jobber/setup.ts: "set up" includes INTEGRATION_TOKEN_KEY, because a
 * Connect button that walks the owner through Procore's sign-in and then
 * cannot store the result is a broken button with extra steps.
 *
 * PROCORE_ENVIRONMENT is NOT required. Unset means production; "sandbox"
 * points every call at Procore's sandbox hosts. See
 * packages/integrations/src/procore.ts.
 */

export const PROCORE_REQUIRED_ENV = [
  "PROCORE_CLIENT_ID",
  "PROCORE_CLIENT_SECRET",
  "PROCORE_REDIRECT_URI",
  "INTEGRATION_TOKEN_KEY",
] as const;

type Env = Record<string, string | undefined>;

export function procoreSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing = PROCORE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

/**
 * Moved to lib/integrations/feedCardState.ts 2026-09-19 when ACC needed the
 * identical decision — nothing in it was Procore-specific. Re-exported here
 * so this stays a one-line change: procore/setup.test.ts's
 * `import { feedCardState } from "./setup"` and the Integrations page's
 * `import { feedCardState } from "@/lib/procore/setup"` both keep working
 * unchanged.
 */
export { feedCardState, type FeedCardState } from "@/lib/integrations/feedCardState";

/** `?procore=error&procore_detail=…` as a sentence. The detail is a fixed
 * code set by the callback, never text from Procore or the URL. */
export const PROCORE_CALLBACK_MESSAGES: Record<string, string> = {
  connected:
    "Procore is connected. Link a Procore project to one of your jobs below, and its drawings, RFIs and submittals will show on that job's pages.",
  access_denied: "Procore wasn't connected — the request was declined on Procore's screen.",
  state_mismatch:
    "Procore wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "Procore wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect Procore.",
  not_configured: "Procore isn't set up on this install yet.",
  missing_params: "Procore sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "Procore accepted the sign-in but wouldn't hand over access. Press Connect and try again; if it keeps happening, the app keys on this install may be wrong.",
};

export function procoreCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: PROCORE_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return {
      ok: false,
      text: PROCORE_CALLBACK_MESSAGES[detail ?? ""] ?? "Procore wasn't connected. Press Connect and try again.",
    };
  }
  return null;
}
