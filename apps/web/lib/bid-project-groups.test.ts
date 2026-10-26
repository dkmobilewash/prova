import { describe, expect, it } from "vitest";
import { groupBidsByProject } from "./bid-project-groups";

/** /bids under project headings: two or more GCs on the job make a group. */

const bid = (id: string, project: { id: string; n: number } | null) => ({
  id,
  bidProject: project ? { id: project.id, invitations: Array.from({ length: project.n }, (_, i) => ({ id: `${project.id}-${i}` })) } : null,
});

describe("groupBidsByProject", () => {
  it("a project with one invitation, and a bid with no project, stay single rows with no heading", () => {
    const groups = groupBidsByProject([bid("a", { id: "p1", n: 1 }), bid("b", null)]);
    expect(groups.map((g) => [g.key, g.project, g.items.map((i) => i.id)])).toEqual([
      ["a", null, ["a"]],
      ["b", null, ["b"]],
    ]);
  });

  it("two GCs on one project share a heading, kept in the order they came", () => {
    const groups = groupBidsByProject([bid("a", { id: "p1", n: 2 }), bid("b", null), bid("c", { id: "p1", n: 2 })]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([["a", "c"], ["b"]]);
    expect(groups[0].project?.id).toBe("p1");
    expect(groups[0].key).toBe("project:p1");
  });

  it("the group is decided by the PROJECT's invitations, so a filtered list still shows the heading", () => {
    // Only one of the project's three invitations survived a status filter.
    const groups = groupBidsByProject([bid("a", { id: "p1", n: 3 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].project).not.toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });

  it("drops and reorders nothing", () => {
    const input = [bid("1", { id: "p1", n: 2 }), bid("2", { id: "p2", n: 2 }), bid("3", { id: "p1", n: 2 }), bid("4", null), bid("5", { id: "p2", n: 2 })];
    const out = groupBidsByProject(input).flatMap((g) => g.items.map((i) => i.id));
    expect([...out].sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(groupBidsByProject([])).toEqual([]);
  });
});
