/**
 * The smallest Lob client that mails a letter. Injected fetch so the test
 * sees the exact request; no SDK, because one endpoint does not justify a
 * dependency.
 *
 * Read off docs.lob.com 2026-10-14: POST /v1/letters, HTTP Basic with the
 * API key as the username and an empty password, `file` may be an HTML
 * string, `use_type` is required (`marketing` for us — this is a sales
 * letter and the law says so on the page), `color` is required,
 * `address_placement: top_first_page` leaves the top of page one for the
 * address window. `Idempotency-Key` is a header, 256 chars max: Lob returns
 * the ORIGINAL letter for a repeated key, which is what makes a retry safe.
 *
 * KEYS. A `test_…` key accepts every request, renders a PDF and mails
 * NOTHING. A `live_…` key prints and posts. The prefix is the only
 * difference visible from here, so `keyMode()` says which one is in play
 * and the page prints it next to the Send button.
 */

export type LobAddress = {
  name: string;
  company?: string;
  address_line1: string;
  address_city: string;
  address_state: string;
  address_zip: string;
};

export type LobLetterRequest = {
  to: LobAddress;
  from: LobAddress;
  html: string;
  description: string;
  idempotencyKey: string;
};

export type LobLetterResult = { ok: true; id: string; expectedDeliveryOn: string | null; url: string | null } | { ok: false; error: string };

export const LOB_LETTERS_URL = "https://api.lob.com/v1/letters";

export function keyMode(apiKey: string | undefined): "live" | "test" | "missing" {
  if (!apiKey) return "missing";
  return apiKey.startsWith("live_") ? "live" : "test";
}

export async function createLetter(
  req: LobLetterRequest,
  deps: { apiKey: string | undefined; fetchImpl?: typeof fetch },
): Promise<LobLetterResult> {
  if (!deps.apiKey) return { ok: false, error: "LOB_API_KEY is not set, so nothing can be mailed." };
  const fetchImpl = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(LOB_LETTERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${deps.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify({
        to: req.to,
        from: req.from,
        file: req.html,
        description: req.description.slice(0, 255),
        color: false,
        double_sided: false,
        use_type: "marketing",
        address_placement: "top_first_page",
        mail_type: "usps_first_class",
      }),
    });
  } catch (error) {
    return { ok: false, error: `Lob could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  const json = (await res.json().catch(() => null)) as
    | { id?: string; expected_delivery_date?: string; url?: string; error?: { message?: string; status_code?: number; code?: string } }
    | null;
  if (!res.ok || !json?.id) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, error: `Lob refused the letter (${json?.error?.code ?? res.status}): ${message}` };
  }
  return { ok: true, id: json.id, expectedDeliveryOn: json.expected_delivery_date ?? null, url: json.url ?? null };
}
