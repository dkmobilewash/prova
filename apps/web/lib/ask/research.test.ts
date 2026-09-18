import { describe, expect, it, vi } from "vitest";
import {
  researchProject,
  searchedUrls,
  verifiedSuggestions,
  RESEARCH_FIELDS,
} from "@prova/integrations";

/**
 * The web half of "start a bid", without the web.
 *
 * Two promises are pinned here, and both are properties of code rather
 * than of the model: (1) only the project name and the location leave for
 * the search — nothing else is IN the request to leak; (2) no fact survives
 * without a source that actually came back from the search in that same
 * call. The model is a fake client throughout; the live behaviour is the
 * eval's job.
 */

const searchResult = (...pages: { url: string; title: string }[]) => ({
  type: "web_search_tool_result",
  tool_use_id: "srv_1",
  content: pages.map((page) => ({ type: "web_search_result", encrypted_content: "x", page_age: null, ...page })),
});

const record = (facts: unknown[]) => ({ type: "tool_use", id: "tu_r", name: "record_project_facts", input: { facts } });

function fakeClient(...responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { create, client: { messages: { create } } as unknown as Parameters<typeof researchProject>[0]["client"] };
}

const CLINIC = "https://www.portland.gov/sellwood-clinic";
const PLANROOM = "https://plans.example.com/sellwood";

describe("verifiedSuggestions", () => {
  const seen = searchedUrls([searchResult({ url: CLINIC, title: "Sellwood Clinic" }, { url: PLANROOM, title: "Plan room" })]);

  it("keeps a fact whose source the search actually returned", () => {
    const kept = verifiedSuggestions({ facts: [{ field: "owner", value: "City of Portland", sourceUrls: [`${CLINIC}/`] }] }, seen);
    expect(kept).toEqual([
      { field: "owner", value: "City of Portland", sources: [{ url: CLINIC, title: "Sellwood Clinic" }] },
    ]);
  });

  it("drops a fact whose only source the search never returned — an invented citation is no citation", () => {
    const kept = verifiedSuggestions(
      { facts: [{ field: "architect", value: "Made-Up Architects", sourceUrls: ["https://not-searched.example.com/page"] }] },
      seen,
    );
    expect(kept).toEqual([]);
  });

  it("drops a fact with no source at all, an unknown field, a blank value and a second copy of a field", () => {
    const kept = verifiedSuggestions(
      {
        facts: [
          { field: "owner", value: "City of Portland", sourceUrls: [] },
          { field: "budget", value: "$4M", sourceUrls: [CLINIC] },
          { field: "size", value: "   ", sourceUrls: [CLINIC] },
          { field: "size", value: "12,000 sf", sourceUrls: [CLINIC] },
          { field: "size", value: "99,000 sf", sourceUrls: [CLINIC] },
        ],
      },
      seen,
    );
    expect(kept.map((fact) => [fact.field, fact.value])).toEqual([["size", "12,000 sf"]]);
  });

  it("keeps a plan-room link only when the link itself was a search result", () => {
    const kept = verifiedSuggestions(
      {
        facts: [
          { field: "planRoom", value: "https://elsewhere.example.com/bids", sourceUrls: [CLINIC] },
        ],
      },
      seen,
    );
    expect(kept).toEqual([]);
    const real = verifiedSuggestions({ facts: [{ field: "planRoom", value: PLANROOM, sourceUrls: [PLANROOM] }] }, seen);
    expect(real).toHaveLength(1);
  });

  it("cuts a long value at a word with an ellipsis, never mid-word", () => {
    const long = `${"renovation of the west side ".repeat(20)}plus mechanical`;
    const [fact] = verifiedSuggestions({ facts: [{ field: "projectScope", value: long, sourceUrls: [CLINIC] }] }, seen);
    expect(fact.value.length).toBeLessThanOrEqual(300);
    expect(fact.value.endsWith("…")).toBe(true);
    expect(fact.value).toMatch(/(renovation|of|the|west|side)…$/);
  });

  it("refuses a javascript: or data: 'source' even if the model claims it", () => {
    const tricky = searchedUrls([searchResult({ url: "javascript:alert(1)", title: "x" })]);
    expect(tricky.size).toBe(0);
  });
});

describe("researchProject", () => {
  it("sends only the project name and the location, with a capped web search", async () => {
    const { create, client } = fakeClient({
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 2 } },
      content: [
        searchResult({ url: CLINIC, title: "Sellwood Clinic" }),
        record([{ field: "owner", value: "City of Portland", sourceUrls: [CLINIC] }]),
      ],
    });
    const result = await researchProject({ projectName: "Sellwood Clinic", location: "Portland, OR", client });

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    // The whole user content of the request, verbatim: nothing else rides along.
    expect(request.messages).toEqual([{ role: "user", content: "Project: Sellwood Clinic\nLocation: Portland, OR" }]);
    const search = request.tools.find((tool: { name: string }) => tool.name === "web_search");
    expect(search).toMatchObject({ type: "web_search_20250305", max_uses: 3 });
    expect(result).toMatchObject({ ok: true, searches: 2 });
    if (result.ok) expect(result.suggestions.map((s) => s.field)).toEqual(["owner"]);
  });

  it("never lets a caller raise the search cap past five", async () => {
    const { create, client } = fakeClient({ stop_reason: "tool_use", content: [record([])] });
    await researchProject({ projectName: "X", location: "Y", maxSearches: 50, client });
    const search = create.mock.calls[0][0].tools.find((tool: { name: string }) => tool.name === "web_search");
    expect(search.max_uses).toBe(5);
  });

  it("does not call the API at all without a location", async () => {
    const { create, client } = fakeClient();
    const result = await researchProject({ projectName: "Sellwood Clinic", location: "  ", client });
    expect(create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("reports unavailable when the API refuses the tool (an org without web search)", async () => {
    // Shaped like the SDK's BadRequestError; the SDK itself is not
    // resolvable from this package (see halt.test.ts).
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("web search not enabled"), { status: 400 }));
    const result = await researchProject({
      projectName: "Sellwood Clinic",
      location: "Portland, OR",
      client: { messages: { create } } as never,
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("reports an ordinary API failure as api, not as unavailable", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 }));
    const result = await researchProject({ projectName: "S", location: "P", client: { messages: { create } } as never });
    expect(result).toMatchObject({ ok: false, reason: "api" });
  });

  it("reports unavailable when the search tool itself errored and returned nothing", async () => {
    const { client } = fakeClient({
      stop_reason: "tool_use",
      content: [
        { type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
        record([]),
      ],
    });
    const result = await researchProject({ projectName: "Sellwood Clinic", location: "Portland, OR", client });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("continues a paused turn and then reads the record", async () => {
    const { create, client } = fakeClient(
      { stop_reason: "pause_turn", content: [searchResult({ url: CLINIC, title: "Sellwood Clinic" })] },
      { stop_reason: "tool_use", content: [record([{ field: "size", value: "12,000 sf", sourceUrls: [CLINIC] }])] },
    );
    const result = await researchProject({ projectName: "Sellwood Clinic", location: "Portland, OR", client });
    expect(create).toHaveBeenCalledTimes(2);
    // A source seen in the FIRST turn still backs a fact recorded in the second.
    expect(result.ok && result.suggestions.map((s) => s.value)).toEqual(["12,000 sf"]);
  });

  it("knows exactly the seven fields it can suggest", () => {
    expect(RESEARCH_FIELDS).toHaveLength(7);
  });
});
