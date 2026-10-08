/**
 * An action that promises a readable refusal must not refuse by throwing.
 *
 * THE RULE. Production REDACTS a thrown Server Action message to a digest
 * (CLAUDE.md, verified on a real production build 2026-08-27). So an action
 * whose declared return type is `{ ok: false; error: string }` — however it
 * is spelled — has promised the caller a sentence it can render, and
 * `assertOwner`, which throws, breaks that promise for the owner case only.
 * The person sees a digest where every other refusal in the same function
 * gives them a reason.
 *
 * #166 counted nine such actions. It was eleven. The two it missed are
 * `loadQuickBooksAccounts` and `reconcileQuickBooksInvoices`, which declare
 * the same contract INLINE with a payload rather than as the named
 * `ActionResult`:
 *
 *     Promise<{ ok: true; accounts: … } | { ok: false; error: string }>
 *
 * Both return `{ ok: false, error: "QuickBooks isn't connected." }` for the
 * not-connected case and threw for the owner case — the identical defect.
 * They were missed because the classifier matched the type NAME.
 *
 * SO THIS FILE MATCHES ON THE CONTRACT, NOT THE NAME. A function promises a
 * legible refusal if its return type mentions `ActionResult` or contains an
 * `ok: false` branch with an `error`. Renaming the type, or writing it
 * inline, does not get past it.
 *
 * WHAT IT ALLOWS. Fifteen actions call `assertOwner` inside a `try` whose
 * `catch` converts to `fail(...)`. That is the same five lines written
 * fifteen times — the signal that made `ownerRefusal` the right shape — but
 * it is not a defect: the refusal does reach the person. They are permitted
 * and left alone, because converting them reaches into three other lanes.
 *
 * WHAT IT CANNOT SEE: an action that throws for some other reason, and
 * anything reached by raw SQL. It is a source scan over `lib/actions/*.ts`
 * plus the two files the policed helpers live in.
 *
 * ── IT POLICED ONE HELPER FOR ITS WHOLE LIFE, AND THERE ARE TWO (#679) ──
 *
 * `requireCapabilityForAction` (`lib/authz.ts`) throws too, and its own
 * docstring states the rule this file enforces: "Modules that return
 * `ActionResult` must NOT use this — production redacts a thrown message and
 * the sentence would never arrive." So the convention was written down twice,
 * in the helper and in this census, and the census could only see half of it.
 * No action calls it today, which is why nothing was broken — but the next
 * person who reaches for the capability-shaped helper in an `ActionResult`
 * module is exactly the person this file is for, and the silence would have
 * read as approval.
 *
 * ── WHY TWO AND NOT EIGHT, WHICH IS THE JUDGEMENT IN THIS FILE ──
 *
 * `lib/actions/shared.ts` throws a bare `Error` from seven more helpers, and
 * its own header names them: `assertJobInCompany`, `assertLineItemOnJob`,
 * `assertEditableDirectly`, `assertEditableViaChangeOrder`,
 * `craftClassificationIdFromForm`, `phaseCodeIdFromForm`. Measured rather
 * than assumed — 43 call sites in `ActionResult` actions reach one of them
 * outside any try/catch:
 *
 *     assertJobInCompany             23        craftClassificationIdFromForm  6
 *     assertLineItemOnJob             6        phaseCodeIdFromForm            2
 *     assertEditableDirectly          6        assertEditableViaChangeOrder   0
 *
 * Policing those here would fail the build on 43 sites across two other
 * lanes and assert a rule this codebase deliberately does not hold.
 * `shared.ts` says why, in as many words: they "answer a question about a
 * record, not about a keystroke", and "converting them is a separate
 * decision with its own call sites to check".
 *
 * The distinction is REACHABILITY BY A LEGITIMATE USER. `assertOwner` and
 * `requireCapabilityForAction` refuse a person for who they ARE — a
 * non-owner pressing a button they can see, which is routine and is the
 * whole reason `ownerRefusal` exists. The record guards refuse a claim about
 * a row, reachable only by a forged id or by a job deleted between page load
 * and submit. That second case is real and does produce a digest, so it is
 * recorded in #679 as a finding rather than pretended away — but it is rare,
 * low-severity, and not this file's rule.
 *
 * ── SO THE SCOPE IS DERIVED, NOT LISTED ──
 *
 * CLAUDE.md's census rules are that a deriving check must pin its SIZE and
 * its SCOPE to sources that cannot drift with it, and that for any canonical
 * list you write both guards: that the list is complete, and that it is the
 * only one. A literal two-name list satisfies neither — it is the same
 * hardcoded `assertOwner` that caused this, with one more name.
 *
 * So `permissionRefusalHelpers()` DERIVES the policed set: every exported
 * helper in those two files that throws a bare `Error` AND whose predicate
 * reads a role or a capability. The literal below is asserted to equal it,
 * so adding a third role-throwing helper fails this file rather than
 * silently escaping it. `throwingRefusalHelpers()` derives the wider set the
 * same way and asserts the whole eight, so a NEW bare-`Error` helper of
 * either class cannot appear unclassified.
 *
 * And the prose list in `shared.ts`'s own header is asserted against the
 * derived set too. That sentence is a second copy of a canonical list, and
 * a stale sentence that says a capability is MISSING is the direction
 * CLAUDE.md records as stopping people looking.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionsDir = fileURLToPath(new URL("./actions", import.meta.url));

/** The two files the policed helpers are DEFINED in. Not a guess at where
 *  they might be: each is asserted to exist and to yield helpers below, so a
 *  moved file fails loudly instead of shrinking the derived set to nothing.
 *  `authz.ts` is the reason this census can no longer scan `actions/` alone. */
