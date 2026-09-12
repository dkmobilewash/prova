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
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
};

/** What a tool run gives back to the model. `isError` marks a failed
 * lookup, which the model is told about rather than left to infer from
 * silence.
 *
 * `halt` is the other way a tool can answer: not a result for the model
 * but something for the PERSON. The conversation ends the moment one
 * appears — no tool_result is pushed, no further pass runs — and the halt
 * is yielded to the caller as its own event. That is what lets a command
 * propose a write and hand the decision to a human without the model ever
 * being in a position to "confirm" it itself. `H` is whatever the app
 * carries; this package does not know its shape, the same way it does not
 * know a tenant. */
export type AskToolOutcome<H = never> = { content: string; isError?: boolean; halt?: H };

export type AskFailureReason = "refusal" | "no_text" | "exhausted" | "api";

/** What one question cost, summed over every model pass it took. Read
 * off `response.usage` after each pass; nothing here is estimated. */
export type AskUsageTotals = {
  /** Model calls: one for a plain answer, one per tool round plus one for
   * the answer otherwise. A pass that threw is not counted. */
  passes: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** What the caller can render while the answer is being built.
 *
 * A multi-tool question takes 8-11 seconds against a real database, and a
 * static "Reading your records…" for that long reads as a hang. These say
 * what is actually happening.
 */
export type AskEvent<H = never> =
  /** A round of tool calls has started. `names` is what is being read. */
  | { type: "tools"; names: string[] }
  /** A tool answered the PERSON rather than the model. Terminal: nothing
   * follows it, and no `done` is sent — the answer is whatever the caller
   * renders from `halt`. */
  | { type: "halt"; halt: H }
  /** Discard any text shown so far: it was preamble before a tool call,
   * not the answer. Without this a "let me check…" line would sit above
   * the real answer forever. */
  | { type: "reset" }
  /** Tool results are in; what streams from here is the answer, not
   * preamble. Lets the caller stop styling streamed text as provisional. */
  | { type: "answering" }
  | { type: "text"; delta: string }
  /** Sent ONCE, immediately before the terminal event (`halt`, `done` or
   * `error`), with the tokens every pass of this question cost. The
   * caller records it; nothing about it reaches the screen. Emitted before
   * an error too, since the passes that ran were billed regardless. */
  | { type: "usage"; usage: AskUsageTotals }
  | { type: "done"; toolsCalled: string[] }
  | { type: "error"; reason: AskFailureReason };

/** What the executor is told about the call it is running, beyond the
 * input. `toolUseIdsInContext` lists every earlier tool_use whose result
 * the model was reading when it made this call — recorded so a proposal
 * that came from text inside a tool result can be traced to the row that
 * carried it. */
export type AskToolCallMeta = { toolUseId: string; toolUseIdsInContext: string[] };

export type AskConversationOptions<H = never> = {
  system: string;
  /** A second system block appended AFTER the cached one, for text that
   * varies per person (what their access withholds, for instance). Sits
   * outside the cache breakpoint so it does not invalidate the prefix. */
  context?: string;
  question: string;
  tools: AskToolDefinition[];
  /** Runs one tool. Supplied by the caller already bound to a company. */
  execute: (name: string, input: unknown, meta: AskToolCallMeta) => Promise<AskToolOutcome<H>>;
  /** API calls, not tool calls: a turn asking for four tools at once costs
   * one. Guards against a confused loop, not against breadth. */
  maxPasses?: number;
  model?: string;
  /** A stand-in for the SDK client. Tests pass one; production never does.
   * Exists because this package's SDK is not resolvable from the app's
   * test runner, so it cannot be mocked from there by module path. */
  client?: Pick<Anthropic, "messages">;
};

/** Exported so the app can record which model proposed a write. */
export const ASK_DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MODEL = ASK_DEFAULT_MODEL;
const DEFAULT_MAX_PASSES = 6;

export function anthropicIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export type AnthropicConnection =
  | { ok: true; model: string }
  /** `type` is the API's own error type ("authentication_error",
   * "not_found_error"…), "not_configured" when there is no key at all, or
   * "connection_error" when the request never got an HTTP answer. */
  | { ok: false; status: number | null; type: string | null };

/**
 * Does the key on this server work, and can its organization use the
 * model the box runs on? Asks the Models endpoint for that one model: a
 * request that validates both without a token billed. The screen half of
 * the log line in the catch below — an owner can press a button instead of
 * asking somebody to read runtime logs.
 */
export async function checkAnthropicConnection(
  model: string = DEFAULT_MODEL,
  client?: Pick<Anthropic, "models">,
): Promise<AnthropicConnection> {
  if (!anthropicIsConfigured()) return { ok: false, status: null, type: "not_configured" };
  const api = client ?? new Anthropic();
  try {
    const info = await api.models.retrieve(model);
    return { ok: true, model: info.id };
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, status: null, type: "connection_error" };
    if (err instanceof Anthropic.APIError) return { ok: false, status: err.status ?? null, type: apiErrorType(err) };
    throw err;
  }
}

