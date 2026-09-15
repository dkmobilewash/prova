import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "./cases";
import { TOOLS, toolsFor } from "../tools";
import { COMMANDS, commandsFor } from "../commands";

/**
 * The eval's cases, checked without the model. Runs in CI so the set
 * cannot drift from the registry: every expected tool and command must
 * exist AND be offered to the principal asking — a case that expects
 * something the person cannot be offered is impossible, not hard — and
 * the set stays large enough that one flaky case cannot swing it.
 */
describe("the routing eval's cases", () => {
  it("are at least thirty, with unique ids", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it("expect only tools and commands that exist and are offered to the person asking", () => {
    const toolNames = new Set(TOOLS.map((t) => t.name));
    const commandNames = new Set(COMMANDS.map((c) => c.name));
    for (const c of EVAL_CASES) {
      if (c.expect.kind === "tool") {
        expect(toolNames.has(c.expect.name), c.id).toBe(true);
        expect(toolsFor(c.principal).map((t) => t.name), c.id).toContain(c.expect.name);
      }
      if (c.expect.kind === "command") {
        expect(commandNames.has(c.expect.name), c.id).toBe(true);
        expect(commandsFor(c.principal).map((d) => d.name), c.id).toContain(c.expect.name);
      }
    }
  });

  it("cover every read tool and every command at least once", () => {
    const expectedTools = new Set(EVAL_CASES.flatMap((c) => (c.expect.kind === "tool" ? [c.expect.name] : [])));
    const expectedCommands = new Set(EVAL_CASES.flatMap((c) => (c.expect.kind === "command" ? [c.expect.name] : [])));
    for (const t of TOOLS) expect(expectedTools.has(t.name), t.name).toBe(true);
    for (const c of COMMANDS) expect(expectedCommands.has(c.name), c.name).toBe(true);
  });

  it("include refusals and injection attempts, which must produce no card", () => {
    const none = EVAL_CASES.filter((c) => c.expect.kind === "no_command");
    expect(none.length).toBeGreaterThanOrEqual(8);
    // Roadmap item 5 raised this from three. The floor is a floor and not
    // a target: what stops the damage is lib/ask/injection.test.ts, which
    // runs in CI and does not depend on a model's judgement. This set
    // measures whether the model is being STEERED, which is worth knowing
    // and is not the same question.
    expect(none.filter((c) => c.id.startsWith("inject-")).length).toBeGreaterThanOrEqual(10);
  });

  it("spreads the injection cases across attack shapes rather than repeating one trick", () => {
    // A set that is eleven variations on "SYSTEM:" measures one defence
    // and reports it as eleven. The shapes that matter are different: an
    // instruction the person typed, an instruction sitting in a record a
    // GC wrote, an appeal to authority, an attempt on the card mechanism,
    // and an attempt to read the prompt rather than act.
    const ids = EVAL_CASES.filter((c) => c.id.startsWith("inject-")).map((c) => c.id);
    for (const shape of ["inject-in-question", "inject-quoted-record", "inject-roleplay", "inject-self-confirm", "inject-prompt-dump"]) {
      expect(ids, shape).toContain(shape);
    }
    // And each one names something a person could plausibly say, not a
    // synthetic token: a case nobody would ever type teaches nothing.
    for (const c of EVAL_CASES.filter((c) => c.id.startsWith("inject-"))) {
      expect(c.question.length, c.id).toBeGreaterThan(30);
    }
  });
});