const HELPER_SOURCES = [
  fileURLToPath(new URL("./actions/shared.ts", import.meta.url)),
  fileURLToPath(new URL("./authz.ts", import.meta.url)),
];

/** A comment quoting the pattern it explains disarmed a census here once
 * (#185), so comments never count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Walks from `open` (the index of a `{`) to its matching `}`. */
function blockEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

type Action = { file: string; name: string; returns: string; body: string };

function actions(): Action[] {
  const out: Action[] = [];
  for (const file of readdirSync(actionsDir).filter((n) => /\.ts$/.test(n) && !/\.(test|dbtest)\.ts$/.test(n))) {
    const source = stripComments(readFileSync(join(actionsDir, file), "utf8"));
    for (const m of source.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) {
      // close the parameter list, so a default value containing `)` is safe
      let i = m.index + m[0].length;
      for (let depth = 1; depth > 0; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") depth -= 1;
      }
      // THE BODY BRACE IS NOT THE NEXT BRACE, and assuming it was gave this
      // file the very blind spot it exists to close. A return type can
      // contain braces of its own —
      // `Promise<{ ok: true; accounts: … } | { ok: false; error: string }>`
      // — so `indexOf("{")` lands inside the TYPE, truncating it before the
      // `ok: false` and pointing the body at the wrong block. The two
      // actions #166 missed are exactly the two shaped like that, so the
      // census reproduced the miss it was written to catch. Found by its
      // own size check, which is the only reason it did not ship.
      //
      // Angle depth is the discriminator: braces inside `<…>` belong to the
      // type. A `>` closing `=>` is not a bracket, hence the `=` guard.
      let open = -1;
      for (let k = i, angle = 0; k < source.length; k += 1) {
        const c = source[k];
        if (c === "<") angle += 1;
        else if (c === ">" && source[k - 1] !== "=") angle -= 1;
        else if (c === "{" && angle <= 0) {
          open = k;
          break;
        }
      }
      if (open < 0) continue;
      out.push({
        file,
        name: m[1],
        returns: source.slice(i, open),
        body: source.slice(open, blockEnd(source, open) + 1),
      });
    }
  }
  return out;
}

/** Does the declared return type promise a refusal the caller can render? */
function promisesReadableRefusal(returns: string): boolean {
  return /ActionResult/.test(returns) || /ok\s*:\s*false/.test(returns);
}

/** Is every call to `helper` in this body inside a `try` whose `catch`
 * converts to a returned failure? Those are the fifteen hand-written
 * wrappers. Took `assertOwner` as a literal until #679; the helper is a
 * parameter now so the second policed helper cannot be checked by a
 * copy of this function that drifts from it. */
