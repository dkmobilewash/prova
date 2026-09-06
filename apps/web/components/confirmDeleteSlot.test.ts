/**
 * A `<ConfirmDelete>` must sit in `<RowActions destructive={…}>`, never in
 * its children.
 *
 * This is not a style rule, it is the difference between a working two-step
 * delete and a row that empties itself. `RowActions` renders
 * `{armed ? null : children}` — so a `ConfirmDelete` written as a CHILD
 * unmounts itself the instant it arms: the confirm pair never renders, the
 * component's own `fired` state goes with it, and the row shows nothing at
 * all where its actions were. Clicking "Remove" appears to do nothing.
 *
 * It was written that way on this branch's own TimeEntryRow, on certified
 * payroll hours, and typecheck, lint and the whole unit suite were green:
 * `destructive` is optional and `children` accepts any node, so the wrong
 * placement is a perfectly well-typed program.
 *
 * Neither existing check on `cyrus/armed-delete-isolates-row` sees it
 * either. `rowActionsCensus.test.ts` asks whether a file uses
 * `ConfirmDelete` WITHOUT `RowActions` — this file uses both.
 * `rowActions.test.ts` renders the shared component correctly and proves
 * the component is right, which it is; the defect is at the call site.
 *
 * So this is a source scan, and it is honest about being one: it finds
 * every `<ConfirmDelete` and asks whether that exact offset falls inside
 * the braces of a `destructive={…}` attribute, matched by counting braces
 * rather than by a regex that cannot. What it cannot see is a
 * `destructive={renderDelete()}` indirection — nothing in this app does
 * that, and if something starts to, this test says so loudly rather than
 * passing quietly.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/** The component's own definition, where `<ConfirmDelete>` appears in prose
 *  and in the error message it throws rather than as a call site. */
const DEFINITION = "components/RowActions.tsx";

function tsxFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * The [start, end) character spans covered by every `destructive={…}`
 * attribute in `source`, found by matching braces from the opening one.
 *
 * Brace counting, not a regex: the value is virtually always
 * `destructive={cond ? <ConfirmDelete … /> : undefined}`, which contains
 * nested braces of its own inside JSX expressions, and a non-greedy `}`
 * stops at the first of them — one character into the thing it is supposed
 * to be measuring.
 */
function destructiveSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  // The lookbehind is load-bearing. Without it `xdestructive={` matches,
  // and a typo'd or renamed prop reads as a correctly-slotted one — found
  // by mutating this very file and watching the test stay green.
  const opener = /(?<![A-Za-z0-9_$])destructive=\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push([open, i]);
          break;
        }
      }
    }
  }
  return spans;
}

describe("every ConfirmDelete is in the destructive slot", () => {
  const files = tsxFiles(appDir)
    .map((full) => ({ path: relative(appDir, full), source: readFileSync(full, "utf8") }))
    .filter((f) => f.path !== DEFINITION);

  it("finds the app and finds call sites, so an empty sweep cannot pass", () => {
    // Without this, deleting every row component would make the suite
    // greener rather than redder — the exact failure mode a census has.
    expect(files.length).toBeGreaterThan(50);
    const callSites = files.filter((f) => f.source.includes("<ConfirmDelete"));
    expect(callSites.length).toBeGreaterThan(0);
    expect(callSites.map((f) => f.path)).toContain("components/TimeEntryRow.tsx");
  });

  it("never renders one as a child of RowActions", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const spans = destructiveSpans(file.source);
      const tag = /<ConfirmDelete\b/g;
      let match: RegExpExecArray | null;
      while ((match = tag.exec(file.source)) !== null) {
        const at = match.index;
        if (spans.some(([start, end]) => at > start && at < end)) continue;
        const line = file.source.slice(0, at).split("\n").length;
        offenders.push(`${file.path}:${line}`);
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A <ConfirmDelete> is outside the `destructive` prop of its <RowActions>.",
            "",
            "RowActions renders `{armed ? null : children}`. A ConfirmDelete in the",
            "children therefore UNMOUNTS ITSELF the moment it arms: no confirm",
            "button ever renders, and the row goes blank where its actions were.",
            "Clicking the delete looks like it did nothing.",
            "",
            "Write it as <RowActions destructive={<ConfirmDelete … />}>ordinary",
            "actions</RowActions> instead.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });
});
