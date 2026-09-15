/**
 * Every control that destroys a record or moves money says what it does.
 *
 * WHY A CENSUS AND NOT A REVIEW. "Backcharge", "Release retainage",
 * "Close out", "Log a bid invitation" are trade-literate labels whose
 * SOFTWARE consequence is invisible: a fifteen-person office cannot tell
 * from the button whether "Send to QuickBooks" writes a row here or puts a
 * document in front of Intuit, and a contractor who is unsure does not
 * click. Describing the dangerous half of the app once is easy; keeping it
 * described through the next forty merges is what this file is for. The
 * armed-delete census next door exists for the same reason and its history
 * is the argument: twenty hand-rolled guards got in because nothing ever
 * made anybody stop.
 *
 * WHAT IT CHECKS
 *
 *   1. Every `<ConfirmDelete>` and `<ConfirmDeleteButton>` in the app
 *      carries a `describe` prop. That is the whole destructive surface —
 *      the two-step delete is the only way this app deletes anything (see
 *      `rowActionsCensus.test.ts`, which holds that line), so the set is
 *      derivable rather than curated.
 *   2. Every money control in MONEY_CONTROLS below is wrapped in a
 *      `<Hint>`. That set IS curated, because "money" is not a shape a
 *      scanner can see — so each entry is also required to still EXIST,
 *      which is what stops a rename from silently emptying the list.
 *   3. Every nav group heading has a description. The rail is six icons at
 *      64px and "Paper trail" is not self-explanatory at any width.
 *   4. Every figure in the metric bar has one. Four company-wide numbers
 *      sit under every page and nothing anywhere says what they count.
 *   5. `Hint.tsx` uses theme tokens and no raw palette classes, so the
 *      next re-skin is one file (see tailwind.config.ts).
 *
 * WHAT IT CANNOT SEE. It is a source scan. It cannot tell a good
 * description from "Click to delete this item", it cannot see a control
 * that is neither a ConfirmDelete nor in the money list, and it cannot see
 * position or contrast. Two specific holes worth naming rather than
 * discovering: a one-click destructive `<SubmitButton>` that never went
 * through `ConfirmDelete` at all is invisible to check 1 (twelve of those
 * exist — see HAND_ROLLED_DESTRUCTIVE below, which names the two this branch
 * covers and counts the ten it does not), and a money control added under a
 * label not in MONEY_CONTROLS is invisible to check 2.
 *
 * AND THE REASON EVERY PARSER HERE IS ITSELF TESTED. This repo shipped a
 * guard that passed thirteen assertions while parsing 180 of 181 foreign
 * keys, because a pattern that matches nothing is never missing anything.
 * Three of the checks below derive their set by scanning JSX, so each
 * scanner has a fixture test above it, and each derived set is counted
 * against a literal that cannot drift with the scanner.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { navGroupsFor } from "@/components/navItems";

const appDir = fileURLToPath(new URL("..", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist"]);

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/** #185: a comment quoting the pattern it explains disarmed one of these
 *  once, so comments never count anywhere in this file. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The text of the JSX opening tag that starts at `at`, or null if it never
 * closes.
 *
 * A regex cannot do this. `<ConfirmDelete hint={<span>…</span>} />` has
 * three `>` characters before the one that ends the tag, so the scan tracks
 * brace depth and steps over quoted strings; only a `>` at depth zero ends
 * it.
 */
function openingTag(source: string, at: number): string | null {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const close = source.indexOf(ch, i + 1);
      if (close === -1) return null;
      i = close;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return source.slice(at, i + 1);
  }
  return null;
}

/** Every index where `tag` opens an element — `<Hint` but not `<HintRow`. */
function elementStarts(source: string, tag: string): number[] {
  const found: number[] = [];
  for (let i = source.indexOf(`<${tag}`); i !== -1; i = source.indexOf(`<${tag}`, i + 1)) {
    const next = source[i + tag.length + 1] ?? "";
    if (!/[A-Za-z0-9_]/.test(next)) found.push(i);
  }
  return found;
}

/** `<Hint …>` … `</Hint>` spans. Hint never nests inside itself. */
function hintRegions(source: string): [number, number][] {
  return elementStarts(source, "Hint").map((open) => {
    const close = source.indexOf("</Hint>", open);
    return [open, close === -1 ? source.length : close] as [number, number];
  });
}

function insideAHint(regions: [number, number][], index: number): boolean {
  return regions.some(([open, close]) => index > open && index < close);
}

const CONTROL_TAGS = new Set(["button", "SubmitButton"]);