/** Adds one pass's reported usage to the running total. Every field is
 * read defensively: a fake client in a test answers without `usage`. */
function tally(total: AskUsageTotals, usage: Partial<Anthropic.Usage> | undefined): void {
  total.passes += 1;
  total.inputTokens += usage?.input_tokens ?? 0;
  total.outputTokens += usage?.output_tokens ?? 0;
  total.cacheReadTokens += usage?.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += usage?.cache_creation_input_tokens ?? 0;
}

/** The `type` inside the API's error body ("authentication_error",
 * "not_found_error", "overloaded_error"...), which is the field that says
 * what to fix. Read defensively: the SDK types `error` as unknown. */
function apiErrorType(err: { error?: unknown }): string | null {
  const body = err.error as { error?: { type?: unknown } } | undefined;
  const type = body?.error?.type;
  return typeof type === "string" ? type : null;
}

export async function* streamToolConversation<H = never>(
  options: AskConversationOptions<H>,
): AsyncGenerator<AskEvent<H>> {
  const client = options.client ?? new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: options.question },
  ];
  const toolsCalled: string[] = [];
  // Every tool_use whose result has been pushed into `messages` so far —
  // what the model can see when it makes its next call.
  const toolUseIdsInContext: string[] = [];
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  const usage: AskUsageTotals = { passes: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  // A breakpoint on the first system block covers everything before it in
  // the prefix, which is the tool list. The optional second block varies
  // per person and sits after the breakpoint, so it costs nothing cached.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: options.system, cache_control: { type: "ephemeral" } },
  ];
  if (options.context) system.push({ type: "text", text: options.context });

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
        system,
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
      tally(usage, response.usage);

      // A safety decline arrives as a 200 with no useful content. Reported
      // as itself rather than rendered as a blank answer.
      if (response.stop_reason === "refusal") {
        yield { type: "usage", usage };
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
              const outcome = await options.execute(call.name, call.input ?? {}, {
                toolUseId: call.id,
                toolUseIdsInContext: [...toolUseIdsInContext],
              });
              return { call, outcome };
            } catch {
              // One failing tool must not lose the whole answer.
              const outcome: AskToolOutcome<H> = {
                content: `The ${call.name} lookup failed. Do not guess at what it would have said.`,
                isError: true,
              };
              return { call, outcome };
            }
          }),
        );

        // A halt ends the conversation HERE — before any result is pushed,
        // so the model never sees a tool_result it could act on, and never
        // gets another pass in which to re-propose or to narrate something
        // as done that a person has not yet confirmed. The reads that ran
        // in the same batch are simply discarded; the person has a card to
        // answer and can ask again. When two halts land in one batch the
        // first wins — the executor is expected to have refused the second
        // already, and one card per question is the rule either way.
        const halted = outcomes.find((entry) => entry.outcome.halt !== undefined);
        if (halted) {
          yield { type: "reset" };
          yield { type: "usage", usage };
          yield { type: "halt", halt: halted.outcome.halt as H };
          return;
        }

        // Every result goes back in ONE user message. Splitting them across
        // messages teaches the model to stop asking for tools in parallel.
        toolUseIdsInContext.push(...calls.map((call) => call.id));
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
        yield { type: "usage", usage };
        yield { type: "error", reason: "no_text" };
        return;
      }
      yield { type: "usage", usage };
      yield { type: "done", toolsCalled };
      return;
    }

    // Out of passes. Saying so beats leaving a half-formed turn on screen
    // as though it were the answer.
    yield { type: "reset" };
    yield { type: "usage", usage };
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
      // The person sees one sentence; the server log carries the reason.
      // Before this line existed, a preview whose key was rejected and a
      // preview whose org lacked the model produced the same screen and
      // the same (empty) log, and the difference took a person an hour to
      // guess. Status, the API's own error type, the request id and the
      // model are enough to tell those apart; the key and the prompt are
      // never here.
      console.error("[ask] Anthropic API call failed", {
        status: err.status,
        type: apiErrorType(err),
        requestId: err.requestID ?? null,
        model: options.model ?? DEFAULT_MODEL,
      });
      // Deliberately not err.message on screen — it can carry request
      // details, and the caller puts this in front of the person.
      // The passes that completed were billed; say so before the error.
      yield { type: "usage", usage };
      yield { type: "error", reason: "api" };
      return;
    }
    throw err;
  }
}
