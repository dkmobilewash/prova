/**
 * Whether DocuSign is set up on THIS install, and what its card offers.
 *
 * Pure, so every state is unit-tested without a page.
 *
 * "Set up" means the four DocuSign variables plus INTEGRATION_TOKEN_KEY (the
 * key tokens are encrypted with — see lib/crypto.ts). Without the key a
 * Connect button would walk the owner through DocuSign's consent screen and
 * then fail to store the result. DOCUSIGN_ENV must be exactly `demo` or
 * `production`; anything else reads as not set up rather than as a guess.
 *
 * DOCUSIGN_CONNECT_HMAC_KEY is deliberately NOT in the required list. It
 * turns on AUTOMATIC status updates (DocuSign Connect). Without it an
 * envelope still sends, and its status still arrives when someone presses
 * Refresh — a slower feature, not a broken one — and the card says which of
 * the two this install has.
 */

export const DOCUSIGN_REQUIRED_ENV = [
  "DOCUSIGN_CLIENT_ID",
  "DOCUSIGN_CLIENT_SECRET",
  "DOCUSIGN_REDIRECT_URI",
  "DOCUSIGN_ENV",
  "INTEGRATION_TOKEN_KEY",
] as const;

export const DOCUSIGN_WEBHOOK_ENV = "DOCUSIGN_CONNECT_HMAC_KEY";

type Env = Record<string, string | undefined>;

export function docuSignSetup(env: Env): {
  configured: boolean;
  missing: string[];
  webhooks: boolean;
} {
  const missing: string[] = DOCUSIGN_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  const environment = env.DOCUSIGN_ENV?.trim();
  if (environment && environment !== "demo" && environment !== "production") missing.push("DOCUSIGN_ENV");
  return { configured: missing.length === 0, missing, webhooks: Boolean(env[DOCUSIGN_WEBHOOK_ENV]?.trim()) };
}

export type DocuSignCardState = "not-set-up" | "connect" | "connected" | "reconnect";

export function docuSignCardState(configured: boolean, status: string | null | undefined): DocuSignCardState {
  if (!configured) return "not-set-up";
  if (status === "CONNECTED") return "connected";
  if (status === "NEEDS_REAUTH" || status === "ERROR") return "reconnect";
  return "connect";
}

/** `?docusign=…&docusign_detail=…` on the Integrations page, as a sentence.
 * Fixed codes set by the callback; nothing from the URL is echoed. */
export const DOCUSIGN_CALLBACK_MESSAGES: Record<string, string> = {
  connected:
    "DocuSign is connected. Contracts and change orders now offer Send with DocuSign beside C Stream's own signing link.",
  access_denied: "DocuSign wasn't connected — the request was declined on DocuSign's screen.",
  state_mismatch:
    "DocuSign wasn't connected: the sign-in came back without the check this app sent with it. Press Connect and try again, in the same browser tab.",
  identity_mismatch:
    "DocuSign wasn't connected: the person who finished connecting isn't the one who started. Press Connect again while signed in as the account owner.",
  not_owner: "Only the account owner can connect DocuSign.",
  not_configured: "DocuSign isn't set up on this install yet.",
  missing_params: "DocuSign sent the browser back without a sign-in code. Press Connect and try again.",
  token_exchange_failed:
    "DocuSign accepted the sign-in but wouldn't hand over access. DocuSign's sign-in codes last two minutes, so press Connect and finish promptly; if it keeps happening, the app keys on this install may be wrong.",
  no_account:
    "DocuSign signed you in but didn't say which account to send from. Make sure your DocuSign user has a default account, then press Connect again.",
};

export function docuSignCallbackMessage(outcome: string | undefined, detail: string | undefined) {
  if (outcome === "connected") return { ok: true, text: DOCUSIGN_CALLBACK_MESSAGES.connected };
  if (outcome === "error") {
    return {
      ok: false,
      text: DOCUSIGN_CALLBACK_MESSAGES[detail ?? ""] ?? "DocuSign wasn't connected. Press Connect and try again.",
    };
  }
  return null;
}
