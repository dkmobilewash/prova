/**
 * Where a tapped notification leads, from its data payload.
 *
 * Pure on purpose: it lives apart from the expo-notifications plumbing so
 * the routing contract is testable in node, where the lib suite runs —
 * and so the send half (lib/notification-push.ts on the web) and this
 * have exactly one place each stating the contract.
 *
 * The send half writes `{ target: "alerts" }` on digest pushes and
 * `{ jobId }` on assignment pushes (assignCrewMember). Anything else —
 * or nothing at all — names nothing we can answer, and the tap opens the
 * app where it was.
 */
export function targetFromData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) return null;
  if (data.target === "alerts") return "/alerts";
  if (typeof data.jobId === "string" && data.jobId) return `/job/${data.jobId}`;
  return null;
}
