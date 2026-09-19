import { handleResendInbound } from "@/lib/intake/resend-inbound";

/**
 * Inbound email -> the intake tray. Resend POSTs an `email.received` event
 * here for mail sent to `docs-<token>@<INTAKE_INBOUND_DOMAIN>`.
 *
 * NOT protected by Clerk — see the note in middleware.ts. The provider has
 * no session; the handler authenticates the request itself with the svix
 * signature and fails closed (503 unconfigured, 401 unsigned).
 *
 * A LITERAL `resend` SEGMENT, not a [provider] param, following the
 * DocuSign precedent: a verified provider gets its own door, and the
 * generic /api/integrations/webhooks/[provider] route stays the unverified
 * write-nothing letterbox it documents itself to be. A second inbound email
 * provider would be a second adapter over lib/intake/inbound.ts and its own
 * route beside this one.
 *
 * All the logic lives in lib/intake/resend-inbound.ts so tests exercise the
 * same function with injected transport.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleResendInbound(request);
}
