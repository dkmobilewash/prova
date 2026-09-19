import { describe, expect, it, vi } from "vitest";
import { ASK_WEB_SEARCH_MAX_USES, askWebSearchTool, streamToolConversation } from "@prova/integrations";

/**
 * The web search tool as `streamToolConversation` actually offers it, and
 * the spend ceiling around it. The SDK is not mocked by module path — see
 * halt.test.ts's own note — so a fake client is handed in through the
 * option that exists for exactly this.
 *
 * `askWebSearchTool` and the clamp inside it are tested directly too:
 * mutated by hand (dropping `Math.min` against `ASK_WEB_SEARCH_MAX_USES`)
 * this suite goes red on "clamps a caller asking for more than the
 * ceiling" — the guard this file exists to prove is not decorative.
 */

function fakeStream(final: unknown) {
  return {
    async *[Symbol.asyncIterator]() {},
    finalMessage: async () => final,
  };
}

function fakeClient(...finals: unknown[]) {
  const stream = vi.fn();
  for (const final of finals) stream.mockReturnValueOnce(fakeStream(final));
  return { stream, client: { messages: { stream } } as unknown as Parameters<typeof streamToolConversation>[0]["client"] };
}

const endTurn = { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] };

async function drain(events: AsyncIterable<unknown>) {
  const out: unknown[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("askWebSearchTool", () => {
  it("carries the same tool type research.ts already runs in production", () => {
    // Not a newer variant guessed at: this is the one the installed SDK's
    // types constrain both call sites to, and the two must agree or one of
    // them does not compile.
    expect(askWebSearchTool().type).toBe("web_search_20250305");
    expect(askWebSearchTool().name).toBe("web_search");
  });

  it("defaults to the ceiling", () => {
    expect(askWebSearchTool().max_uses).toBe(ASK_WEB_SEARCH_MAX_USES);
    expect(ASK_WEB_SEARCH_MAX_USES).toBe(3);
  });

  it("clamps a caller asking for more than the ceiling — a spend cap, not a suggestion", () => {
    expect(askWebSearchTool(10).max_uses).toBe(ASK_WEB_SEARCH_MAX_USES);
    expect(askWebSearchTool(999).max_uses).toBe(ASK_WEB_SEARCH_MAX_USES);
  });

  it("floors at one rather than at zero or below", () => {
    expect(askWebSearchTool(0).max_uses).toBe(1);
    expect(askWebSearchTool(-5).max_uses).toBe(1);
  });

  it("passes a caller's lower request through unclamped", () => {
    expect(askWebSearchTool(1).max_uses).toBe(1);
  });
});

describe("streamToolConversation's webSearch option", () => {
  it("appends the web tool AFTER the app's own tools, capped at the ceiling", async () => {
    const { stream, client } = fakeClient(endTurn);
    const appTools = [{ name: "receivables", description: "d", input_schema: { type: "object" as const, properties: {} } }];
    await drain(
      streamToolConversation({
        system: "s",
        question: "what OSHA form do we file?",
        tools: appTools,
        webSearch: true,
        execute: async () => ({ content: "" }),
        client,
      }),
    );
    const request = stream.mock.calls[0][0] as { tools: { name: string; type?: string; max_uses?: number }[] };
    expect(request.tools).toHaveLength(2);
    expect(request.tools[0]).toMatchObject({ name: "receivables" });
    expect(request.tools[1]).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: ASK_WEB_SEARCH_MAX_USES });
  });

  it("sends no web tool at all when webSearch is not set — every eval and test that does not opt in", async () => {
    const { stream, client } = fakeClient(endTurn);
    const appTools = [{ name: "receivables", description: "d", input_schema: { type: "object" as const, properties: {} } }];
    await drain(
      streamToolConversation({ system: "s", question: "q", tools: appTools, execute: async () => ({ content: "" }), client }),
    );
    const request = stream.mock.calls[0][0] as { tools: unknown[] };
    expect(request.tools).toEqual(appTools);
  });

  it("keeps the SAME tool set, byte for byte, across every pass of one question", async () => {
    // The cache-stability rule stated in ask.ts's own comment: the tool
    // list must be identical on every pass, or the cached prefix dies on
    // pass two. Two passes here — a tool_use round, then the answer — so
    // this is the case that would have caught a tool list rebuilt per pass.
    const toolUse = {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_1", name: "receivables", input: {} }],
    };
    const { stream, client } = fakeClient(toolUse, endTurn);
    const appTools = [{ name: "receivables", description: "d", input_schema: { type: "object" as const, properties: {} } }];
    await drain(
      streamToolConversation({
        system: "s",
        question: "q",
        tools: appTools,
        webSearch: true,
        execute: async () => ({ content: "{}" }),
        client,
      }),
    );
    expect(stream).toHaveBeenCalledTimes(2);
    const first = (stream.mock.calls[0][0] as { tools: unknown[] }).tools;
    const second = (stream.mock.calls[1][0] as { tools: unknown[] }).tools;
    expect(second).toEqual(first);
  });

  it("tallies a server-side search onto usage.webSearches, separate from tokens", async () => {
    const { client } = fakeClient({
      ...endTurn,
      usage: { input_tokens: 500, output_tokens: 80, server_tool_use: { web_search_requests: 2 } },
    });
    const events = await drain(
      streamToolConversation({ system: "s", question: "q", tools: [], webSearch: true, execute: async () => ({ content: "" }), client }),
    );
    const usage = events.find((e) => (e as { type: string }).type === "usage") as { usage: { webSearches?: number; inputTokens: number } };
    expect(usage.usage.webSearches).toBe(2);
    expect(usage.usage.inputTokens).toBe(500);
  });

  it("reports zero web searches, never undefined, when the tool was never offered", async () => {
    const { client } = fakeClient(endTurn);
    const events = await drain(
      streamToolConversation({ system: "s", question: "q", tools: [], execute: async () => ({ content: "" }), client }),
    );
    const usage = events.find((e) => (e as { type: string }).type === "usage") as { usage: { webSearches?: number } };
    expect(usage.usage.webSearches).toBe(0);
  });

  it("resends the assistant turn and continues on pause_turn, the documented move for a long server-tool turn", async () => {
    const paused = { stop_reason: "pause_turn", content: [{ type: "text", text: "still searching" }] };
    const { stream, client } = fakeClient(paused, endTurn);
    const events = await drain(
      streamToolConversation({ system: "s", question: "q", tools: [], webSearch: true, execute: async () => ({ content: "" }), client }),
    );
    expect(stream).toHaveBeenCalledTimes(2);
    // No `tools` event and no reset for a pause — it is not a client tool
    // round, so the loop must not tell the caller one started.
    expect(events.map((e) => (e as { type: string }).type)).not.toContain("tools");
    const secondMessages = (stream.mock.calls[1][0] as { messages: { role: string; content: unknown }[] }).messages;
    expect(secondMessages.at(-1)).toEqual({ role: "assistant", content: paused.content });
  });
});
