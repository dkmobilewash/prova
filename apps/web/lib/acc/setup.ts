/**
 * Whether ACC is set up on THIS install, and what the card offers.
 *
 * Pure, so the card's states are unit-tested without a page. Same rule as
 * lib/procore/setup.ts: "set up" includes INTEGRATION_TOKEN_KEY, because a
 * Connect button that walks the owner through Autodesk's sign-in and then
 * cannot store the result is a broken button with extra steps.
 *
 * `feedCardState` itself is shared with Procore's card rather than copied —
 * see lib/integrations/feedCardState.ts.
 */
import { ACC_ENV } from "@prova/integrations";

export const ACC_REQUIRED_ENV = [ACC_ENV.clientId, ACC_ENV.clientSecret, ACC_ENV.redirectUri, "INTEGRATION_TOKEN_KEY"] as const;

type Env = Record<string, string | undefined>;

export function accSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing = ACC_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

export { feedCardState, type FeedCardState } from "@/lib/integrations/feedCardState";

/** `?acc=error&acc_detail=…` as a sentence. The detail is a fixed code set
 * by the callback, never text from Autodesk or the URL. */
export const ACC_CALLBACK_MESSAGES: Record<string, string> = {
  connected:
    "Autodesk Construction Cloud is connected. Link an ACC project to one of your jobs below, and its RFIs and submittals will show on that job's pages.",
  access_denied: "ACC wasn't connected — the request was declined on Autodesk's screen.",
  state_mismatch:
    "ACC wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "ACC wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect Autodesk Construction Cloud.",
  not_configured: "Autodesk Construction Cloud isn't set up on this install yet.",
  missing_params: "Autodesk sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "Autodesk accepted the sign-in but wouldn't hand over access. Press Connect and try again; if it keeps happening, the app keys on this install may be wrong.",
};

export function accCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: ACC_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return {
      ok: false,
      text: ACC_CALLBACK_MESSAGES[detail ?? ""] ?? "ACC wasn't connected. Press Connect and try again.",
    };
  }
  return null;
}
