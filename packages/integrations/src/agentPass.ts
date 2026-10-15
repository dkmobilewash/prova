import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { askWebSearchTool, type AskUsageTotals } from "./ask";
import { searchedUrls } from "./research";

/**
 * ONE model pass for a background agent, and the only place an agent calls
 * the SDK.
 *
 * The agents are deterministic by default (lib/agents/*) and reach for a
 * model only where reading the public web is the point. So this is one
 * `messages.create`, no tool loop: the caller writes the prompt, which is
 * the privacy boundary — what it puts there is everything that leaves.
 *
 * CITATIONS ARE READ OFF THE RESPONSE, NOT ASKED FOR. A URL counts only if
 * it appeared in a `web_search_tool_result` block of this very call
 * (research.ts's `searchedUrls`, the same rule), so a link the model wrote
 * from memory is not a source. A caller that gets none back writes no
 * web finding — an uncited claim is a bug here, not a style choice.
 *
 * The caller has already passed `aiGate(…, "AI_AGENTS")` and the agent
 * spend cap (lib/agents/core.ts) and records the returned usage with
 * `recordAgentUsage`. Throws on an API error; `runAgent` turns that into a
 * FAILED run with a sentence.
 */
export type AgentPassResult = {
  text: string;
  usage: AskUsageTotals;
  citations: { url: string; title?: string }[];
};

export async function agentPass(opts: {
  client?: Pick<Anthropic, "messages">;
  model?: string;
  system: string;
  prompt: string;
  webSearch?: boolean;
  maxTokens?: number;
}): Promise<AgentPassResult> {
  const client = opts.client ?? new Anthropic(AI_CLIENT_OPTIONS);
  const response = await client.messages.create({
    model: opts.model ?? modelFor("AI_AGENTS").model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    ...(opts.webSearch ? { tools: [askWebSearchTool()] } : {}),
  });

  const u = response.usage as Partial<Anthropic.Usage> | undefined;
  const usage: AskUsageTotals = {
    passes: 1,
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    webSearches: u?.server_tool_use?.web_search_requests ?? 0,
  };
  const content = response.content ?? [];
  const text = content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const citations = [...searchedUrls(content).values()].map((s) => ({ url: s.url, title: s.title }));
  return { text, usage, citations };
}
