import { describe, expect, it, vi } from "vitest";
import { agentPass } from "@prova/integrations";

/** The one SDK call the agents make, with a fake client — no live model. */

function fake(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { create, client: { messages: { create } } as unknown as Parameters<typeof agentPass>[0]["client"] };
}

describe("agentPass", () => {
  it("sends one request with the web tool, and returns text, usage and only searched URLs as citations", async () => {
    const { create, client } = fake({
      content: [
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [{ type: "web_search_result", url: "https://news.example.com/riverside", title: "Riverside clinic breaks ground" }],
        },
        { type: "text", text: "The clinic is a 3-storey medical office. " },
        { type: "text", text: "See https://made-up.example.com." },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
        server_tool_use: { web_search_requests: 2 },
      },
    });
    const out = await agentPass({ client, system: "sys", prompt: "Project: Riverside", webSearch: true, model: "claude-opus-5" });

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("claude-opus-5");
    expect(request.messages).toEqual([{ role: "user", content: "Project: Riverside" }]);
    expect(request.tools).toEqual([expect.objectContaining({ type: "web_search_20250305" })]);
    expect(out.text).toBe("The clinic is a 3-storey medical office. See https://made-up.example.com.");
    // The URL the model wrote in prose is NOT a citation; only the searched page is.
    expect(out.citations).toEqual([{ url: "https://news.example.com/riverside", title: "Riverside clinic breaks ground" }]);
    expect(out.usage).toEqual({ passes: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0, webSearches: 2 });
  });

  it("offers no tool without webSearch, and survives a response with no usage", async () => {
    const { create, client } = fake({ content: [{ type: "text", text: "ok" }] });
    const out = await agentPass({ client, system: "s", prompt: "p" });
    expect(create.mock.calls[0][0].tools).toBeUndefined();
    expect(create.mock.calls[0][0].model).toBe("claude-opus-5");
    expect(out.citations).toEqual([]);
    expect(out.usage.passes).toBe(1);
    expect(out.usage.webSearches).toBe(0);
  });
});