/** The element whose opening tag most recently opened before `index`. */
function enclosingTag(source: string, index: number): string | null {
  const open = source.lastIndexOf("<", index);
  if (open === -1) return null;
  return /^<\s*([A-Za-z][A-Za-z0-9_.]*)/.exec(source.slice(open, index))?.[1] ?? null;
}

/** Indexes where `label` is the text of a button rather than a heading or a
 *  sentence of prose. `<h2>Log a backcharge</h2>` is not a control. */
function controlLabelAt(source: string, label: string): number[] {
  const found: number[] = [];
  for (let i = source.indexOf(label); i !== -1; i = source.indexOf(label, i + 1)) {
    const tag = enclosingTag(source, i);
    if (tag && CONTROL_TAGS.has(tag)) found.push(i);
  }
  return found;
}

/**
 * Money controls, by their exact label.
 *
 * Curated, and it has to be: there is no textual shape that says "this
 * button moves money". The cost of curation is a list that can go stale, so
 * every entry below is ALSO asserted to still exist as a button somewhere in
 * the app — rename one and this file goes red naming it, rather than quietly
 * checking nothing.
 *
 * NOT IN THIS LIST, and it is the biggest gap in this file: creating an
 * invoice and recording a retainage release both live only in
 * `app/(app)/jobs/[id]/page.tsx`, which is the other lane's file by name in
 * CLAUDE.md. They are money controls and they are undescribed.
 */
const MONEY_CONTROLS = [
  "Submit pay application",
  "Log a backcharge",
  "Save backcharge",
  "Log payment",
  "Send to QuickBooks",
  "Re-send to QuickBooks",
  "Send payment to QuickBooks",
  "Re-send payment",
];

/**
 * Destructive controls that never went through `ConfirmDelete` at all.
 *
 * Twelve `>Remove<`/`>Delete<`/`>Disconnect<` button labels in this app sat in
 * a `button`/`SubmitButton` that acted on ONE click, and check 1 cannot see
 * any of them — they never went near `ConfirmDelete`, so neither this census
 * nor `rowActionsCensus.test.ts` had anything to hold onto. Eleven of the
 * twelve deleted a record, which is a defect in its own right (the list-page
 * convention in CLAUDE.md says two-step, never one). The twelfth is
 * `TakeoffForm`'s, which drops an UNSAVED opening out of a form before
 * anything is written, and is correctly one click.
 *
 * **EMPTY as of 2026-09-14, and the emptiness is the point of the entry.**
 * The two that used to be listed here — `team/page.tsx`'s "Remove" and
 * `settings/page.tsx`'s "Disconnect", the scariest pair in the set, one
 * removing a person's access and one cutting the QuickBooks connection —
 * were each described by a `<Hint>` on the one-click button, and then ARMED:
 * they are `<ConfirmDelete>`s now (`TeamMemberActions.tsx` and the
 * QuickBooks `RowActions` cluster respectively), which puts them inside
 * check 1, where `describe` is enforced rather than listed. Describing a
 * one-click delete was the stopgap; two-stepping it is the fix.
 *
 * The loop below is left standing rather than deleted, because this list
 * REFUSES a stale entry: a label that moves makes it fail by name, which is
 * how these two were caught rather than silently un-checked. An empty list
 * checks nothing and claims nothing, which is the honest state — every
 * remaining one-click delete is in `app/(app)/jobs/[id]/page.tsx`, the other
 * lane's file by CLAUDE.md, and one of them deletes a retainage release.
 * NINE of them, counted 2026-09-13 by the same rule this file uses: a
 * delete-word label whose enclosing tag is `button` or `SubmitButton`.
 */
const HAND_ROLLED_DESTRUCTIVE: { label: string; file: string }[] = [];

/**
 * Files allowed to name `<ConfirmDelete` without passing `describe`.
 *
 * One entry, and it is the file that DEFINES the component: the literal
 * appears there inside its own thrown error message, which is live code and
 * survives comment-stripping. The test below proves that is what this file
 * is rather than taking the exception on trust.
 */
const DEFINES_THE_COMPONENT = "components/RowActions.tsx";

const files = tsxFiles(appDir).map((full) => ({
  path: relative(appDir, full),
  source: readFileSync(full, "utf8"),
  code: stripComments(readFileSync(full, "utf8")),
}));

