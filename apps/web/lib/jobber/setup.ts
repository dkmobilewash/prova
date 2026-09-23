/**
 * Whether Jobber is set up on THIS install, and what the card should offer.
 *
 * Pure, so the card's four states are unit-tested without a page. The
 * Integrations page calls these with `process.env` and the connection row.
 *
 * "Set up" needs four variables, not three: Jobber's client id, secret and
 * redirect URI, and `INTEGRATION_TOKEN_KEY`, the key tokens are encrypted
 * with (lib/crypto.ts). Without that key a Connect button would send the
 * owner through Jobber's consent screen and then fail to store the result —
 * a broken button with extra steps. So a missing key reads as "not set up"
 * exactly like a missing client id.
 */

export const JOBBER_REQUIRED_ENV = [
  "JOBBER_CLIENT_ID",
  "JOBBER_CLIENT_SECRET",
  "JOBBER_REDIRECT_URI",
  "INTEGRATION_TOKEN_KEY",
] as const;

type Env = Record<string, string | undefined>;

export function jobberSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing = JOBBER_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

export type ImportCardState =
  /** No keys on this install: says so, offers nothing to press. */
  | "not-set-up"
  | "connect"
  | "connected"
  /** Jobber stopped accepting the stored credential: reconnect. */
  | "reconnect";

export function importCardState(configured: boolean, status: string | null | undefined): ImportCardState {
  if (!configured) return "not-set-up";
  if (status === "CONNECTED") return "connected";
  if (status === "NEEDS_REAUTH" || status === "ERROR") return "reconnect";
  return "connect";
}

/** What `?jobber=error&jobber_detail=…` on the Integrations page means, in a
 * sentence. The detail is a fixed code set by the callback, never text from
 * Jobber, so nothing a URL carries is echoed onto the page. */
export const JOBBER_CALLBACK_MESSAGES: Record<string, string> = {
  connected: "Jobber is connected. Press Import from Jobber to see what will come across.",
  access_denied: "Jobber wasn't connected — the request was declined on Jobber's screen.",
  state_mismatch:
    "Jobber wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "Jobber wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect Jobber.",
  not_configured: "Jobber isn't set up on this install yet.",
  missing_params: "Jobber sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "Jobber accepted the sign-in but wouldn't hand over access. Press Connect and try again; if it keeps happening, the app keys on this install may be wrong.",
};

export function jobberCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: JOBBER_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return {
      ok: false,
      text: JOBBER_CALLBACK_MESSAGES[detail ?? ""] ?? "Jobber wasn't connected. Press Connect and try again.",
    };
  }
  return null;
}
