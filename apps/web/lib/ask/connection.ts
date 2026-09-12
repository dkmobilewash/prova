import type { AnthropicConnection } from "@prova/integrations";

/**
 * The sentence for a failed connection check, from the API's own answer.
 * Each one says what to fix, because the person reading it is the owner
 * on the settings page, not somebody with the runtime log open. The key
 * itself is never here; neither is anything from the request.
 */
export function connectionProblem(result: Extract<AnthropicConnection, { ok: false }>, model: string): string {
  const { status, type } = result;
  if (type === "not_configured") {
    return "No Anthropic API key is set on this server. Add ANTHROPIC_API_KEY to this environment and redeploy — a key saved after a deployment was built does not reach it.";
  }
  if (type === "connection_error") {
    return "Could not reach Anthropic from this server. Try again in a minute; if it keeps happening, this server cannot make outbound requests.";
  }
  if (status === 401) {
    return "Anthropic rejected the key (401 authentication_error). Check the key in this environment against the Anthropic Console, then redeploy.";
  }
  if (status === 403) {
    return `The key works, but it is not allowed to use ${model} (403 ${type ?? "permission_error"}). Check the organization's access in the Anthropic Console.`;
  }
  if (status === 404) {
    return `The key works, but this organization cannot use ${model} (404 ${type ?? "not_found_error"}).`;
  }
  if (status === 429) {
    return "Anthropic is rate-limiting this key right now (429). Try again shortly.";
  }
  if (status !== null && status >= 500) {
    return `Anthropic is having trouble (${status} ${type ?? "api_error"}). Try again shortly.`;
  }
  return `Anthropic answered ${status ?? "no status"} ${type ?? ""}`.trim() + ".";
}
