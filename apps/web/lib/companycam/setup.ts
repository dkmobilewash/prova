/**
 * Whether CompanyCam is set up on THIS install, and what the card offers.
 *
 * Pure, so the card's states are unit-tested without a page. Same rule as
 * lib/jobber/setup.ts and lib/procore/setup.ts: "set up" includes
 * INTEGRATION_TOKEN_KEY, because a Connect button that walks the owner
 * through CompanyCam's sign-in and then cannot store the result is a
 * broken button with extra steps.
 */

export const COMPANYCAM_REQUIRED_ENV = [
  "COMPANYCAM_CLIENT_ID",
  "COMPANYCAM_CLIENT_SECRET",
  "COMPANYCAM_REDIRECT_URI",
  "INTEGRATION_TOKEN_KEY",
] as const;

type Env = Record<string, string | undefined>;

export function companyCamSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing = COMPANYCAM_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

export type CompanyCamCardState = "not-set-up" | "connect" | "connected" | "reconnect";

export function companyCamCardState(configured: boolean, status: string | null | undefined): CompanyCamCardState {
  if (!configured) return "not-set-up";
  if (status === "CONNECTED") return "connected";
  if (status === "NEEDS_REAUTH" || status === "ERROR") return "reconnect";
  return "connect";
}

/** `?companycam=error&companycam_detail=…` as a sentence. The detail is a
 * fixed code set by the callback, never text from CompanyCam or the URL. */
export const COMPANYCAM_CALLBACK_MESSAGES: Record<string, string> = {
  connected:
    "CompanyCam is connected. Link a CompanyCam project to one of your jobs below, then press Import photos.",
  access_denied: "CompanyCam wasn't connected — the request was declined on CompanyCam's screen.",
  state_mismatch:
    "CompanyCam wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "CompanyCam wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect CompanyCam.",
  not_configured: "CompanyCam isn't set up on this install yet.",
  missing_params: "CompanyCam sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "CompanyCam accepted the sign-in but wouldn't hand over access. Press Connect and try again; if it keeps happening, the app keys on this install may be wrong.",
};

export function companyCamCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: COMPANYCAM_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return {
      ok: false,
      text:
        COMPANYCAM_CALLBACK_MESSAGES[detail ?? ""] ?? "CompanyCam wasn't connected. Press Connect and try again.",
    };
  }
  return null;
}
