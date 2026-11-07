/**
 * ── WHEN THE MODEL'S PROVIDER, NOT THE CUSTOMER, IS WHY A READ FAILED ──
 *
 * 2026-11-07: the eval account ran out of Anthropic credit. Every plan read
 * failed with `400 … "Your credit balance is too low to access the Anthropic
 * API"`, and each sheet said "couldn't be identified just now, and the attempt
 * still used one of your monthly sheets. Retry it" — the walk pressed Keep
 * reading 107 times in 338 s, charging a sheet every time, for a fault that was
 * ours.
 *
 * A provider outage is: the account is out of credit, the provider is
 * rate-limiting (429), the provider failed or is overloaded (5xx, 529), or the
 * request never reached it (a connection error or timeout). None of these is
 * something a customer can cause, and none bills tokens: the request was refused
 * before any model ran. So the sheet is given back, the page retries by itself,
 * and the screen says one thing, once (`PLAN_READING_UNAVAILABLE`).
 *
 * Anything else — a malformed reply, a refusal of the content — stays an ordinary
 * failure: claimed, counted, and retried by hand, as before.
 */
export const PLAN_READING_UNAVAILABLE = "Plan reading is temporarily unavailable; we'll retry automatically, and you won't be charged.";

type ErrorLike = { status?: unknown; message?: unknown; name?: unknown; error?: unknown; cause?: unknown };

export function isProviderOutage(err: unknown, depth = 0): boolean {
  if (err === null || typeof err !== "object" || depth > 3) return false;
  const e = err as ErrorLike;
  const status = typeof e.status === "number" ? e.status : null;
  const text = `${typeof e.message === "string" ? e.message : ""} ${safeJson(e.error)}`;
  if (status === 429) return true;
  if (status !== null && status >= 500) return true;
  if (status === 400 && /credit balance is too low|billing/i.test(text)) return true;
  if (status === null && typeof e.name === "string" && /APIConnection(Timeout)?Error|ConnectionError|TimeoutError/.test(e.name)) return true;
  return isProviderOutage(e.cause, depth + 1);
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
