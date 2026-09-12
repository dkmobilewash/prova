import { describe, expect, it, vi } from "vitest";
import { streamToolConversation } from "@prova/integrations";

/**
 * The one change to the provider loop, pinned: when a tool answers with a
 * halt, the generator yields `reset` then `halt` and ENDS. No tool_result
 * is pushed, no second model call is made, no `done` is sent. Push a
 * result by mistake and the model gets another pass in which to re-propose
 * — the risk the design named, and the reason this test exists.
 *
 * The SDK is not mocked by module path — it is not resolvable from this
 * package — so a fake client is handed in through the option that exists
 * for exactly this.
 */

/** A stream that emits no text and finishes with the given message. */
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

const toolUse = (id: string, name: string, input: unknown) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});

const endTurn = { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] };

async function drain(events: AsyncIterable<unknown>) {
  for await (const event of events) void event;
}

describe("a halting tool", () => {
  it("ends the conversation after reset and halt, with no second pass and no done", async () => {
    const { stream, client } = fakeClient(toolUse("tu_1", "create_estimate_job", { jobName: "X" }), endTurn);
    const execute = vi.fn<(name: string, input: unknown, meta: unknown) => Promise<{ content: string; halt: { proposalId: string } }>>(
      async () => ({ content: "card shown", halt: { proposalId: "p1" } }),
    );

    const events: string[] = [];
    let halt: unknown = null;
    for await (const event of streamToolConversation<{ proposalId: string }>({
      system: "s",
      question: "create X",
      tools: [],
      execute,
      client,
    })) {
      events.push(event.type);
      if (event.type === "halt") halt = event.halt;
    }

    // `usage` sits between the reset and the halt: the passes that ran
    // were billed, and the caller records them before the card is shown.
    expect(events).toEqual(["reset", "tools", "reset", "usage", "halt"]);
    expect(halt).toEqual({ proposalId: "p1" });
    // The second canned turn was never requested.
    expect(stream).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("create_estimate_job", { jobName: "X" }, {
      toolUseId: "tu_1",
      toolUseIdsInContext: [],
    });
  });

  it("keeps running when no tool halts, and tells the executor what was in context", async () => {
    const { stream, client } = fakeClient(
      toolUse("tu_1", "receivables", {}),
      toolUse("tu_2", "open_rfis", {}),
      endTurn,
    );
    const execute = vi.fn<(name: string, input: unknown, meta: unknown) => Promise<{ content: string }>>(async () => ({ content: "{}" }));

    const events: string[] = [];
    for await (const event of streamToolConversation({ system: "s", question: "q", tools: [], execute, client })) {
      events.push(event.type);
    }

    expect(events.at(-1)).toBe("done");
    expect(events.at(-2)).toBe("usage");
    expect(stream).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[1][2]).toEqual({ toolUseId: "tu_2", toolUseIdsInContext: ["tu_1"] });
  });

  it("sends the per-person context as a second, uncached system block", async () => {
    const { stream, client } = fakeClient(endTurn);
    await drain(
      streamToolConversation({
        system: "cached",
        context: "ACCESS. withheld: billing",
        question: "q",
        tools: [],
        execute: async () => ({ content: "" }),
        client,
      }),
    );
    const request = stream.mock.calls[0][0] as { system: { text: string; cache_control?: unknown }[] };
    expect(request.system).toHaveLength(2);
    expect(request.system[0]).toMatchObject({ text: "cached", cache_control: { type: "ephemeral" } });
    expect(request.system[1]).toEqual({ type: "text", text: "ACCESS. withheld: billing" });
  });

  it("sends no second block when there is nothing withheld", async () => {
    const { stream, client } = fakeClient(endTurn);
    await drain(streamToolConversation({ system: "cached", question: "q", tools: [], execute: async () => ({ content: "" }), client }));
    expect((stream.mock.calls[0][0] as { system: unknown[] }).system).toHaveLength(1);
  });
});


describe("what a question cost", () => {
  const withUsage = (final: Record<string, unknown>, usage: Record<string, number>) => ({ ...final, usage });

  it("sums every pass's reported usage and reports it once, before done", async () => {
    const { client } = fakeClient(
      withUsage(toolUse("tu_1", "receivables", {}), { input_tokens: 5000, output_tokens: 40, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }),
      withUsage(endTurn, { input_tokens: 5200, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }),
    );
    const events: { type: string; usage?: unknown }[] = [];
    for await (const event of streamToolConversation({ system: "s", question: "q", tools: [], execute: async () => ({ content: "{}" }), client })) {
      events.push(event as { type: string; usage?: unknown });
    }
    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].usage).toEqual({ passes: 2, inputTokens: 10200, outputTokens: 340, cacheReadTokens: 8000, cacheWriteTokens: 0 });
    expect(events.map((e) => e.type).slice(-2)).toEqual(["usage", "done"]);
  });

  it("reports the passes that completed even when the answer never came", async () => {
    // A fake whose second turn has no text at all: the loop's no_text
    // error, with the usage of both passes reported before it.
    const { client } = fakeClient(
      withUsage(toolUse("tu_1", "receivables", {}), { input_tokens: 100, output_tokens: 10 }),
      withUsage({ stop_reason: "end_turn", content: [] }, { input_tokens: 120, output_tokens: 0 }),
    );
    const events: { type: string; usage?: unknown }[] = [];
    for await (const event of streamToolConversation({ system: "s", question: "q", tools: [], execute: async () => ({ content: "{}" }), client })) {
      events.push(event as { type: string; usage?: unknown });
    }
    expect(events.map((e) => e.type).slice(-2)).toEqual(["usage", "error"]);
    expect(events.find((e) => e.type === "usage")?.usage).toMatchObject({ passes: 2, inputTokens: 220, outputTokens: 10 });
  });
});
