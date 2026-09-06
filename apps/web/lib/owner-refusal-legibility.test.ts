import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertOwner, ownerRefusal } from "./actions/shared";

/**
 * An action that promises a legible refusal must not refuse by throwing.
 *
 * THE RULE (Diego, on #87, and the whole of #166): a guard whose reason
 * cannot be read is a guard that only looks like it is protecting
 * something. Production redacts a thrown Server Action message to a digest
 * — verified 2026-08-27 on a real production build — so an action whose
 * contract is `{ ok: false, error }` cannot keep that contract while
 * refusing through `assertOwner`, which throws.
 *
 * Before this, `deleteSafetyIncident` refused an ACCOUNTING member with a
 * sentence and a non-owner MEMBER with a digest, from two adjacent lines.
 * Eleven actions were in that state and thirteen more had each hand-written
 * the same five-line `try`/`catch` around `assertOwner` to avoid it — and
 * those thirteen had already drifted, one falling back to "Not permitted"
 * where the other twelve said "Only the account owner can do that".
 *
 * WHY THIS IS A SOURCE-LEVEL CHECK AND NOT AN EXECUTION ONE. Both spellings
 * refuse the same person; they differ only in whether the reason survives a
 * PRODUCTION build. Vitest does not build for production and neither does
 * `next dev`, so no test that CALLS these actions can tell the two apart —
 * a test that executed `deleteSafetyIncident` as a MEMBER passed happily
 * throughout the entire period the bug existed. The difference is visible in
 * the source and nowhere else, so the source is where it is checked.
 *
 * Built to the rule lib/permissions.test.ts and
 * lib/action-capability-guards.test.ts are built to: IT MUST FAIL WHEN
 * SOMETHING IS MISSING, NOT ONLY WHEN SOMETHING PRESENT IS WRONG. Nothing
 * here is a hand-written list of actions — it enumerates every module in
 * lib/actions and every exported action in it, so a new action wired up
 * with `assertOwner` inside an `ok`-shaped function fails this suite by
 * name on the run that introduces it.
 */

const ACTIONS_DIR = resolve(__dirname, "actions");

const MODULES = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".dbtest."))
  .sort();

/** A walk that quietly finds nothing is the most dangerous way for a check
 * like this to fail, so the walk guards itself first. */
it("finds the action modules it is supposed to be checking", () => {
  expect(MODULES.length).toBeGreaterThan(20);
  expect(MODULES).toContain("safety.ts");
  expect(MODULES).toContain("quickbooks.ts");
  expect(MODULES).toContain("shared.ts");
});

type Action = {
  module: string;
  name: string;
  /** Everything between the function's opening `{` and its matching `}`. */
  body: string;
  /** The declared return type, or "" when the function has no annotation. */
  returnType: string;
};

/** The body of the function whose signature ends at `headerEnd`, found by
 * matching braces from the first `{` after it. Crude next to a real parser
 * and deliberately so — a parser is a dependency, and the failure mode here
 * is a body that reads too long, which can only produce a FALSE ALARM that
 * someone then reads. It cannot produce a silent pass. */
