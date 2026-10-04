import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A pay-app `scheduledValue` is derived in ONE place, or the place that
 * derives it says how it guarantees the line is live.
 *
 * THE RULE, and it is issue #567. A line a deductive change order REMOVED
 * does not carry `quantity * unitPrice` any more — it is closed out at what
 * it has earned (`scheduledValueFor` in pay-application-query.ts, with the
 * AIA reasoning on it). `submitPayApplication` carried its own copy of the
 * live-line half of that expression, under a comment that even named the
 * limitation — "Same expression the job page and the report use for a LIVE
 * line" — and selected no `isDeleted`, so a removed line was measured
 * against its pre-deduction value and accepted $25,000 of new billing on a
 * document a GC pays against.
 *
 * WHY THIS CENSUS AND NOT JUST THE UNIT TEST. `pay-application-submit-ceiling.test.ts`
 * pins the composition — `scheduledValueFor` feeding `payAppEntryError` —
 * and it would stay GREEN if `billing.ts` stopped calling either one,
 * because a pure test cannot see its own call site. That is this repo's
 * "written, documented, and never called" shape, and the fix for #567 is
 * exactly the kind that invites it: a one-line revert to a local
 * multiplication reads like a simplification.
 *
 * AND IT IS THE "IS THERE A SECOND ONE" KIND, NOT THE COMPLETENESS KIND
 * (CLAUDE.md, #526). A test that `scheduledValueFor` is correct cannot see
 * a consumer that has stopped importing it. So this asks the other
 * question: is there a second expression?
 *
 * ONE SITE IS DELIBERATELY ALLOWED, AND THE ALLOWANCE IS CONDITIONAL. The
 * pay-app FORM (`jobs/[id]/(tabs)/billing/page.tsx`) multiplies directly,
 * and that is correct — its query filters `isDeleted: false`, so every line
 * it holds is live and the raw expression IS the live branch. But its
 * correctness lives in a `where` clause sixty lines from the arithmetic, so
 * removing that filter (to show removed lines on the form, say) would
 * reintroduce #567 with nothing to say so. The exception therefore asserts
 * the filter as well as naming the file.
 */

const libDir = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(libDir, "..");

/**
 * SCOPE, pinned to directories asserted to exist rather than to this
 * file's own neighbours — CLAUDE.md's `theme-contrast` lesson: "nothing is
 * ever missing from a directory you do not walk", and a root that silently
 * resolves to nothing shrinks the census instead of failing it.
 */
const ROOTS = ["app", "components", "lib"] as const;

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    const abs = path.join(webRoot, root);
    expect(existsSync(abs), `census root ${root} does not exist — scope has drifted`).toBe(true);
    walk(abs, out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|dbtest)\.tsx?$/.test(entry)) continue;
    out.push(abs);
  }
}

/** Comments stripped, because three of the files below DISCUSS this
 * expression in prose — `portal-query.ts` and `portal/[token]/page.tsx`
 * both quote the very multiplication they no longer perform. A raw-text
 * census would report those as offenders. #185's shape. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const rel = (abs: string) => path.relative(webRoot, abs).split(path.sep).join("/");

/** A site that assigns `scheduledValue:` from an expression mentioning
 * `quantity` — i.e. DERIVES it from line-item data, rather than passing
 * through an already-computed figure or using a literal. */
const DERIVES = /scheduledValue\s*:\s*[^,\n]*quantity[^,\n]*/g;

/**
 * Every site that produces a `scheduledValue` at all, however it gets the
 * number. Deliberately shares no sub-expression with `DERIVES` so it can
 * serve as that pattern's independent size check — CLAUDE.md's rule that a
 * deriving check must assert the size of its set against a source that
 * cannot drift with it. `DERIVES` is SUPPOSED to shrink to one as sites
 * adopt the shared function, so it cannot police itself.
 */
const PRODUCES = /scheduledValue\s*:\s*(?!number|Decimal|DecimalLike)[^,\n]+/g;

/** The one site allowed to derive it directly, and why. The reason is not
 * decoration: it names the condition the allowance depends on, which the
 * test below then asserts independently. */
