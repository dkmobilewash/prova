import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server module must not import a plain VALUE out of a "use client" module.
 *
 * This is not a style rule. A non-component export from a client module does
 * not survive the RSC boundary: the server receives a client-reference proxy
 * in its place, so an array is not an array and `.find` is not a function.
 * It typechecks perfectly, because the types are real — only the runtime
 * value is replaced.
 *
 * It cost a production 500 on 2026-09-04. /sales/[id] imported
 * OPPORTUNITY_STAGE_OPTIONS from SalesOpportunityFields.tsx ("use client")
 * and called `.find` on it. Every lead with at least one opportunity threw
 * `TypeError: OPPORTUNITY_STAGE_OPTIONS.find is not a function`; leads with
 * none rendered fine, because the call sat inside opportunities.map() and
 * never executed. So the failure looked data-dependent and the page looked
 * healthy right up until somebody added a deal. Thirteen occurrences before
 * a browser tester traced it.
 *
 * COMPONENTS are exempt and are the whole point of the boundary: a server
 * component importing <SalesOpportunityForm /> is how this is meant to work.
 * They are recognised by PascalCase. Type-only imports are exempt too --
 * types are erased before any of this matters.
 */

const WEB_ROOT = path.resolve(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".turbo", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Matches "use client" as the first statement, past any leading comments. */
const USE_CLIENT = /^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(WEB_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

/** A component, by the only convention React gives us. */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name);
}

describe("the client/server boundary", () => {
  const files = walk(WEB_ROOT);
  const clientModules = new Set(
    files.filter((f) => USE_CLIENT.test(readFileSync(f, "utf8").slice(0, 400))),
  );

  it("finds both sides of the boundary, so the walk itself is not vacuous", () => {
    // Without this the whole suite passes when the walk is broken.
    expect(files.length).toBeGreaterThan(100);
    expect(clientModules.size).toBeGreaterThan(20);
    expect(clientModules.size).toBeLessThan(files.length);
  });

  it("no server module imports a non-component value from a 'use client' module", () => {
    const offences: string[] = [];

    for (const file of files) {
      if (clientModules.has(file)) continue; // client -> client is fine

      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(IMPORT)) {
        const [, typeOnly, names, spec] = match;
        if (typeOnly) continue;

        const target = resolveImport(spec, file);
        if (target === null || !clientModules.has(target)) continue;

        for (const raw of names.split(",")) {
          const trimmed = raw.trim();
          if (!trimmed || trimmed.startsWith("type ")) continue;
          const name = (trimmed.split(" as ").pop() ?? "").trim();
          if (!name || isComponentName(name)) continue;

          offences.push(
            `${path.relative(WEB_ROOT, file)} imports "${name}" from ${spec} ("use client") — ` +
              `across the RSC boundary that arrives as a client-reference proxy, not the value. ` +
              `Move it into a plain module and import it from both sides.`,
          );
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
