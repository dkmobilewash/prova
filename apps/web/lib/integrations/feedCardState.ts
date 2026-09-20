/**
 * The card states shared by every "standing read-only feed" integration —
 * Procore today, Autodesk Construction Cloud alongside it. Extracted out of
 * lib/procore/setup.ts (which re-exports it, so nothing that already
 * imports `feedCardState` from there needs to change) rather than copied,
 * because the decision has nothing Procore-specific in it: "not set up"
 * beats everything else, then it is whatever IntegrationConnection.status
 * says.
 */
export type FeedCardState = "not-set-up" | "connect" | "connected" | "reconnect";

export function feedCardState(configured: boolean, status: string | null | undefined): FeedCardState {
  if (!configured) return "not-set-up";
  if (status === "CONNECTED") return "connected";
  if (status === "NEEDS_REAUTH" || status === "ERROR") return "reconnect";
  return "connect";
}