function bodyFrom(src: string, headerEnd: number): string {
  const open = src.indexOf("{", headerEnd);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

function actionsIn(module: string): Action[] {
  const src = readFileSync(join(ACTIONS_DIR, module), "utf8");
  const found: Action[] = [];
  // `export async function name(` … up to the `{` that opens the body.
  const signature = /^export async function (\w+)\s*\(/gm;
  for (const match of src.matchAll(signature)) {
    const name = match[1];
    const open = src.indexOf("{", match.index!);
    if (open === -1) continue;
    const header = src.slice(match.index!, open);
    // The return annotation is whatever follows the LAST `)` in the header.
    const closeParen = header.lastIndexOf(")");
    const returnType = closeParen === -1 ? "" : header.slice(closeParen + 1).replace(/^:\s*/, "").trim();
    found.push({ module, name, body: bodyFrom(src, match.index!), returnType });
  }
  return found;
}

const ALL_ACTIONS = MODULES.flatMap(actionsIn);

it("finds the actions it is supposed to be checking", () => {
  expect(ALL_ACTIONS.length).toBeGreaterThan(100);
  const names = ALL_ACTIONS.map((a) => `${a.module}:${a.name}`);
  expect(names).toContain("safety.ts:deleteSafetyIncident");
  expect(names).toContain("quickbooks.ts:pushInvoiceToQuickBooks");
});

/**
 * Does this action promise its refusals are legible?
 *
 * Two independent signals, ORed, because either one alone misses a real
 * case. The declared type catches `Promise<ActionResult>` and the bespoke
 * `{ ok: true; rows: … } | { ok: false; error: string }` unions in
 * quickbooks.ts — the ones #166's own classifier missed, because it keyed
 * on the literal name `ActionResult` and `loadQuickBooksAccounts` and
 * `reconcileQuickBooksInvoices` do not use it. The body signal catches an
 * action that returns a failure without ever annotating its return type,
 * where the promise is just as real and the annotation is what is missing.
 */
function promisesLegibleRefusals(action: Action): boolean {
  const declared =
    /\bActionResult\b/.test(action.returnType) ||
    (/\bok\s*:\s*false\b/.test(action.returnType) && /\berror\s*:\s*string\b/.test(action.returnType));
  const returnsAFailure = /\breturn\s+(actionFail|fail)\s*\(/.test(action.body);
  return declared || returnsAFailure;
}

describe("an action promising ActionResult never refuses by throwing", () => {
  const promising = ALL_ACTIONS.filter(promisesLegibleRefusals);

  it("finds the actions that make the promise", () => {
    // If this collapses to nothing the check below passes vacuously, which
    // is exactly the failure this repo keeps rediscovering.
    expect(promising.length).toBeGreaterThan(50);
  });

  it("uses ownerRefusal, never assertOwner", () => {
    const offenders = promising
      .filter((a) => /\bassertOwner\s*\(/.test(a.body))
      .map((a) => `${a.module}:${a.name}`);

    expect(
      offenders,
      "These actions return { ok: false, error } for every other failure but " +
        "refuse a non-owner by THROWING, and production redacts a thrown " +
        "message to a digest. Use `ownerRefusal(context, \"…\")` and return " +
        "what it gives you:\n" +
        "    const denied = ownerRefusal(context, \"Only the account owner can …\");\n" +
        "    if (denied) return denied;",
    ).toEqual([]);
  });

  /**
   * The workaround, banned outright rather than merely made unnecessary.
   *
   * Thirteen call sites wrote this by hand and two of them had already
   * drifted on the fallback message. It behaves correctly, which is why
   * nobody removed it — so leaving it merely discouraged would keep the
   * fourteenth from being noticed.
   */
  it("does not hand-roll a try/catch around assertOwner", () => {
    const offenders = ALL_ACTIONS.filter((a) =>
      /catch\s*\([^)]*\)\s*\{[^}]*\b(fail|actionFail)\s*\(/s.test(a.body) &&
      /\bassertOwner\s*\(/.test(a.body),
    ).map((a) => `${a.module}:${a.name}`);

    expect(
      offenders,
      "`assertOwner` wrapped in a local try/catch that converts to a " +
        "returned failure. That is `ownerRefusal`'s whole job — call it " +
        "directly and delete the wrapper.",
    ).toEqual([]);
  });
});

/**
 * The two helpers cannot disagree about who an owner is.
 *
 * They share one implementation today, and this is what makes that a
 * checked fact rather than a comment — if someone re-inlines the role test
 * into `assertOwner`, the two can drift and this notices.
 */
describe("assertOwner and ownerRefusal are the same rule", () => {
  const roles = ["OWNER", "MEMBER", "ADMIN", ""];

  for (const role of roles) {
    it(`agrees for role ${JSON.stringify(role)}`, () => {
      const refusal = ownerRefusal({ role });
      let threw: string | null = null;
      try {
        assertOwner({ role });
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      if (refusal === null) {
        expect(threw).toBeNull();
      } else {
        expect(threw).toBe(refusal.error);
      }
    });
  }

  it("carries the caller's own message, not a generic one", () => {
    const refusal = ownerRefusal({ role: "MEMBER" }, "Only the account owner can push to QuickBooks");
    expect(refusal).toEqual({
      ok: false,
      error: "Only the account owner can push to QuickBooks",
    });
  });

  it("falls back to one shared sentence when the caller gives none", () => {
    expect(ownerRefusal({ role: "MEMBER" })?.error).toBe("Only the account owner can do that");
  });

  it("lets an owner through", () => {
    expect(ownerRefusal({ role: "OWNER" })).toBeNull();
  });
});