describe("the control-hint census", () => {
  it("finds the app, so an empty sweep cannot pass by accident", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.path)).toContain("components/Hint.tsx");
    expect(files.map((f) => f.path)).toContain(DEFINES_THE_COMPONENT);
  });

  /* CHECKS ON THE CHECKERS. Three of the assertions below are only as good
     as these four functions, and a scanner that returns nothing looks
     exactly like a clean app. */
  describe("its own scanners", () => {
    it("reads an opening tag past a `>` inside a prop", () => {
      const source = '<ConfirmDelete hint={<span className="x">gone</span>} describe="why" />\n<p>';
      expect(openingTag(source, 0)).toBe(
        '<ConfirmDelete hint={<span className="x">gone</span>} describe="why" />',
      );
      expect(openingTag('<Metric label="a" />', 0)).toBe('<Metric label="a" />');
      expect(openingTag("<Metric label=", 0)).toBeNull();
    });

    it("does not mistake a longer name for the tag it wants", () => {
      expect(elementStarts("<Hint text />", "Hint")).toEqual([0]);
      expect(elementStarts("<HintRow text />", "Hint")).toEqual([]);
      expect(elementStarts("<Metric /><MetricBar />", "Metric")).toEqual([0]);
    });

    it("knows what is inside a Hint and what is beside one", () => {
      const source = '<Hint text="a"><button>Yes</button></Hint><button>No</button>';
      const regions = hintRegions(source);
      expect(regions).toHaveLength(1);
      expect(insideAHint(regions, source.indexOf("Yes"))).toBe(true);
      expect(insideAHint(regions, source.indexOf("No"))).toBe(false);
    });

    it("counts a button's label and not a heading's", () => {
      const source = '<h2 className="t">Log a backcharge</h2><button type="button">Log a backcharge</button>';
      expect(controlLabelAt(source, "Log a backcharge")).toEqual([
        source.lastIndexOf("Log a backcharge"),
      ]);
      expect(controlLabelAt("<SubmitButton>Log payment</SubmitButton>", "Log payment")).toHaveLength(1);
      expect(controlLabelAt("<p>Log payment</p>", "Log payment")).toEqual([]);
    });
  });

  /* ---------- 1. every destructive control ---------- */

  const destructive = files
    .filter((f) => f.path !== DEFINES_THE_COMPONENT)
    .flatMap((f) =>
      [...elementStarts(f.code, "ConfirmDelete"), ...elementStarts(f.code, "ConfirmDeleteButton")].map(
        (at) => ({ path: f.path, tag: openingTag(f.code, at) }),
      ),
    );

  it("parses every two-step delete the app contains — an empty question passes everything below", () => {
    // The literal count is taken WITHOUT the scanner that produced
    // `destructive`, for the reason scratch-cleanup-order.test.ts now does
    // the same: a pattern matching 44 of 45 sites is not missing anything.
    const literal = files
      .filter((f) => f.path !== DEFINES_THE_COMPONENT)
      .reduce((n, f) => n + (f.code.match(/<ConfirmDelete(Button)?(?![A-Za-z0-9_])/g) ?? []).length, 0);
    expect(destructive.length).toBe(literal);
    expect(destructive.length).toBeGreaterThanOrEqual(40);
    expect(destructive.every((d) => d.tag !== null)).toBe(true);
  });

  it("earns its one exception: RowActions.tsx is where ConfirmDelete is defined", () => {
    const definition = files.find((f) => f.path === DEFINES_THE_COMPONENT)!;
    expect(definition.code).toContain("export function ConfirmDelete(");
  });

  it("describes every two-step delete", () => {
    const silent = destructive
      .filter((d) => !/\bdescribe=/.test(d.tag ?? ""))
      .map((d) => d.path);

    expect(
      silent,
      silent.length === 0
        ? ""
        : [
            "",
            "A delete button says what it removes and nothing about what that",
            "costs. The office staff this is sold to are tradespeople, not",
            "software users: 'Remove' on a compliance document could mean",
            "'off this list' or 'the GC stops seeing it', and somebody who is",
            "unsure does not click.",
            "",
            'Pass describe="…" to the <ConfirmDelete>. Say what leaves, from',
            "where, and whether anything leaves the building — 'Records the",
            "release. Does not notify the GC.' Not 'Click to delete this item.'",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("describes the one-click deletes that ConfirmDelete never saw", () => {
    const problems: string[] = [];
    for (const { label, file } of HAND_ROLLED_DESTRUCTIVE) {
      const source = files.find((f) => f.path === file);
      if (!source) {
        problems.push(`${file} is gone — update HAND_ROLLED_DESTRUCTIVE`);
        continue;
      }
      const sites = controlLabelAt(source.code, label);
      // The stale guard, same as the money list: a renamed button must fail
      // loudly rather than turn this into a check over an empty set.
      if (sites.length === 0) {
        problems.push(`${file} no longer has a "${label}" button — update HAND_ROLLED_DESTRUCTIVE`);
        continue;
      }
      const regions = hintRegions(source.code);
      for (const at of sites) {
        if (!insideAHint(regions, at)) problems.push(`${file} ("${label}")`);
      }
    }
    expect(problems).toEqual([]);
  });

  /* ---------- 2. money actions ---------- */

  const moneySites = MONEY_CONTROLS.map((label) => ({
    label,
    sites: files.flatMap((f) =>
      controlLabelAt(f.code, label).map((at) => ({
        path: f.path,
        hinted: insideAHint(hintRegions(f.code), at),
      })),
    ),
  }));

  it("still finds every money control it names — a renamed button empties this check", () => {
    const missing = moneySites.filter((m) => m.sites.length === 0).map((m) => m.label);
    expect(
      missing,
      missing.length === 0
        ? ""
        : [
            "",
            "MONEY_CONTROLS names a button that no longer exists under that",
            "label. This is not a formality: the list is curated, so a rename",
            "turns its entry into a check that passes by matching nothing.",
            "",
            "Rename the entry to the new label, or delete it and say in the PR",
            "that the control is gone.",
            "",
          ].join("\n"),
    ).toEqual([]);
    expect(moneySites.reduce((n, m) => n + m.sites.length, 0)).toBeGreaterThanOrEqual(
      MONEY_CONTROLS.length,
    );
  });

  it("balances every <Hint> it finds, so an unterminated one is not a silent region", () => {
    for (const f of files) {
      const opens = elementStarts(f.code, "Hint").length;
      const closes = (f.code.match(/<\/Hint>/g) ?? []).length;
      expect(closes, `${f.path} opens ${opens} <Hint> and closes ${closes}`).toBe(opens);
    }
  });

  it("describes every money control", () => {
    const silent = moneySites.flatMap((m) =>
      m.sites.filter((s) => !s.hinted).map((s) => `${s.path} (${m.label})`),
    );

    expect(
      silent,
      silent.length === 0
        ? ""
        : [
            "",
            "A money button with no description is the most expensive kind of",
            "unclicked feature. Nothing on the screen says whether 'Send to",
            "QuickBooks' writes a row here or puts a document in front of",
            "Intuit, or whether a pay application reaches the GC by itself.",
            "",
            "Wrap the control in <Hint text=\"…\">, and say whether anything",
            "leaves the building.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  /* ---------- 3. the nav rail's group headings ---------- */

  const groups = navGroupsFor({ role: "OWNER", jobFunction: null }, { showsInternal: true });

  it("describes every nav group, including the one appended separately", () => {
    expect(groups.length).toBeGreaterThanOrEqual(6);
    const silent = groups
      .filter((g) => !g.description || g.description.trim().length < 12)
      .map((g) => g.heading);
    expect(
      silent,
      silent.length === 0
        ? ""
        : [
            "",
            "A nav group is six pixels of icon at 64px and two words expanded.",
            "'Paper trail' and 'Pre-construction' are not self-explanatory at",
            "either width.",
            "",
            "Give the group a `description` in navItems.tsx.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  /* ---------- 4. the metric bar ---------- */

  const metricBar = files.find((f) => f.path === "components/MetricBar.tsx")!;
  const metrics = elementStarts(metricBar.code, "Metric").map((at) => openingTag(metricBar.code, at));

  it("parses every figure in the metric bar", () => {
    const literal = (metricBar.code.match(/<Metric(?![A-Za-z0-9_])/g) ?? []).length;
    expect(metrics.length).toBe(literal);
    expect(metrics.length).toBeGreaterThanOrEqual(4);
  });

  it("describes every figure in the metric bar", () => {
    const silent = metrics.filter((tag) => !/\bdescribe=/.test(tag ?? ""));
    expect(
      silent.length,
      "A company-wide figure sits under every page in this app with nothing anywhere saying what it counts. Pass describe=\"…\" to the <Metric>.",
    ).toBe(0);
  });

  /* ---------- 5. the component itself stays on the tokens ---------- */

  it("builds the tooltip from theme tokens, not raw palette classes", () => {
    const hint = files.find((f) => f.path === "components/Hint.tsx")!;
    const raw = [...hint.code.matchAll(/\b(?:bg|text|border)-(slate|gray|zinc|neutral|stone)-\d{2,3}\b/g)].map(
      (m) => m[0],
    );
    expect(
      raw,
      "Re-skinning this app is already a codebase-wide edit because of classes like these. A new component does not add to the pile — use the tokens in tailwind.config.ts.",
    ).toEqual([]);
  });
});
