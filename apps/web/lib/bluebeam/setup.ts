/**
 * Whether Bluebeam is set up on THIS install, and what its card offers.
 *
 * Pure, so every state is unit-tested without a page. Same rule as
 * lib/docusign/setup.ts and lib/companycam/setup.ts: "set up" includes
 * INTEGRATION_TOKEN_KEY, because a Connect button that walks the owner
 * through Bluebeam's consent screen and then cannot store the result is a
 * broken button with extra steps. `BLUEBEAM_REGION` is deliberately NOT
 * required — it defaults to `US` (see packages/integrations/src/
 * bluebeam.ts) — but if it IS set to something outside the five regions
 * Bluebeam actually serves, that is treated as not set up rather than as
 * a guess at what was meant.
 */

export const BLUEBEAM_REQUIRED_ENV = ["BLUEBEAM_CLIENT_ID", "BLUEBEAM_CLIENT_SECRET", "BLUEBEAM_REDIRECT_URI", "INTEGRATION_TOKEN_KEY"] as const;

type Env = Record<string, string | undefined>;

export function bluebeamSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing: string[] = BLUEBEAM_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  const region = env.BLUEBEAM_REGION?.trim();
  if (region && !["US", "DE", "AU", "UK", "SE"].includes(region.toUpperCase())) missing.push("BLUEBEAM_REGION");
  return { configured: missing.length === 0, missing };
}

export type BluebeamCardState = "not-set-up" | "connect" | "connected" | "reconnect";

export function bluebeamCardState(configured: boolean, status: string | null | undefined): BluebeamCardState {
  if (!configured) return "not-set-up";
  if (status === "CONNECTED") return "connected";
  if (status === "NEEDS_REAUTH" || status === "ERROR") return "reconnect";
  return "connect";
}

/** `?bluebeam=…&bluebeam_detail=…` on the Integrations page, as a
 * sentence. Fixed codes set by the callback; nothing from the URL is
 * echoed. */
export const BLUEBEAM_CALLBACK_MESSAGES: Record<string, string> = {
  connected: "Bluebeam is connected. Link a job below to create a Studio Session for it, then push a PDF in.",
  access_denied: "Bluebeam wasn't connected — the request was declined on Bluebeam's screen.",
  state_mismatch:
    "Bluebeam wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "Bluebeam wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect Bluebeam.",
  not_configured: "Bluebeam isn't set up on this install yet.",
  missing_params: "Bluebeam sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "Bluebeam accepted the sign-in but wouldn't hand over access. Press Connect and try again; if it keeps happening, the app keys on this install may be wrong.",
};

export function bluebeamCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: BLUEBEAM_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return { ok: false, text: BLUEBEAM_CALLBACK_MESSAGES[detail ?? ""] ?? "Bluebeam wasn't connected. Press Connect and try again." };
  }
  return null;
}
