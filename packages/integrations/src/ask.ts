import Anthropic from "@anthropic-ai/sdk";

/**
 * A tool-calling conversation, with the provider kept on this side of the
 * boundary.
 *
 * The SDK is imported in this package only — same reason email.ts is
 * provider-agnostic: swapping provider should not mean touching the app.
 * What the app supplies is the part that must not live here: the tool
 * definitions, and an `execute` closure that already knows which company is
 * asking. This module never sees a tenant id and has no way to fetch
 * anything, which is what makes "the model cannot choose whose data" a
 * property of the shape rather than a promise in a prompt.
 */

export type AskToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
};

/** What a tool run gives back to the model. `isError` marks a failed
 * lookup, which the model is told about rather than left to infer from
 * silence. */
export type AskToolOutcome = { content: string; isError?: boolean };

export type AskConversationResult =
  | { ok: true; text: string; toolsCalled: string[] }
  | { ok: false; error: string; reason: "refusal" | "no_text" | "exhausted" | "api" };

export type AskConversationOptions = {
  system: string;
  question: string;
  tools: AskToolDefinition[];
  /** Runs one tool. Supplied by the caller already bound to a company. */
  execute: (name: string, input: unknown) => Promise<AskToolOutcome>;
  /** API calls, not tool calls: a turn asking for four tools at once costs
   * one. Guards against a confused loop, not against breadth. */
  maxPasses?: number;
  model?: string;
};

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_PASSES = 6;

export function anthropicIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runToolConversation(
  options: AskConversationOptions,
): Promise<AskConversationResult> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: options.question },
  ];
  const toolsCalled: string[] = [];
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;

  try {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const response = await client.messages.create({
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        system: options.system,
        tools: options.tools,
        messages,
      });

      // A safety decline arrives as a 200 with no useful content. Reported
      // as itself rather than rendered as a blank answer.
      if (response.stop_reason === "refusal") {
        return { ok: false, error: "The assistant declined that one.", reason: "refusal" };
      }

      if (response.stop_reason === "tool_use") {
        const calls = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        messages.push({ role: "assistant", content: response.content });

        // Run them together. The model asks for several at once precisely
        // when they are independent, and answering "what needs me today"
        // one round trip at a time is the difference between a usable
        // feature and a slow one.
        const outcomes = await Promise.all(
          calls.map(async (call) => {
            try {
              // Tool inputs are parsed JSON from the SDK, never matched as
              // strings — escaping in tool input differs across models.
              const outcome = await options.execute(call.name, call.input ?? {});
              return { call, outcome };
            } catch {
              // One failing tool must not lose the whole answer.
              return {
                call,
                outcome: {
                  content: `The ${call.name} lookup failed. Do not guess at what it would have said.`,
                  isError: true,
                },
              };
            }
          }),
        );

        // Every result goes back in ONE user message. Splitting them across
        // messages teaches the model to stop asking for tools in parallel.
        messages.push({
          role: "user",
          content: outcomes.map(({ call, outcome }) => {
            if (!outcome.isError) toolsCalled.push(call.name);
            return {
              type: "tool_result" as const,
              tool_use_id: call.id,
              is_error: outcome.isError,
              content: outcome.content,
            };
          }),
        });
        continue;
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!text) {
        return { ok: false, error: "No answer came back.", reason: "no_text" };
      }
      return { ok: true, text, toolsCalled };
    }

    // Out of passes. Saying so beats returning a half-formed turn as an
    // answer.
    return { ok: false, error: "That needed more steps than allowed.", reason: "exhausted" };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limited.", reason: "api" };
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The API key was rejected.", reason: "api" };
    }
    if (err instanceof Anthropic.APIError) {
      // Deliberately not err.message — it can carry request details, and
      // the caller puts this on screen.
      return { ok: false, error: "The assistant is unavailable.", reason: "api" };
    }
    throw err;
  }
}
