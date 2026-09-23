/**
 * How often the generic webhook receiver will write a row for one connection
 * (#353 finding 3).
 *
 * The route at /api/integrations/webhooks/[provider] is public and
 * unauthenticated by necessity, and until a provider brings a signature it
 * can verify, the ONLY thing it does is write "a webhook arrived" against a
 * connection the payload names. That was bounded by the payload having to
 * name a real `externalAccountId` — and the sandbox connection's id is the
 * constant "sandbox-000", so the bound was a fiction: anyone with the URL
 * could grow IntegrationSyncLog without limit.
 *
 * Two things close it. The sandbox provider is no longer accepted by that
 * route at all (nothing real ever posts to a sandbox). And for the providers
 * that remain, a connection gets at most one WEBHOOK_RECEIVED row per window
 * — the row is a health breadcrumb an operator reads ("did the provider ever
 * call us"), and a thousand of them in a minute say nothing the first did
 * not. Pure so it can be tested without a database.
 */
export const WEBHOOK_LOG_WINDOW_MS = 60_000;

export function shouldRecordWebhook(
  lastRecordedAt: Date | null,
  now: Date,
  windowMs: number = WEBHOOK_LOG_WINDOW_MS,
): boolean {
  if (lastRecordedAt === null) return true;
  return now.getTime() - lastRecordedAt.getTime() >= windowMs;
}
