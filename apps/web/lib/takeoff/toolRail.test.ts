import { describe, expect, it } from "vitest";
import { RAIL_TOOLS, TOOL_ICONS, TOOL_KEYS, TOOLS } from "@/lib/takeoff-plan-view";

describe("the workspace's tool rail", () => {
  it("drops no tool: each one is on the rail or behind its menu, and each has an icon", () => {
    const ids = TOOLS.map((tool) => tool.id);
    for (const id of RAIL_TOOLS) expect(ids).toContain(id);
    for (const id of ids) expect(TOOL_ICONS[id], `${id} has no icon`).toBeTruthy();
    expect(ids.filter((id) => !RAIL_TOOLS.includes(id)).length + RAIL_TOOLS.length).toBe(ids.length);
  });

  it("gives every rail tool its own key, and no two the same", () => {
    const keys = RAIL_TOOLS.map((id) => TOOL_KEYS[id]);
    expect(keys.every((key) => typeof key === "string" && key.length === 1)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // The workspace already owns these; a tool key on one would never arrive.
    for (const taken of ["f", "j", "k", "b", "g", "[", "]", "\\", "?"]) expect(keys).not.toContain(taken);
  });
});
