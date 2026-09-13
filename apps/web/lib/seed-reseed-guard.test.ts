import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Can the demo seed be run twice?
 *
 * It could not, and it failed in the worst order: run against a company
 * that already had demo data, it duplicated the equipment and THEN died on
 * the prevailing-wage exclusion constraint — those effective ranges are
 * computed relative to today, so a second run's range always overlaps the
 * first run's. Everything before the failure point committed, everything
 * after did not, and /equipment reading "16 items" afterwards read as an
 * app bug. Issue #180.
 *
 * Two fixes, both of which this file pins:
 *
 *   1. The seed REFUSES to run on a company that already has demo data,
 *      before it writes anything, with a message naming the --undo command
 *      to run instead. `--force` bypasses it on purpose; `--undo` never
 *      hits it.
 *   2. `prevailingWageRuleSet` rows are find-or-create on their natural
 *      key rather than blind creates, so the one constraint that cannot
 *      tolerate a re-run is never raced.
 *
 * Like seed-equipment-demo.test.ts next door, this reads the script as
 * text rather than importing it — the script loads .env and exits on a
 * host mismatch, so importing it would connect to a database or kill the
 * run. Every extraction is anchored and throws if its anchor is gone,
 * and every derived set is size-checked against a count taken
 * independently of the pattern that derived it: a parser whose regex
 * quietly stops matching must fail the run, not pass it with an empty
 * set (see the scratch-cleanup-order entry in CLAUDE.md).
 */

const seedPath = fileURLToPath(
  new URL("../../../packages/db/scripts/seed-demo.mjs", import.meta.url),
);
const source = readFileSync(seedPath, "utf8");

/** The guard's `const existing = { ... }` block. */
function guardBlock(): { text: string; start: number; end: number } {
  const start = source.indexOf("const existing = {");
  if (start === -1) throw new Error("seed-demo.mjs no longer has `const existing = {`");
  const end = source.indexOf("\n  };", start);
  if (end === -1) throw new Error("could not find the end of the `existing` literal");
  return { text: source.slice(start, end), start, end };
}

/** Every model the guard counts, in order. */
function guardModels(): string[] {
  return [...guardBlock().text.matchAll(/prisma\.(\w+)\.count\(/g)].map((m) => m[1]);
}

// The nine tagged families the seed leaves behind. A partial run or a
// partially failed --undo can leave any one of them without the others,
// which is why the guard counts each rather than one representative.
const EXPECTED_GUARD_MODELS = [
  "contact",
  "job",
  "vendor",
  "equipment",
  "prevailingWageRuleSet",
  "lineItemCatalogEntry",
  "vendorPriceQuote",
  "bidInvitation",
  "outboundMessage",
];

describe("the seed refuses to run twice", () => {
  it("counts exactly the expected tagged families — a regex matching nothing is red, not green", () => {
    // Exact set, pinned here rather than derived from the same file it
    // checks. If the guard shrinks, this fails; if the extraction breaks,
    // the parsed list is empty and this fails the same way.
    expect(guardModels()).toEqual(EXPECTED_GUARD_MODELS);
  });

  it("runs before the first write", () => {
    const firstCreate = source.search(/prisma\.\w+\.create\(/);
    expect(firstCreate).toBeGreaterThan(-1);
    expect(guardBlock().end).toBeLessThan(firstCreate);
  });

  it("is bypassed by --undo, which must always be allowed to clean up", () => {
    const undoReturn = source.indexOf("if (UNDO) return undo(company.id);");
    expect(undoReturn).toBeGreaterThan(-1);
    expect(undoReturn).toBeLessThan(guardBlock().start);
  });

  it("refuses with the exact --undo command, exits non-zero, and only --force gets past it", () => {
    const refusal = source.indexOf("if (found.length && !FORCE)");
    expect(refusal).toBeGreaterThan(guardBlock().end);
    const refusalBlock = source.slice(refusal, source.indexOf("process.exit(1);", refusal));
    // The message must hand the operator the way out, not just say no.
    expect(refusalBlock).toContain("node scripts/seed-demo.mjs --undo");
    expect(refusalBlock).toContain("Nothing has been written");
    expect(source).toContain('const FORCE = process.argv.includes("--force");');
  });

  it("covers every family the undo path scopes by tag", () => {
    // Independent derivation: the models undo() scopes with
    // `contains: MARK` are, by construction, the families a partial
    // removal can leave behind — so the guard must count all of them.
    // Size check first: every literal occurrence must be attributed to a
    // model, so a drifting pattern shrinks the count and fails here
    // instead of silently shrinking the set.
    const undoStart = source.indexOf("async function undo(companyId)");
    if (undoStart === -1) throw new Error("seed-demo.mjs no longer has undo()");
    const undoSource = source.slice(undoStart);
    const occurrences = undoSource.split("contains: MARK").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(9);

    const attributed: string[] = [];
    let cursor = 0;
    for (let i = 0; i < occurrences; i += 1) {
      const at = undoSource.indexOf("contains: MARK", cursor);
      cursor = at + 1;
      const before = undoSource.slice(0, at);
      const model = [...before.matchAll(/prisma\.(\w+)\./g)].at(-1)?.[1];
      if (!model) throw new Error(`could not attribute occurrence ${i + 1} to a model`);
      attributed.push(model);
    }
    expect(attributed).toHaveLength(occurrences);

    // A child scoped through its parent's tag belongs to the parent's
    // family — deleting the parent takes it along.
    const FAMILY: Record<string, string> = { outboundMessageEvent: "outboundMessage" };
    const families = new Set(attributed.map((m) => FAMILY[m] ?? m));
    for (const family of families) {
      expect(EXPECTED_GUARD_MODELS, `undo scopes ${family} by tag but the guard never counts it`).toContain(family);
    }
  });
});

describe("prevailing wage rule sets are find-or-create, never a blind create", () => {
  // The one constraint a re-run cannot survive: gist EXCLUDE on
  // (companyId, jurisdiction, tsrange). Prisma cannot upsert on it — an
  // exclusion constraint is not a unique key — so the natural-key lookup
  // is spelled out by hand and every rule set must go through it.
  const helperStart = source.indexOf("const ensureRuleSet = async (data) => {");

  it("has the helper, and it looks up the natural key before creating", () => {
    expect(helperStart).toBeGreaterThan(-1);
    const helper = source.slice(helperStart, source.indexOf("\n  };", helperStart));
    expect(helper).toContain("prisma.prevailingWageRuleSet.findFirst");
    expect(helper).toContain("companyId: data.companyId");
    expect(helper).toContain("jurisdiction: data.jurisdiction");
    expect(helper).toContain("name: data.name");
  });

  it("creates rule sets nowhere else", () => {
    // One create in the whole file, and it is the helper's. A second one
    // is the landmine coming back.
    const creates = source.split("prisma.prevailingWageRuleSet.create").length - 1;
    expect(creates).toBe(1);
    const helper = source.slice(helperStart, source.indexOf("\n  };", helperStart));
    expect(helper).toContain("prisma.prevailingWageRuleSet.create");
  });

  it("routes all three seeded rule sets through the helper", () => {
    const calls = source.split("await ensureRuleSet({").length - 1;
    expect(calls).toBe(3);
  });
});
