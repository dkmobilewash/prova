import { describe, expect, it } from "vitest";
import { anthropicFailureCode } from "@prova/integrations";
import { inviteReadFailed } from "@/lib/bid/inviteReaderAccess";

/**
 * The few words of Anthropic's answer that reach the screen when a model call
 * fails. Born from the 2026-10-30 preview walk: the ask box and the invite
 * reader both said "unavailable" while Check connection said the key worked,
 * and the only place the reason lived was a runtime log.
 */
// apps/web does not depend on the SDK; it is reached through the package that
// does, so the class is the same one `anthropicFailureCode` checks against.
const { default: Anthropic } = await import("../../../../packages/integrations/node_modules/@anthropic-ai/sdk");

const apiError = (status: number, type: string, message: string) =>
  new Anthropic.APIError(status, { type: "error", error: { type, message } }, message, new Headers());

describe("anthropicFailureCode", () => {
  it("names the status and the API's own error type", () => {
    expect(anthropicFailureCode(apiError(529, "overloaded_error", "Overloaded"))).toBe("529 overloaded_error");
  });

  it("names an empty credit balance, which is otherwise a bare 400 invalid_request_error", () => {
    const err = apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.");
    expect(anthropicFailureCode(err)).toBe("the Anthropic credit balance is too low");
  });

  it("keeps any other message text off the screen", () => {
    const err = apiError(400, "invalid_request_error", "tools.3.input_schema: secret-looking detail");
    expect(anthropicFailureCode(err)).toBe("400 invalid_request_error");
  });

  it("says nothing for a failure that was not an answer from the API", () => {
    expect(anthropicFailureCode(new Error("boom"))).toBeNull();
  });
});

describe("inviteReadFailed", () => {
  it("carries the code and no longer points at a Settings page Bid does not have", () => {
    const sentence = inviteReadFailed("529 overloaded_error");
    expect(sentence).toContain("(Anthropic said: 529 overloaded_error)");
    expect(sentence).not.toMatch(/Settings/);
    expect(sentence).toMatch(/couldn't be read.*nothing was saved\.$/);
  });
});