function everyCallIsWrapped(body: string, helper: string): boolean {
  const converts = /catch\s*\([\s\S]{0,400}?\b(fail|actionFail)\s*\(/.test(body);
  if (!converts) return false;
  const tryBlocks: Array<[number, number]> = [];
  for (const t of body.matchAll(/\btry\s*\{/g)) {
    const open = body.indexOf("{", t.index);
    tryBlocks.push([open, blockEnd(body, open)]);
  }
  return [...body.matchAll(new RegExp(`\\b${helper}\\s*\\(`, "g"))].every((a) =>
    tryBlocks.some(([s, e]) => a.index > s && a.index < e),
  );
}

/** Calls `helper` at all. */
function calls(body: string, helper: string): boolean {
  return new RegExp(`\\b${helper}\\s*\\(`).test(body);
}

type Helper = { file: string; name: string; body: string };

/** Every exported function in one of `HELPER_SOURCES`, with its body.
 *
 *  `export function` AND `export async function` — the policed pair is one
 *  of each (`assertOwner` is sync, `requireCapabilityForAction` is async),
 *  so a pattern that caught only one would derive a set of one and look
 *  exactly like success. */
function exportedHelpers(): Helper[] {
  const out: Helper[] = [];
  for (const path of HELPER_SOURCES) {
    const source = stripComments(readFileSync(path, "utf8"));
    for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)) {
      let i = m.index + m[0].length;
      for (let depth = 1; depth > 0; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") depth -= 1;
      }
      // Same angle-depth walk as `actions()` above, and for the same
      // reason: a return type may carry braces of its own.
      let open = -1;
      for (let k = i, angle = 0; k < source.length; k += 1) {
        const c = source[k];
        if (c === "<") angle += 1;
        else if (c === ">" && source[k - 1] !== "=") angle -= 1;
        else if (c === "{" && angle <= 0) {
          open = k;
          break;
        }
      }
      if (open < 0) continue;
      out.push({ file: path.split("/").slice(-1)[0], name: m[1], body: source.slice(open, blockEnd(source, open) + 1) });
    }
  }
  return out;
}

/** A bare `throw new Error(...)`, which `runAction` RE-THROWS — so production
 *  redacts it. Deliberately not `InputError`: `runAction` converts that one
 *  to `actionFail(err.message)`, which is the readable path, so an
 *  `InputError` thrower is not a defect and must not be policed as one. */
function throwsBareError(body: string): boolean {
  return /\bthrow\s+new\s+Error\s*\(/.test(body);
}

/** Does the throw hang off a question about WHO the caller is, rather than
 *  about a row? `user.role !== "OWNER"` and `!can(context, capability)` are
 *  the two shapes; a record guard reads a `findFirst` result instead. */
function refusesOnIdentity(body: string): boolean {
  return /\brole\b/.test(body) || /\bcan\s*\(/.test(body);
}

function throwingRefusalHelpers(): Helper[] {
  return exportedHelpers().filter((h) => throwsBareError(h.body));
}

function permissionRefusalHelpers(): Helper[] {
  return throwingRefusalHelpers().filter((h) => refusesOnIdentity(h.body));
}

/** The policed set, asserted below to equal what is DERIVED from the two
 *  source files. Written out so the failure message can name it and so a
 *  reader of this file knows what it covers without running it. */
const POLICED = ["assertOwner", "requireCapabilityForAction"] as const;

/** Every bare-`Error` helper in those files, both classes. Asserted whole, so
 *  a NEW one cannot appear without being classified. The six beyond `POLICED`
 *  are the record guards `shared.ts`'s header names — see this file's header
 *  for why they are recorded rather than policed. */
const ALL_THROWING = [
  "assertJobInCompany",
  "assertEditableDirectly",
  "assertEditableViaChangeOrder",
  "assertLineItemOnJob",
  "craftClassificationIdFromForm",
  "phaseCodeIdFromForm",
  "assertOwner",
  "requireCapabilityForAction",
] as const;

describe("the owner-refusal census", () => {
  const all = actions();

  // THE SIZE CHECK FIRST. A parser that matches nothing passes every
  // assertion below it, because nothing is ever missing from an empty list
  // — the exact way scratch-cleanup-order.test.ts stayed green at 180 of
  // 181 foreign keys. Both counts come from literals the parser cannot
  // shrink with it.
  it("parses every exported action and every policed call the sources contain", () => {
    const files = readdirSync(actionsDir).filter((n) => /\.ts$/.test(n) && !/\.(test|dbtest)\.ts$/.test(n));
    const text = files.map((f) => stripComments(readFileSync(join(actionsDir, f), "utf8"))).join("\n");
    expect(all.length).toBe((text.match(/export\s+async\s+function\s+\w+\s*\(/g) ?? []).length);
    // Per policed helper, not just `assertOwner` — a count that covered one
    // of two would be the same half-blindness #679 is about, wearing a size
    // assertion. The lookbehind drops a helper's own DECLARATION, which is
    // not a call site. Found by this very assertion reporting 35 against 36
    // — it was right that the two disagreed, and the cause was the literal
    // counting a definition rather than the parser missing a call.
    for (const helper of POLICED) {
      const parsed = all.reduce((n, a) => n + (a.body.match(new RegExp(`\\b${helper}\\s*\\(`, "g")) ?? []).length, 0);
      const literal = (text.match(new RegExp(`(?<!function\\s)\\b${helper}\\s*\\(`, "g")) ?? []).length;
      expect(parsed, `${helper}: parsed ${parsed} calls, the sources contain ${literal}`).toBe(literal);
    }
    expect(all.length).toBeGreaterThan(100);
  });

  // THE SCOPE CHECK. The policed set is DERIVED from the two files the
  // helpers live in and then compared with the literal, so neither can
  // drift alone: a third role-throwing helper fails here instead of
  // escaping the census, and a literal that outlives its helper fails too.
  // CLAUDE.md's theme-contrast scar is the reason this exists separately
  // from the size check above — a size assertion answers "did the pattern
  // stop matching", never "am I looking everywhere the answer could be".
  it("derives the policed helpers from their sources instead of trusting a name", () => {
    // Each source must yield something. A moved or renamed file would
    // otherwise shrink the derived set to nothing, which looks identical to
    // a codebase with no throwing helpers in it.
    for (const path of HELPER_SOURCES) {
      expect(
        exportedHelpers().filter((h) => h.file === path.split("/").slice(-1)[0]).length,
        `${path} yielded no exported functions, so the derived set is not what it appears to be`,
      ).toBeGreaterThan(0);
    }
    expect(
      permissionRefusalHelpers().map((h) => h.name).sort(),
      "the helpers that throw a bare Error on a role or capability check are not the ones this census polices",
    ).toEqual([...POLICED].sort());
    expect(
      throwingRefusalHelpers().map((h) => h.name).sort(),
      "a helper throwing a bare Error appeared or vanished — classify it as a permission refusal (policed) " +
        "or a record guard (recorded in this file's header and in #679)",
    ).toEqual([...ALL_THROWING].sort());
  });

  // The prose in shared.ts's header is a SECOND COPY of the record-guard
  // list, and this repo's most expensive habit is a sentence that was true
  // when written. Asserted against the derived set so it cannot rot.
  //
  // THE FIRST VERSION OF THIS TEST WAS VACUOUS AND ITS OWN MUTATION CAUGHT
  // IT. It asked whether the whole FILE contained each name — a file in
  // which every one of them is necessarily DECLARED, so the assertion was
  // satisfied by the `export function` line and deleting the roll-call
  // sentence left it green. It was measuring that a function exists.
  //
  // So the comment is isolated first, by its own opening sentence, and the
  // isolation is asserted before anything is read out of it: a roll-call
  // that has been reworded fails HERE, loudly, rather than silently
  // becoming an empty haystack in which nothing can be missing.
  it("keeps shared.ts's own roll-call of bare-Error guards honest", () => {
    const source = readFileSync(HELPER_SOURCES[0], "utf8");
    const marker = "THE OWNERSHIP AND STATE GUARDS below still throw a bare";
    const at = source.indexOf(marker);
    expect(
      at,
      "shared.ts's roll-call of its bare-Error guards has been reworded or removed — this check cannot " +
        `find the sentence beginning "${marker}", so it can no longer tell whether that list is complete`,
    ).toBeGreaterThan(-1);
    const end = source.indexOf("*/", at);
    expect(end, "the roll-call sentence is not inside a block comment any more").toBeGreaterThan(at);
    const rollCall = source.slice(at, end);

    const recorded = throwingRefusalHelpers()
      .map((h) => h.name)
      .filter((n) => n !== "requireCapabilityForAction");
    for (const name of recorded) {
      expect(
        rollCall.includes(name),
        `shared.ts throws a bare Error from ${name} and its own roll-call no longer names it`,
      ).toBe(true);
    }
    expect(recorded.length).toBe(ALL_THROWING.length - 1);
  });

  it("never refuses by throwing from an action that promised a readable refusal", () => {
    const offenders = all
      .filter((a) => promisesReadableRefusal(a.returns))
      .flatMap((a) =>
        POLICED.filter((h) => calls(a.body, h) && !everyCallIsWrapped(a.body, h)).map(
          (h) => `${a.file}: ${a.name} (${h})`,
        ),
      );
    expect(
      offenders,
      `These actions declare a refusal the caller renders and then refuse by throwing, which ` +
        `production redacts to a digest — use ownerRefusal() and a returned fail() instead: ` +
        `${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("still finds the wrapped callers, so the check above is not passing by seeing nothing", () => {
    // If this drops to zero, `everyCallIsWrapped` has stopped recognising
    // the try/catch shape and the check above has gone quietly permissive
    // rather than strict.
    const wrapped = all
      .filter((a) => promisesReadableRefusal(a.returns))
      .filter((a) => POLICED.some((h) => calls(a.body, h) && everyCallIsWrapped(a.body, h)));
    expect(wrapped.length).toBeGreaterThanOrEqual(10);
  });
});
