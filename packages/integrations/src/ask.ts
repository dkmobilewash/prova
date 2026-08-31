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

export type AskFailureReason = "refusal" | "no_text" | "exhausted" | "api";

/** What the caller can render while the answer is being built.
 *
 * A multi-tool question takes 8-11 seconds against a real database, and a
 * static "Reading your records…" for that long reads as a hang. These say
 * what is actually happening.
 */
export type AskEvent =
  /** A round of tool calls has started. `names` is what is being read. */
  | { type: "tools"; names: string[] }
  /** Discard any text shown so far: it was preamble before a tool call,
   * not the answer. Without this a "let me check…" line would sit above
   * the real answer forever. */
  | { type: "reset" }
  /** Tool results are in; what streams from here is the answer, not
   * preamble. Lets the caller stop styling streamed text as provisional. */
  | { type: "answering" }
  | { type: "text"; delta: string }
  | { type: "done"; toolsCalled: string[] }
  | { type: "error"; reason: AskFailureReason };

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

export async function* streamToolConversation(
  options: AskConversationOptions,
): AsyncGenerator<AskEvent> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: options.question },
  ];
  const toolsCalled: string[] = [];
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;

  try {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      // Once a round of tools has run, everything after it is the answer.
      if (pass > 0) yield { type: "answering" };

      // Streamed so text reaches the screen as it is written. The tool
      // rounds before it still take as long as the database does; what
      // changes is that the last few seconds stop being a blank wait.
      const stream = client.messages.stream({
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        // The tools and the system prompt are byte-identical on every pass
        // of every question, and the loop resends them each time — so they
        // are the largest stable prefix in the request and the obvious
        // thing to cache. Caching is a prefix match in the order
        // tools → system → messages, and everything that varies (the
        // question, the growing tool results) sits after them, so nothing
        // here invalidates the cached part.
        //
        // Measured cost this is aimed at: 8.1s to first answer text, 11.1s
        // total on a question that reads eight areas. Most of that is the
        // database, but the prompt is re-processed on every one of those
        // passes and does not need to be.
        // A breakpoint on the system block covers everything before it in
        // the prefix, which is the tool list.
        system: [
          {
            type: "text",
            text: options.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: options.tools,
        messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        }
      }

      // finalMessage() collects the whole turn, so stop_reason and the
      // tool_use blocks are read from one assembled message rather than
      // reconstructed from deltas.
      const response = await stream.finalMessage();

      // A safety decline arrives as a 200 with no useful content. Reported
      // as itself rather than rendered as a blank answer.
      if (response.stop_reason === "refusal") {
        yield { type: "error", reason: "refusal" };
        return;
      }

      if (response.stop_reason === "tool_use") {
        const calls = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        messages.push({ role: "assistant", content: response.content });

        // Anything streamed on this turn was preamble before a tool call,
        // not the answer. Drop it rather than leaving "let me check…"
        // sitting above the real answer.
        yield { type: "reset" };
        yield { type: "tools", names: calls.map((call) => call.name) };

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

      // The text of this turn already streamed above.
      const hasText = response.content.some(
        (block) => block.type === "text" && block.text.trim() !== "",
      );
      if (!hasText) {
        yield { type: "error", reason: "no_text" };
        return;
      }
      yield { type: "done", toolsCalled };
      return;
    }

    // Out of passes. Saying so beats leaving a half-formed turn on screen
    // as though it were the answer.
    yield { type: "reset" };
    yield { type: "error", reason: "exhausted" };
  } catch (err) {
    // Whatever streamed so far is not an answer — clear it before saying
    // what went wrong, or the error reads as a footnote to a partial one.
    yield { type: "reset" };
    if (
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.APIError
    ) {
      // Deliberately not err.message — it can carry request details, and
      // the caller puts this on screen.
      yield { type: "error", reason: "api" };
      return;
    }
    throw err;
  }
}
