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
 *
 * AND FOR A YEAR IT COULD NOT SEE THE OPPOSITE OF THE BUG IT WAS BUILT FOR.
 * Every check above starts from something the page already has — an arming
 * state, a `ConfirmDelete`, a `shrink-0` cluster. A page with NO arming state
 * at all, deleting a row on one click from a bare `<form action={deleteX}>`,
 * matches none of those patterns and reads exactly like a page with nothing
 * wrong. `/team` was never scanned at all, because it does not mention
 * `ConfirmDelete` for this file to have an opinion about.
 *
 * Eleven such controls were found on 2026-09-12 (nine on `/jobs/[id]`, two on
 * `/team`) plus a twelfth, the QuickBooks disconnect on `/settings`, which the
 * new rule below found rather than a human. The destructive-form census at the
 * bottom of this file is that rule: it starts from the ACTIONS instead of from
 * the markup, so a control with no confirm is a positive finding rather than an
 * absence of evidence.
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
  /* The three sales rows (SalesActivityRow, SalesLeadRow,
     SalesOpportunityRow) sat here from #176 until they became <RowActions>.
     Removing them was tried once before that, when #183 landed, and the
     census went RED on all three: #183 fixed issue #152's rule 1 by wrapping
     the ordinary-action GROUP in a guard, which does not touch the thing
     this file scans for. The lesson stands — a row comes out of this list
     when its arming state moves into RowActions, not when its guard is
     right — and now there is no exception here but the component itself. */
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

/**
 * THE DESTRUCTIVE-FORM CENSUS: a delete that never asks.
 *
 * The census above answers "did somebody write a twenty-first copy of the
 * arming state". This one answers the question that had no check at all: "does
 * every control that destroys a row ask twice before it does". Those are not
 * the same question, and the difference is the whole reason eleven one-click
 * deletes survived on two pages the other rules had already swept —
 *
 *   <form action={deleteTimeEntry.bind(null, jobId, id)}>
 *     <SubmitButton type="submit">Remove</SubmitButton>
 *   </form>
 *
 * There is no arming state here to catch, no `ConfirmDelete` to check the
 * `pinned` of, and no `window.confirm` to ban. Nine of these sat on
 * `/jobs/[id]` and two on `/team`, one of them a RECEIVED PAYMENT and one the
 * line item whose Remove sits next to Save inside the same form.
 *
 * IT STARTS FROM THE ACTIONS, NOT FROM THE MARKUP, and that inversion is the
 * point. The set of things that can destroy a row is derivable — an exported
 * action whose body removes rows — and every place the JSX hands one of those
 * to a `action=` / `formAction=` attribute is a submit control that destroys
 * something. Each one must be the `action` prop of a `<ConfirmDelete>` (or of
 * `<ConfirmDeleteButton>`, which is one). Anything else is one click.
 *
 * DESTRUCTIVENESS IS READ FROM THE BODY, NEVER FROM THE NAME. A name-based
 * pattern would have missed `cancelInvite` — which deletes an Invite row and
 * begins with neither "delete" nor "remove" — and would go blind the day
 * somebody renames an action to `retireX`. The body either calls
 * `.delete(`/`.deleteMany(` or writes a soft-delete flag, or it does not.
 *
 * WHAT IT CANNOT SEE, said plainly, because this file's own history is a
 * queue of checks that were green about a question nobody asked:
 *
 *   - a CLIENT component calling a destructive action from `onClick` or
 *     `onSubmit` rather than through a form action. That shape exists in this
 *     app today (`ChangeOrders.tsx`: remove-a-proposal and discard-a-draft),
 *     and it is deliberately out of this rule's reach rather than
 *     silently missed: including it would need an exception list of six
 *     actions whose bodies delete something incidentally (`restoreAlert`,
 *     `sendOutboundEmail`, the two QuickBooks pushes…), and an exception list
 *     that long is how a rule gets repealed one reasonable case at a time.
 *     Those two are a reported gap, not a covered one;
 *   - an action reached through a variable this file's alias pass cannot
 *     follow (it follows one hop: `const deleteXWithId = (id) =>
 *     deleteX.bind(null, jobId, id)`);
 *   - whether the confirm it found is laid out correctly. That is the
 *     `pinned` rule above, and neither can see position at all.
 *
 * BOTH DERIVED SETS ARE SIZE-CHECKED AGAINST A SOURCE THAT CANNOT DRIFT WITH
 * THE PATTERN, which is the only reason the rest of it means anything —
 * `scratch-cleanup-order.test.ts` passed thirteen assertions while parsing 180
 * of 181 foreign keys, because a pattern that matches nothing is never missing
 * anything. The function sweep is counted against a bare
 * `export async function` count, the attribute sweep against a bare
 * `action={` count, and the destructive set has to still contain five actions
 * named here by hand. A regex that goes quiet fails loudly instead of passing
 * everything below it.
 */
