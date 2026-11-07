/** The error the SDK threw on 2026-11-07, in its shape: a status and the API's error body. */
export function creditError(): Error {
  return Object.assign(
    new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'),
    { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } },
  );
}
