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
 * WHAT IT CANNOT SEE: an action that throws for some other reason, a helper
 * that throws on the action's behalf, and anything reached by raw SQL. It
 * is a source scan over `lib/actions/*.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionsDir = fileURLToPath(new URL("./actions", import.meta.url));

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

/** Is every `assertOwner` in this body inside a `try` whose `catch` converts
 * to a returned failure? Those are the fifteen hand-written wrappers. */
function everyAssertOwnerIsWrapped(body: string): boolean {
  const converts = /catch\s*\([\s\S]{0,400}?\b(fail|actionFail)\s*\(/.test(body);
  if (!converts) return false;
  const tryBlocks: Array<[number, number]> = [];
  for (const t of body.matchAll(/\btry\s*\{/g)) {
    const open = body.indexOf("{", t.index);
    tryBlocks.push([open, blockEnd(body, open)]);
  }
  return [...body.matchAll(/\bassertOwner\s*\(/g)].every((a) =>
    tryBlocks.some(([s, e]) => a.index > s && a.index < e),
  );
}

describe("the owner-refusal census", () => {
  const all = actions();

  // THE SIZE CHECK FIRST. A parser that matches nothing passes every
  // assertion below it, because nothing is ever missing from an empty list
  // — the exact way scratch-cleanup-order.test.ts stayed green at 180 of
  // 181 foreign keys. Both counts come from literals the parser cannot
  // shrink with it.
  it("parses every exported action and every assertOwner the sources contain", () => {
    const files = readdirSync(actionsDir).filter((n) => /\.ts$/.test(n) && !/\.(test|dbtest)\.ts$/.test(n));
    const text = files.map((f) => stripComments(readFileSync(join(actionsDir, f), "utf8"))).join("\n");
    expect(all.length).toBe((text.match(/export\s+async\s+function\s+\w+\s*\(/g) ?? []).length);
    // The lookbehind drops `assertOwner`'s own DECLARATION in shared.ts,
    // which is not a call site. Found by this very assertion reporting 35
    // against 36 — it was right that the two disagreed, and the cause was
    // the literal counting a definition rather than the parser missing a
    // call. Diagnosed rather than loosened.
    expect(all.reduce((n, a) => n + (a.body.match(/\bassertOwner\s*\(/g) ?? []).length, 0)).toBe(
      (text.match(/(?<!function\s)\bassertOwner\s*\(/g) ?? []).length,
    );
    expect(all.length).toBeGreaterThan(100);
  });

  it("never refuses by throwing from an action that promised a readable refusal", () => {
    const offenders = all
      .filter((a) => promisesReadableRefusal(a.returns))
      .filter((a) => /\bassertOwner\s*\(/.test(a.body))
      .filter((a) => !everyAssertOwnerIsWrapped(a.body))
      .map((a) => `${a.file}: ${a.name}`);
    expect(
      offenders,
      `These actions declare a refusal the caller renders and then refuse by throwing, which ` +
        `production redacts to a digest — use ownerRefusal() instead of assertOwner(): ` +
        `${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("still finds the wrapped callers, so the check above is not passing by seeing nothing", () => {
    // If this drops to zero, `everyAssertOwnerIsWrapped` has stopped
    // recognising the try/catch shape and the check above has gone quietly
    // permissive rather than strict.
    const wrapped = all
      .filter((a) => promisesReadableRefusal(a.returns))
      .filter((a) => /\bassertOwner\s*\(/.test(a.body))
      .filter((a) => everyAssertOwnerIsWrapped(a.body));
    expect(wrapped.length).toBeGreaterThanOrEqual(10);
  });
});