describe("the destructive-form census", () => {
  const actionsDir = join(appDir, "lib/actions");

  const actionModules = readdirSync(actionsDir)
    .filter((name) => name.endsWith(".ts") && !/\.(test|dbtest)\.ts$/.test(name))
    .map((name) => ({
      path: `lib/actions/${name}`,
      code: withoutComments(readFileSync(join(actionsDir, name), "utf8")),
    }));

  /** `export async function deleteTimeEntry(` — the start of one action. */
  const EXPORTED_ACTION = /^export\s+async\s+function\s+(\w+)/gm;

  /** What "destroys a row" means, read out of the body: a hard delete through
   *  the client, or a soft-delete flag being written. */
  const REMOVES_ROWS = /\.\s*delete(?:Many)?\s*\(|isDeleted\s*:\s*true|deletedAt\s*:/;

  /** Every exported action, with the source between it and the next one. */
  const actionBodies = actionModules.flatMap((module) => {
    const starts = [...module.code.matchAll(EXPORTED_ACTION)];
    return starts.map((start, i) => ({
      name: start[1],
      module: module.path,
      body: module.code.slice(start.index!, starts[i + 1]?.index ?? module.code.length),
    }));
  });

  const destructiveActions = new Set(
    actionBodies.filter((fn) => REMOVES_ROWS.test(fn.body)).map((fn) => fn.name),
  );

  /**
   * `action={deleteX.bind(...)}` / `formAction={deleteXWithId(id)}`.
   *
   * Deliberately brace-free in the value, so an expression containing its own
   * object or arrow body does NOT match — which would be a silent hole, except
   * that the size check below counts these against a bare `action={` and goes
   * red the moment one appears. Fix the pattern then; do not widen it blind.
   */
  const ACTION_ATTR = /\b(action|formAction)=\{([^{}]*)\}/g;

  /** The identifiers in an attribute expression, so membership is an exact
   *  name match rather than a substring: `deleteCostEntryWithId` must be found
   *  by the alias pass, not by happening to contain `deleteCostEntry`. */
  function identifiers(expression: string) {
    return [...expression.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
  }

  /**
   * The tag an attribute sits on: the nearest `<Tag` before it with no `>`
   * between the two. `=>` is rewritten to `==` first, since an arrow in an
   * earlier prop would otherwise look like the end of the tag.
   *
   * Coarse, and it fails LOUD rather than quiet: a misread tag name makes a
   * confirmed delete look bare, which somebody sees immediately, rather than
   * making a bare delete look confirmed.
   */
  function enclosingTag(code: string, index: number) {
    const before = code.slice(0, index).replace(/=>/g, "==");
    const open = [...before.matchAll(/<([A-Za-z][\w.]*)/g)].at(-1);
    if (!open) return "(none)";
    return before.slice(open.index! + open[0].length).includes(">") ? "(closed)" : open[1];
  }

  const CONFIRMING_TAGS = new Set(["ConfirmDelete", "ConfirmDeleteButton"]);

  const sites = tsxFiles(appDir).flatMap((full) => {
    const code = withoutComments(readFileSync(full, "utf8"));
    const path = relative(appDir, full);

    /* One hop of aliasing, which is how `/jobs/[id]` binds its job id:
       `const deleteCostEntryWithId = (id) => deleteCostEntry.bind(null, job.id, id);` */
    const aliases = new Set<string>();
    for (const decl of code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*([^;]*);/g)) {
      const refs = identifiers(decl[2]);
      if (refs.some((ref) => destructiveActions.has(ref) || aliases.has(ref))) aliases.add(decl[1]);
    }

    return [...code.matchAll(ACTION_ATTR)]
      .filter((attr) =>
        identifiers(attr[2]).some((id) => destructiveActions.has(id) || aliases.has(id)),
      )
      .map((attr) => ({
        path,
        line: code.slice(0, attr.index!).split("\n").length,
        expression: attr[2].trim(),
        tag: enclosingTag(code, attr.index!),
      }));
  });

  // THE TWO SIZE CHECKS COME FIRST. Everything below reasons about a derived
  // set, and a derived set has two failure modes: the wrong answer, and an
  // empty question. Only the first one looks like a failure.
  it("splits every exported action out of the action modules", () => {
    const literal = actionModules.reduce(
      (n, m) => n + (m.code.match(/export\s+async\s+function\s+/g) ?? []).length,
      0,
    );
    expect(actionBodies.length).toBe(literal);
    expect(actionBodies.length).toBeGreaterThanOrEqual(200);
    expect(actionModules.length).toBeGreaterThanOrEqual(30);
  });

  it("still recognises a delete when it reads one — the set is not empty", () => {
    // Named by hand because a floor alone cannot tell "the heuristic still
    // works" from "it now matches half of what it used to". Rename one of
    // these and this goes red, which is the deliberate act it should be.
    const anchors = [
      "deleteLineItem",
      "deletePayment",
      "unassignCrewMember",
      "removeTeamMember",
      "cancelInvite",
    ];
    const missing = anchors.filter((name) => !destructiveActions.has(name));
    expect(
      missing,
      `These actions delete rows and the body scan stopped seeing it: ${missing.join(", ")}. ` +
        `A destructive set that has quietly shrunk passes every check below it.`,
    ).toEqual([]);
    expect(destructiveActions.size).toBeGreaterThanOrEqual(50);
  });

  it("reads every action attribute in the app, braces and all", () => {
    const parsed = tsxFiles(appDir).reduce(
      (n, full) =>
        n + [...withoutComments(readFileSync(full, "utf8")).matchAll(ACTION_ATTR)].length,
      0,
    );
    const literal = tsxFiles(appDir).reduce(
      (n, full) =>
        n +
        (withoutComments(readFileSync(full, "utf8")).match(/\b(?:action|formAction)=\{/g) ?? [])
          .length,
      0,
    );
    expect(
      parsed,
      `${literal - parsed} action attribute(s) have braces inside the expression, so the ` +
        `pattern in this file skipped them. A skipped attribute is a delete this census cannot ` +
        `see; widen ACTION_ATTR rather than this number.`,
    ).toBe(literal);
    // A floor, not the exact number: 49 the day this was written. It exists so
    // a sweep that finds nothing cannot pass, and it should move only when
    // somebody can say which forms went.
    expect(parsed).toBeGreaterThanOrEqual(40);
  });

  it("finds the destructive submit controls it is supposed to be judging", () => {
    // A floor under the FILTERED set too: if the alias pass or the identifier
    // match breaks, `sites` empties and "no bare deletes" becomes vacuously
    // true. Every one of these is a real control on a real page — 15 of them
    // the day this was written, nine of which are `/jobs/[id]`, so the floor
    // would not survive that page's clusters being rewritten without somebody
    // having to look.
    expect(sites.length).toBeGreaterThanOrEqual(12);
    expect(sites.every((site) => site.tag !== "(none)" && site.tag !== "(closed)")).toBe(true);
  });

  it("never hands a destructive action to a submit control that does not ask twice", () => {
    const offenders = sites
      .filter((site) => !CONFIRMING_TAGS.has(site.tag))
      .map((site) => `${site.path}:${site.line} <${site.tag}> ${site.expression}`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "These submit controls destroy a row on ONE CLICK:",
            ...offenders.map((o) => `  ${o}`),
            "",
            "CLAUDE.md's list-page conventions say two-step delete, never",
            "window.confirm. A bare <form action={deleteX}> is neither: the row",
            "is gone on the first click, and nothing on the page said so.",
            "",
            "Give the action to a <ConfirmDelete> inside a <RowActions> — the",
            "ordinary actions of the row go in its children, where the armed",
            "state covers them — or to <ConfirmDeleteButton> when the row has no",
            "other action. Read the `pinned` rule above before choosing an order:",
            "Cancel inherits the pixel Delete vacated, and which end that is",
            "depends on the cluster's alignment.",
            "",
            "If an action shows up here whose form is NOT destructive (its body",
            "deletes something incidental), say so in a comment on the action and",
            "add it to this test with the reason — not to a silent allow-list.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  /**
   * THE OTHER HALF: a component that deletes from a CALLBACK, not a form.
   *
   * The rule above reads JSX attributes, so it stops seeing a delete the moment
   * the delete moves into `onConfirm`/`onClick` — which is exactly what
   * converting `/team` to the `ActionResult` pattern did to its two controls.
   * Without this, closing one page's gap would have quietly reopened the other.
   *
   * It is coarse on purpose: file-level, and it only asks whether a file that
   * calls a destructive action mentions a confirm ANYWHERE. A file with two
   * deletes can satisfy it with one. What it does catch is the shape that has
   * actually shipped twice — a row component wired straight to a delete with no
   * confirm in it at all.
   *
   * IT NARROWS THE SET, and the narrowing is the honest part. Destructiveness
   * for the rule above is read from the body alone, which is right for a form
   * whose only job is that action; applied file-wide it pulls in six actions
   * that delete something incidental on the way to doing something else
   * (`restoreAlert`, `sendOutboundEmail`, both QuickBooks pushes,
   * `saveJobMediaAnnotations`, `clearQuickBooksAccountMapping`) and would need
   * an exception each. So here the action must ALSO be named as a removal. A
   * name is weak evidence and this is the one place it is used, with the body
   * check still required alongside it.
   */
  const NAMED_AS_REMOVAL = /^(delete|remove|unassign|cancel|discard)[A-Z]/;

  const removalActions = new Set(
    [...destructiveActions].filter((name) => NAMED_AS_REMOVAL.test(name)),
  );

  /**
   * Files allowed to call a removal with no confirm in them, each with the
   * reason. One entry, and it is a REPORTED GAP rather than an accepted one.
   */
  const CALLBACK_EXCEPTIONS: Record<string, string> = {
    "components/ChangeOrders.tsx":
      "two real one-click destructives (remove-a-proposal, discard-a-draft) reached from " +
      "onClick/onSubmit. Change orders are the other lane (WORK-SPLIT.md), so this is a " +
      "GitHub issue for Diego rather than a drive-by edit in a 2000-line file — listed here " +
      "so the rule stays armed for everybody else in the meantime.",
  };

  it("keeps a confirm in every component that calls a removal from a callback", () => {
    const offenders = tsxFiles(appDir)
      .map((full) => ({ path: relative(appDir, full), code: withoutComments(readFileSync(full, "utf8")) }))
      .filter((f) => f.path !== "components/RowActions.tsx")
      .filter((f) => !(f.path in CALLBACK_EXCEPTIONS))
      .filter((f) =>
        [...f.code.matchAll(/[A-Za-z_$][\w$]*/g)].some((m) => removalActions.has(m[0])),
      )
      /* `<ConfirmDelete`, not `ConfirmDelete` — the ELEMENT, not the name.
         Found by mutating this rule rather than by thinking of it: stripping
         the confirm out of `CancelInviteButton.tsx` and leaving the import
         line behind kept this test GREEN, because an unused import mentions
         the component just as well as a rendered one does. A check that a
         leftover import satisfies is the vacuous shape this file is a list
         of. */
      .filter((f) => !/<ConfirmDelete(Button)?\b/.test(f.code))
      .map((f) => f.path);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "These components call an action that removes rows and contain no",
            "confirm step at all:",
            ...offenders.map((o) => `  ${o}`),
            "",
            "A delete reached from onClick or onSubmit is still a delete. Put it",
            "behind <ConfirmDelete> in a <RowActions> — `onConfirm` takes a",
            "callback, so a client row that owns a transition and renders an",
            "error keeps doing both (CatalogEntryRow.tsx is the reference).",
            "",
            "If the component genuinely should not confirm, add it to",
            "CALLBACK_EXCEPTIONS in this file with the reason.",
            "",
          ].join("\n"),
    ).toEqual([]);
  });

  it("still finds the removal actions this rule judges, and the files that call them", () => {
    // Both halves of the previous test can go vacuous: an empty
    // `removalActions` matches no file, and a file sweep that finds nothing
    // has no offenders either. 53 removals and 38 calling files when written.
    expect(removalActions.size).toBeGreaterThanOrEqual(40);
    for (const anchor of ["deleteLineItem", "removeTeamMember", "cancelInvite", "unassignCrewMember"]) {
      expect(removalActions.has(anchor), `${anchor} stopped reading as a removal`).toBe(true);
    }
    const callers = tsxFiles(appDir).filter((full) =>
      [...withoutComments(readFileSync(full, "utf8")).matchAll(/[A-Za-z_$][\w$]*/g)].some((m) =>
        removalActions.has(m[0]),
      ),
    );
    expect(callers.length).toBeGreaterThanOrEqual(25);
  });
});
