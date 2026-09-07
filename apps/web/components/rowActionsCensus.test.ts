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
  /* The three sales rows were asked to come OUT of this list when #183
     (38c7063) landed, on the grounds that it fixed them. Removing them was
     tried and the census went RED on all three: #183 fixed issue #152's RULE
     1 by wrapping the ordinary-action GROUP in `{!isConfirmingDelete && …}`,
     which is the right fix for that rule and does not touch the thing this
     file scans for. All three still hold their own `isConfirmingDelete`
     useState, so they are still hand-rolled and this guard still has a job to
     do on them. They come out when they become <RowActions>, not before. */
  "components/SalesActivityRow.tsx":
    "Sales CRM, the other lane. #183 fixed rule 1 here (the group is wrapped now, so 'Edit' no longer stays live beside the armed confirm) but the arming state is still its own useState. Delete this line when it becomes a <RowActions>.",
  "components/SalesLeadRow.tsx":
    "Sales CRM, the other lane. #183 found it needed no rule-1 fix — nothing was live beside its armed confirm — and left it hand-rolling its own arming state. Delete this line when it becomes a <RowActions>.",
  "components/SalesOpportunityRow.tsx":
    "Sales CRM, the other lane. Same as SalesActivityRow: #183 wrapped the group, the arming state is still its own. Delete this line when it becomes a <RowActions>.",
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

  /**
   * Rule 2, at the only layer anything in this repo can catch it.
   *
   * A `<RowActions>` whose own className says `shrink-0` is a cluster that
   * hangs off the right of its row, and in a right-pinned cluster the LAST
   * control is the one that keeps its position — so Cancel has to be last,
   * which is `pinned="end"`. Measured in real Chromium at 1100px and 375px:
   * the default order overlapped the vacated Delete box by 100% of its width,
   * `pinned="end"` by 0%.
   *
   * This is a source scan and it is coarse: it asks whether a FILE with a
   * shrink-0 cluster mentions `pinned="end"` anywhere, not whether the right
   * ConfirmDelete got it. A file with two clusters can satisfy it with one.
   * It cannot see a right-pinned cluster whose pinning lives in a parent
   * component, and it cannot see position at all — no test in this repo can,
   * because a DOM-only environment does no layout. It exists because the
   * alternative at this layer is nothing.
   *
   * WHAT MERGING #89 CHANGED, AND THE LIMIT IT EXPOSED IN THIS PROP.
   *
   * #89 made five of these rows `flex flex-col … sm:flex-row`, so below
   * 640px the cluster is no longer right-pinned at all: it is a full-width
   * left-aligned strip. All seven were re-measured in Chromium against the
   * MERGED classes at 1100px and 375px, and #176's `pinned` choices all
   * survived — `end` is still better than or equal to the default at BOTH
   * widths everywhere it is used. Nothing needed flipping.
   *
   * But the re-measure found something `pinned` cannot fix. RowActions HIDES
   * the ordinary actions while armed, so in a STACKED cluster the confirm
   * pair reflows to the cluster's left edge — and the Delete it replaced sat
   * to the RIGHT of an "Edit" that is now gone. At 375px on EquipmentRow the
   * vacated Delete box is x=104..181, and the armed pair starts at x=41
   * whichever order it is in: the confirm covers 75% of that box as
   * [Cancel][Confirm] and 85% as [Confirm][Cancel]. No value of this prop
   * puts a cancel on the delete's pixel, because at that width NOTHING is at
   * the delete's pixel any more.
   *
   * So on a phone, on any stacked row that has at least one ordinary action
   * — EquipmentRow, FieldReportEntry, PunchListRow, DailyFieldReports,
   * SafetyIncidentRow — a second tap still lands near the confirm. `end` is
   * kept on the four that have it because it makes the DESKTOP case exactly
   * safe (100% -> 0%) at a cost of 10 points on a mobile number that is bad
   * either way. Fixing the phone needs a layout change (reserving the hidden
   * actions' width, or right-aligning the armed pair when stacked), not a
   * different value of this prop. That is not in this merge.
   */
  const PINNED_EXCEPTIONS: Record<string, string> = {
    "components/SafetyIncidentRow.tsx":
      "cluster is shrink-0 but the ROW is `sm:flex-row`, so it is right-pinned only at >=640px. RE-MEASURED against #89's merged classes: default 100%/75% overlap at 1100/375, pinned=end 0%/85% (was 0%/91% before #89 changed the button padding and gap). Neither value is safe at 375 — see the note above on why `pinned` cannot reach the stacked case. Left at the default, as #176 left it; flipping it to `end` would make the desktop case safe and is a decision for Cyrus and Diego, not for a merge resolution.",
    "components/ToolboxTalkRow.tsx":
      "same `sm:flex-row` row, and with NO ordinary actions the two orders swap outright: default 100%/0% at 1100/375, pinned=end 0%/100%. RE-MEASURED after #89 and unchanged to the point. There is no value of this prop that is right at both widths, and because this cluster has no ordinary actions it is the one stacked row where the default IS safe at 375.",
    "components/RuleSetRow.tsx":
      "same `sm:flex-row` row as SafetyIncidentRow. Measured: default 100%/71%, pinned=end 0%/93%. NOT re-measured for the #89 merge: #89 did not touch this file, so its geometry and classes are unchanged.",
  };

  it("passes pinned=\"end\" wherever the action cluster is right-pinned", () => {
    const offenders = files
      .filter((f) => !(f.path in PINNED_EXCEPTIONS))
      .filter((f) => /<RowActions[\s\S]{0,400}?shrink-0/.test(f.source))
      .filter((f) => !/pinned=["']end["']/.test(f.source))
      .map((f) => f.path);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A right-pinned action cluster (shrink-0) is rendering its confirm",
            "in the position the Delete button just vacated. In a right-pinned",
            "cluster the LAST control keeps its place, so Cancel has to be last:",
            'pass pinned="end" to the <ConfirmDelete>.',
            "",
            "Measured in Chromium, not reasoned: 100% overlap with the default",
            "order, 0% with pinned=\"end\".",
            "",
            "If the row is genuinely not right-pinned — a responsive row that",
            "stacks on a phone, say — add it to PINNED_EXCEPTIONS with the",
            "numbers.",
            "",
          ].join("\n"),
    ).toEqual([]);
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
