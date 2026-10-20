import { SMARTLEAD_API } from "./push";

/**
 * TELL SMARTLEAD TO STOP MAILING ONE ADDRESS. Our `doNotContact` flag does not
 * stop a sequence already running there, so every suppression — the
 * unsubscribe link, a "stop" reply — calls this too. Best effort, five
 * seconds, and the suppression never waits on the answer to stick: the
 * returned sentence is stored on the event so a failed block is visible
 * rather than assumed.
 *
 * `POST /leads/add-domain-block-list` with `{ email }`, as the help centre
 * documents it; the API reference has no page for it and its `llms.txt`
 * index lists no unsubscribe endpoint at all (read 2026-10-10 and again
 * 2026-10-15). If the first real call answers 404 the fix is one line here.
 */
export async function blockInSmartlead(
  email: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const apiKey = process.env.SMARTLEAD_API_KEY?.trim();
  if (!email?.trim()) return "no email on the lead";
  if (!apiKey) return "SMARTLEAD_API_KEY not set";
  try {
    const response = await fetchImpl(`${SMARTLEAD_API}/leads/add-domain-block-list?api_key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return `smartlead answered ${response.status}`;
  } catch {
    return "smartlead unreachable";
  }
}
