/**
 * MILLIONVERIFIER: does this mailbox exist, asked without sending to it.
 *
 * Three verdicts matter. `ok` is a mailbox that exists. `catch_all` is a domain
 * that accepts everything, so the address is ACCEPTED but nothing proved the
 * person is there — written with a verified time and said in words. Every
 * other answer (invalid, disposable, unknown, error) is not usable.
 */

export type Verdict = "deliverable" | "catch_all" | "unusable";

export function interpretVerdict(result: unknown): Verdict {
  if (result === "ok") return "deliverable";
  if (result === "catch_all") return "catch_all";
  return "unusable";
}

export async function verifyEmail(
  email: string,
  apiKey: string,
  doFetch: typeof fetch = fetch,
): Promise<{ verdict: Verdict; result: string }> {
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { verdict: "unusable", result: `http ${response.status}` };
    const body = (await response.json()) as { result?: string };
    return { verdict: interpretVerdict(body.result), result: String(body.result ?? "no result") };
  } catch {
    return { verdict: "unusable", result: "error" };
  }
}
