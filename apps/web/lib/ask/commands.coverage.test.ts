import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS, EXCLUSIONS } from "./commands";

/**
 * Every exported Server Action is either a command or excluded with a
 * reason. Both directions, like handlers.test.ts pins TOOLS against
 * HANDLERS: a registration must name a real action, an exclusion must name
 * a real action or a real module, and no action may sit in neither list.
 *
 * "Written, documented, and never called" is a recurring shape in this
 * repo. Its opposite — reachable from a prompt without anybody deciding —
 * would be worse, and this is the file that makes adding an action a
 * decision. A whole module may be excluded with one wildcard and one
 * reason, so a new action in the other lane is never blocked on a file it
 * does not own; the wildcard is replaced per action when that lane
 * registers its first command from the module.
 */
const actionsDir = fileURLToPath(new URL("../actions/", import.meta.url));

function exportedActions(): { moduleName: string; name: string }[] {
  const found: { moduleName: string; name: string }[] = [];
  for (const file of readdirSync(actionsDir)) {
    if (!file.endsWith(".ts")) continue;
    if (file === "index.ts" || file === "shared.ts") continue;
    if (file.endsWith(".test.ts") || file.endsWith(".dbtest.ts")) continue;
    const moduleName = file.replace(/\.ts$/, "");
    const source = readFileSync(join(actionsDir, file), "utf8");
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      found.push({ moduleName, name: match[1] });
    }
  }
  return found;
}

const actions = exportedActions();
const actionNames = new Set(actions.map((a) => a.name));
const modules = new Set(actions.map((a) => a.moduleName));

const exact = new Set(EXCLUSIONS.filter((e) => !e.action.endsWith(".*")).map((e) => e.action));
const wildcards = new Set(EXCLUSIONS.filter((e) => e.action.endsWith(".*")).map((e) => e.action.slice(0, -2)));
const registered = new Set(COMMANDS.map((c) => c.action));

describe("command coverage of lib/actions", () => {
  it("finds the actions at all", () => {
    expect(actions.length).toBeGreaterThan(150);
  });

  it("registers or excludes every exported action", () => {
    const undecided = actions
      .filter((a) => !registered.has(a.name) && !exact.has(a.name) && !wildcards.has(a.moduleName))
      .map((a) => `${a.moduleName}.${a.name}`);
    // Named in the failure rather than counted, so whoever added the
    // action can act on it without re-deriving the set.
    expect(undecided, `undecided actions: ${undecided.join(", ")}`).toEqual([]);
  });

  it("registers only actions that exist", () => {
    for (const command of COMMANDS) {
      expect(actionNames.has(command.action), `${command.name} → ${command.action}`).toBe(true);
    }
  });

  it("excludes only actions and modules that exist", () => {
    for (const name of exact) {
      expect(actionNames.has(name), `exclusion ${name}`).toBe(true);
    }
    for (const moduleName of wildcards) {
      expect(modules.has(moduleName), `exclusion ${moduleName}.*`).toBe(true);
      expect(existsSync(join(actionsDir, `${moduleName}.ts`))).toBe(true);
    }
  });

  it("does not wildcard a module that also has a registered command", () => {
    // A module with a command has been read; its other actions get their
    // own reasons, not a blanket.
    const registeredModules = new Set(
      actions.filter((a) => registered.has(a.name)).map((a) => a.moduleName),
    );
    for (const moduleName of registeredModules) {
      expect(wildcards.has(moduleName), `${moduleName}.* hides decisions`).toBe(false);
    }
  });

  it("names every DIRECT command's core in lib/estimating or a sibling lib", () => {
    const libDir = fileURLToPath(new URL("../", import.meta.url));
    for (const command of COMMANDS) {
      if (command.mode !== "DIRECT" || !command.core) continue;
      const hits = readdirSync(join(libDir, "estimating")).some((file) =>
        readFileSync(join(libDir, "estimating", file), "utf8").includes(`export async function ${command.core}`),
      );
      expect(hits, `${command.name} names core ${command.core}, which no lib/estimating file exports`).toBe(true);
    }
  });
});
