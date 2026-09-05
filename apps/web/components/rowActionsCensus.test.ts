/**
 * Nobody hand-rolls an armed delete any more.
 *
 * `rowActions.test.ts` proves the shared component BEHAVES correctly — it
 * renders it and clicks it. This file answers the other half of issue #152,
 * which is not "is the guard right" but "did somebody write a twenty-first
 * copy of it". Between them: behaviour is tested once, in the one place
 * behaviour now lives, and this makes sure that stays the only place.
 *
 * It is a source scan, and CLAUDE.md is right that a source scan cannot see
 * an inverted guard. It does not need to. The thing it looks for is the
 * MECHANISM of the bug, not the guard: a component that remembers, in its
 * own `useState`, whether a delete is armed. Every one of the twenty
 * instances had one, and none of them could have had the bug without one.
 *
 * What it cannot see, stated plainly so nobody trusts it further than it
 * goes: an arming state under a name with no "confirm" or "armed" in it, and
 * anything about the layout of a row that does use RowActions correctly.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Files allowed to keep their own arming state, each with the reason.
 * Adding a line here is a deliberate act, which is the point — the twenty
 * instances got in because nothing ever made anybody stop and write one.
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {
  "components/RowActions.tsx":
    "the shared component itself — this is where the arming state is supposed to live",
  "components/SalesActivityRow.tsx":
    "STILL BROKEN: 'Edit' stays live beside the armed 'Confirm delete'. Sales CRM is the other lane, so issue #152 says report it rather than edit it. Delete this line when that lane fixes it.",
  "components/SalesLeadRow.tsx":
    "Sales CRM, the other lane. Converted on this branch and then reverted before the PR: the working agreement says post and wait before touching the other person's files, and that message had not been answered. The RowActions conversion is ready and is one `git checkout` away. Delete this line when that lane takes it.",
  "components/SalesOpportunityRow.tsx":
    "Sales CRM, the other lane. Same as SalesLeadRow above — converted, then reverted unshipped rather than cross a lane boundary unanswered.",
};

function tsxFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** `const [isConfirmingDelete, setIsConfirmingDelete] = useState(...)` and friends. */
const ARMING_STATE = /const\s*\[\s*([A-Za-z0-9_]*(?:onfirm|rmed)[A-Za-z0-9_]*)\s*,[^\]]*\]\s*=\s*useState/g;

describe("the armed-delete census", () => {
  const files = tsxFiles(appDir).map((full) => ({
    path: relative(appDir, full),
    source: readFileSync(full, "utf8"),
  }));

  it("finds the app, so an empty sweep cannot pass by accident", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.path)).toContain("components/RowActions.tsx");
  });

  it("leaves the arming state to RowActions and nowhere else", () => {
    const offenders = files
      .filter((f) => !(f.path in KNOWN_EXCEPTIONS))
      .map((f) => ({ path: f.path, hits: [...f.source.matchAll(ARMING_STATE)].map((m) => m[1]) }))
      .filter((f) => f.hits.length > 0)
      .map((f) => `${f.path} (${f.hits.join(", ")})`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A component is remembering for itself whether a delete is armed.",
            "That is how issue #152 happened twenty times: the ordinary actions",
            "beside the armed confirm stay live, because the guard is something",
            "somebody has to remember to write and the next merge fills the gap",
            "the guard just emptied.",
            "",
            "Use <RowActions destructive={<ConfirmDelete .../>}> instead. Ordinary",
            "actions go in its children and are not rendered at all while armed,",
            "so there is no sibling position left to get wrong.",
            "",
            "If this really is an exception, add it to KNOWN_EXCEPTIONS in this",
            "file with the reason.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("never uses ConfirmDelete without the RowActions that hides the rest of the row", () => {
    const offenders = files
      .filter((f) => f.path !== "components/RowActions.tsx")
      .filter((f) => /\bConfirmDelete\b/.test(f.source) && !/\bRowActions\b/.test(f.source))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it("still has no window.confirm anywhere — this app deletes in two inline steps", () => {
    // Only real calls. Several files carry a comment saying explicitly that
    // they use a two-step button "rather than window.confirm()", and a naive
    // regex reads those as violations of the rule they are stating.
    const offenders = files
      .filter((f) =>
        f.source
          .split("\n")
          .map((line) => line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, ""))
          .some((line) => /window\.confirm\s*\(/.test(line)),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