const EXCEPTIONS: Record<string, { reason: string; requires: RegExp }> = {
  "app/(app)/jobs/[id]/(tabs)/billing/page.tsx": {
    reason:
      "the pay-app FORM, whose own query filters isDeleted:false — every line it holds is live, " +
      "so the raw multiplication is exactly the live branch of scheduledValueFor",
    requires: /lineItems:\s*\{\s*where:\s*\{\s*isDeleted:\s*false\s*\}/,
  },
};

describe("a pay-app scheduledValue is derived in one place", () => {
  it("every site that derives one calls scheduledValueFor, or is a named exception", () => {
    const offenders: string[] = [];
    let derivingSites = 0;
    let producingSites = 0;

    for (const file of sourceFiles()) {
      const text = code(file);
      producingSites += (text.match(PRODUCES) ?? []).length;

      const matches = text.match(DERIVES);
      if (!matches) continue;
      derivingSites += matches.length;

      const name = rel(file);
      if (name in EXCEPTIONS) continue;
      if (/scheduledValueFor\s*\(/.test(text)) continue;

      offenders.push(`${name}: ${matches.map((m) => m.trim()).join(" | ")}`);
    }

    expect(
      offenders,
      "a pay-app scheduledValue derived from quantity without scheduledValueFor — that is issue #567, " +
        "where a line removed by a deductive change order is measured against its pre-deduction value",
    ).toEqual([]);

    // SIZE, and it has to be measured by the OTHER pattern. `DERIVES` is
    // supposed to shrink as sites adopt the shared function — it is 1 now,
    // the form — so a floor on it would be satisfied by a regex that had
    // stopped working. `PRODUCES` shares no sub-expression with it and does
    // not shrink: the canonical query, submitPayApplication, the form,
    // PayApplications.tsx's pass-through and four landing-page literals.
    expect(
      producingSites,
      "the scheduledValue pattern matched nothing — it has drifted, and an empty set passes every check above",
    ).toBeGreaterThanOrEqual(7);

    // At least one site still derives it directly (the form), so the
    // offender scan above is answering a real question rather than an empty
    // one. If this ever reaches zero the exception list is dead and should
    // be deleted rather than left as decoration.
    expect(
      derivingSites,
      "nothing derives a scheduledValue from quantity any more — delete EXCEPTIONS rather than keep it",
    ).toBeGreaterThanOrEqual(1);
  });

  it("the two non-form sites go through the shared function, named explicitly", () => {
    // Belt and braces on the pattern above: these are the two that #567 was
    // about, and a census that only looked for OFFENDERS would pass if both
    // files disappeared.
    for (const name of ["lib/pay-application-query.ts", "lib/actions/billing.ts"]) {
      const text = code(path.join(webRoot, name));
      expect(text, `${name} no longer calls scheduledValueFor`).toMatch(/scheduledValueFor\s*\(/);
    }
  });

  it("every line-item read that fetches a price accounts for isDeleted, one way or the other", () => {
    // The other half of #567, and the half a call-site check cannot see:
    // `scheduledValueFor` reads `isDeleted` off the row it is handed, so a
    // query that neither selects nor filters it makes every line look live
    // no matter which function does the arithmetic. billing.ts had THREE
    // such reads and only the pay-app one was wrong, which is why this
    // checks all of them rather than anchoring on one — the first version
    // of this test anchored on "the findMany" and matched a different query
    // two hundred lines away.
    //
    // Either discharge is fine and they are not interchangeable: filtering
    // `isDeleted: false` means the population is live by construction;
    // selecting `isDeleted` means the arithmetic can branch. What is not
    // fine is doing neither while reading a price.
    const text = code(path.join(webRoot, "lib/actions/billing.ts"));
    const reads = text.match(/jobLineItem\.findMany\(\{[\s\S]{0,600}?\n  \}\)/g) ?? [];
    expect(
      reads.length,
      "found no jobLineItem.findMany in billing.ts — this check has drifted and proves nothing",
    ).toBeGreaterThanOrEqual(3);

    const priced = reads.filter((read) => /unitPrice/.test(read));
    expect(
      priced.length,
      "no priced line-item read found in billing.ts — the pattern has drifted",
    ).toBeGreaterThanOrEqual(1);

    for (const read of priced) {
      expect(
        /isDeleted:\s*(true|false)/.test(read),
        "a line-item read in billing.ts fetches unitPrice while neither selecting nor filtering " +
          `isDeleted — scheduledValueFor will treat a removed line as live (issue #567):\n${read}`,
      ).toBe(true);
    }
  });

  it("every exception still satisfies the condition its reason claims", () => {
    // An allowlist entry whose justification has quietly stopped being true
    // is worse than no allowlist: it reads as a considered decision.
    const names = Object.keys(EXCEPTIONS);
    expect(names.length, "the exception list is empty — delete it rather than keep a dead mechanism").toBeGreaterThan(0);

    for (const [name, { reason, requires }] of Object.entries(EXCEPTIONS)) {
      const abs = path.join(webRoot, name);
      expect(existsSync(abs), `exception names ${name}, which does not exist`).toBe(true);
      expect(reason.length, `${name}'s exception needs a real reason`).toBeGreaterThan(20);
      expect(
        code(abs),
        `${name} is allowed to derive scheduledValue directly ONLY because: ${reason}. That is no longer true.`,
      ).toMatch(requires);
    }
  });
});
