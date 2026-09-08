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

/**
 * THE SCAN READS CODE, NOT PROSE — and it did not, until a mutation said so.
 *
 * Every row in this app explains its own `pinned` choice in a comment above
 * the cluster, and those comments contain the literal `pinned="end"`. So the
 * pinned check below was passing on the strength of the PARAGRAPH SAYING WHY
 * THE PROP IS THERE. Verified rather than suspected (#184): delete
 * `pinned="end"` from SafetyIncidentRow.tsx and the un-stripped version stays
 * green — a source scan answering about its own documentation.
 *
 * Same shape as everything else in this file's history: a check that cannot
 * fail reads exactly like a check that passes.
 */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

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
  const files = tsxFiles(appDir).map((full) => {
    const source = readFileSync(full, "utf8");
    return { path: relative(appDir, full), source, code: withoutComments(source) };
  });

  it("finds the app, so an empty sweep cannot pass by accident", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.path)).toContain("components/RowActions.tsx");
  });

  it("leaves the arming state to RowActions and nowhere else", () => {
    const offenders = files
      .filter((f) => !(f.path in KNOWN_EXCEPTIONS))
      .map((f) => ({ path: f.path, hits: [...f.code.matchAll(ARMING_STATE)].map((m) => m[1]) }))
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
      .filter((f) => /\bConfirmDelete\b/.test(f.code) && !/\bRowActions\b/.test(f.code))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  /**
   * Rule 2, at the only layer anything in this repo can catch it.
   *
   * A `<RowActions>` whose own className says `shrink-0` is a cluster that
   * hangs off the right of its row, and in a right-pinned cluster the LAST
   * control is the one that keeps its position — so Cancel has to be last,
   * which is `pinned="end"`. Measured in real Chromium at 1100px: the default
   * order overlapped the vacated Delete box by 100% of its area, `pinned="end"`
   * by 0%.
   *
   * This is a source scan and it is coarse: it asks whether a FILE with a
   * shrink-0 cluster mentions `pinned="end"` anywhere, not whether the right
   * ConfirmDelete got it. A file with two clusters can satisfy it with one.
   * It cannot see a right-pinned cluster whose pinning lives in a parent
   * component, and it cannot see position at all — no test in this repo can,
   * because a DOM-only environment does no layout. It exists because the
   * alternative at this layer is nothing.
   *
   * WHY THIS MAP IS EMPTY NOW, WHICH IS THE POINT OF #184.
   *
   * It used to hold three rows, and every entry said the same thing in
   * different words: the row is `flex flex-col … sm:flex-row`, so below 640px
   * the cluster is not right-pinned at all but a full-width left-aligned
   * strip, and no value of `pinned` is right at both widths. #89 created that
   * shape; #176's `pinned` could not reach it. Whichever value you picked, one
   * width was wrong — SafetyIncidentRow measured 100%/75% at 1100/375 as the
   * default and 0%/86% as `end`.
   *
   * #184 fixed the phone in the shared component instead: below `sm` the armed
   * pair is its own full-width column with CANCEL ON TOP, so the confirm is a
   * whole button-height away from the vacated box at every stacked width and
   * `pinned` only has to be right about the DESKTOP. That is a question with
   * one answer per cluster, so the exceptions dissolved rather than being
   * argued away. Re-measured in real Chromium against the merged classes —
   * confirm overlap as a share of the area of the box the delete vacated:
   *
   *                        main (1100/639/375)   this (1100/639/375)
   *   EquipmentRow              0% / 86% / 86%      0% / 0% / 0%
   *   FieldReportEntry          0% / 86% / 86%      0% / 0% / 0%
   *   PunchListRow              0% / 86% / 86%      0% / 0% / 0%
   *   DailyFieldReports         0% / 79% / 79%      0% / 0% / 0%
   *   SafetyIncidentRow       100% / 75% / 75%      0% / 0% / 0%   (flipped to end)
   *   RfiRow                   20% /  0% /  0%     20% / 0% / 0%
   *   ToolboxTalkRow          100% /  0% /  0%      0% / 0% / 0%   (flipped to end)
   *   RuleSetRow              100% / 72% / 72%      0% / 0% / 0%   (flipped to end)
   *
   * Cancel covers 100% of the vacated box on all eight below 640px, with 12px
   * of clear air under it before the confirm starts. RfiRow's 20% at 1100px is
   * pre-existing and structural, not a regression here: in a right-pinned
   * cluster the confirm clears the vacated box only when Cancel plus the gap
   * (70 + 12 = 82px) is at least as wide as the delete button, and "Delete
   * draft" is 103px. Any row whose delete label is longer than about "Remove"
   * carries the same residue on the desktop, and the column removes it below
   * `sm` but cannot at 1100.
   *
   * The map stays, empty, because the next stacked row is not the thing that
   * would need an entry — a row whose cluster's pinning lives in a PARENT
   * component still might. An entry has to carry measured numbers at both
   * widths, from a real browser. It is not a place to put a row you have not
   * measured.
   */
  const PINNED_EXCEPTIONS: Record<string, string> = {};

  it("passes pinned=\"end\" wherever the action cluster is right-pinned", () => {
    const offenders = files
      .filter((f) => !(f.path in PINNED_EXCEPTIONS))
      .filter((f) => /<RowActions[\s\S]{0,400}?shrink-0/.test(f.code))
      .filter((f) => !/pinned=["']end["']/.test(f.code))
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
