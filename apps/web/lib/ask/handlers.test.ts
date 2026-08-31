import { describe, expect, it } from "vitest";
import { HANDLERS } from "./handlers";
import { TOOLS, type ToolName } from "./tools";

/** These do not touch the database. They assert the wiring between the
 * tools the model is offered and the code that answers them, which is
 * where this codebase's real bugs have lived — twice an action existed,
 * typechecked, and was reachable from nothing. */
describe("tool wiring", () => {
  it("gives every declared tool a handler", () => {
    for (const tool of TOOLS) {
      expect(HANDLERS[tool.name], `${tool.name} has no handler`).toBeTypeOf("function");
    }
  });

  it("declares every handler as a tool, so none is unreachable", () => {
    const declared = new Set<string>(TOOLS.map((tool) => tool.name));
    for (const name of Object.keys(HANDLERS)) {
      expect(declared.has(name), `${name} is implemented but offered to nobody`).toBe(true);
    }
  });

  it("has no duplicate tool names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("answers an unknown tool name with a refusal rather than throwing", async () => {
    const { runTool } = await import("./handlers");
    const result = await runTool("company-1", "not_a_tool" as ToolName, {});
    expect(result.unavailable).toContain("not_a_tool");
    expect(result.data).toBeNull();
  });
});
