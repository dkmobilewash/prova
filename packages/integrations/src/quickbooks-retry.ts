/**
 * When it is safe to retry a QuickBooks request, and how long to wait.
 *
 * THE RULE THAT MATTERS IS NOT "WHICH ERRORS ARE TRANSIENT". It is which
 * errors prove the request was NOT processed.
 *
 * Retrying a read costs nothing. Retrying a WRITE that may already have
 * landed creates a second invoice or a second payment in somebody's books —
 * the precise failure this integration was built to prevent, reintroduced by
 * the thing meant to make it more reliable. A 500 or a 504 on a POST is the
 * dangerous case: QuickBooks may have created the document and lost the
 * response, and from here the two are indistinguishable.
 *
 * So writes retry only on statuses that mean "definitively refused, nothing
 * happened":
 *
 *   429  rate limited — Intuit rejected it before doing any work
 *   503  service unavailable — same, it never got there
 *
 * and on a transport error where no response came back at all, which means
 * the request never completed a round trip.
 *
 * A 500 or 502 or 504 on a write is surfaced instead. A person re-sending
 * deliberately is safe, because by then a link exists and the payload
 * carries Id and SyncToken, so QuickBooks updates rather than creates —
 * see the note on DUPLICATE_PUSH_WINDOW_MS. An automatic retry has no such
 * guarantee on the first push, which is the only one that can duplicate.
 *
 * Everything here is pure so the decision can be tested without a network.
 */

export type RequestKind = "read" | "write";

/** Statuses that mean the request was refused without being processed. */
const REFUSED_WITHOUT_PROCESSING = new Set([429, 503]);

/** Statuses worth retrying on a read, where a repeat cannot cause harm. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number, kind: RequestKind): boolean {
  return kind === "read" ? TRANSIENT.has(status) : REFUSED_WITHOUT_PROCESSING.has(status);
}

export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/**
 * How long to wait before attempt `attempt` (1-based: the delay BEFORE the
 * second try is backoffMs(1)).
 *
 * Intuit's own `Retry-After` wins when it sends one — guessing shorter than
 * a rate limiter asked simply earns another 429, and guessing longer wastes
 * a serverless function's clock.
 *
 * Jitter is not decoration. Every push in a batch fails at the same instant
 * on the same rate limit, so a fixed backoff retries them all at the same
 * instant too and rebuilds the burst that caused it.
 */
export function backoffMs(
  attempt: number,
  options: { retryAfterSeconds?: number | null; random?: () => number } = {},
): number {
  if (options.retryAfterSeconds != null && options.retryAfterSeconds > 0) {
    return Math.min(options.retryAfterSeconds * 1000, MAX_DELAY_MS);
  }
  const random = options.random ?? Math.random;
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  // Full jitter: anywhere in [half, full]. Keeps a floor so a retry is never
  // effectively immediate, while still spreading a batch out.
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

/**
 * Parses `Retry-After`, which is either seconds or an HTTP date.
 *
 * Returns null for anything unparseable rather than guessing — a bad header
 * should fall back to the backoff curve, not to zero.
 */
export function parseRetryAfter(header: string | null, now: Date = new Date()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  // Only try a date if it looks like one. An HTTP date always carries
  // letters — a weekday, a month, "GMT". Without this guard `Date.parse`
  // accepts junk like "-5" as a year in the distant past, which came back
  // as a zero-second wait: a garbled header became an immediate retry loop,
  // which is the one outcome this function exists to rule out. Found by the
  // test beside it, not by reading.
  if (!/[a-z]/i.test(trimmed)) return null;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  const seconds = Math.ceil((when - now.getTime()) / 1000);
  return seconds > 0 ? seconds : 0;
}
