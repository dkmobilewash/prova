import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALERT_CAPABILITY } from "./alerts";
import { can, canReach, JOB_FUNCTIONS, type Principal } from "./permissions";

/**
 * Ask's answers now carry "go straight to" buttons — one per record the
 * answer named (`ItemLink` in lib/ask/tools.ts). `needs_attention` is the
 * first tool to emit them, built straight from `alert.href`.
 *
 * A BUTTON IS A STRONGER PROMISE THAN A CITATION. A citation says "this
 * figure came from there". A button says "go here and deal with it". Hand
 * somebody a button to a page their capability refuses and they get a
 * dead end with their name on it — worse than no button, because they
 * went looking.
 *
 * The handler does nothing to earn that safety itself. It relies entirely
 * on `visibleToPrincipal` having already dropped alerts whose capability
 * this person lacks, plus ALERT_CAPABILITY being chosen so an alert never
 * points at a page its recipient cannot open. That second half is a
 * CONVENTION, stated in ALERT_CAPABILITY's own comment — "not to a
 * foreman, who could not open the page the alert points at" — and a
 * convention held only in a comment is the thing this repo keeps paying
 * for. This file makes it fail the build instead.
 *
 * DERIVED, NOT RESTATED: kind-to-href comes out of alerts.ts itself, so it
 * cannot drift from the alerts that are actually built. Deriving has two
 * failure modes and only one looks like failure (CLAUDE.md), so the size
 * check runs FIRST and against a source that cannot drift with the
 * pattern — ALERT_CAPABILITY's own keys, which the compiler requires to be
 * exhaustive over AlertKind.
 */

/* BOTH files, and the second one is the point.
 *
 * The first version of this census read only alerts.ts and reported that
 * RENEWAL had no href — because RENEWAL's alert copies `renewal.href`,
 * which is built in renewals.ts. A census that cannot see the file cannot
 * find the bug in it, and no size assertion catches that: nothing is ever
 * missing from a directory you do not walk (CLAUDE.md, the theme-contrast
 * scope scar). The kind-declaring file and the href-building file are two
 * files, so the scan is two files.
 *
 * Adding a third source of alert hrefs means adding it here, and the size
 * assertion below fails by name until you do. */
const SOURCES = ["./alerts.ts", "./renewals.ts"] as const;

const sources = SOURCES.map((rel) => ({
  name: rel.replace("./", ""),
  text: readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
}));

/** Every (kind, href) an alert is built with.
 *
 * One kind legitimately appears several times with different hrefs
 * (RETAINAGE_RELEASE is raised from three places), so this is a list of
 * pairs rather than a map — checking only the first would skip the others.
 */
type Pair = { kind: string; href: string; where: string };

/* RENEWAL's alert does `href: renewal.href` — the kind and the destination
 * are in different files. So every href built in renewals.ts counts as a
 * RENEWAL href, which is what that file is: the renewals RENEWAL is made
 * from. Stated as a map rather than inferred, because inferring it is how
 * the next file gets silently attributed to the wrong kind. */
const HREFS_BUILT_ELSEWHERE: Record<string, string> = { "renewals.ts": "RENEWAL" };

function builtPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const { name, text } of sources) {
    const borrowed = HREFS_BUILT_ELSEWHERE[name];
    let pending: { kind: string; line: number } | null = null;
    text.split("\n").forEach((line, i) => {
      const kind = /^\s*kind: "([A-Z_]+)",\s*$/.exec(line);
      if (kind) {
        pending = { kind: kind[1], line: i + 1 };
        return;
      }
      const href = /^\s*href: (?:"([^"]+)"|`([^`]+)`),\s*$/.exec(line);
      if (!href) return;
      const value = href[1] ?? href[2];
      if (borrowed) {
        pairs.push({ kind: borrowed, href: value, where: `${name}:${i + 1}` });
        return;
      }
      if (!pending) return;
      pairs.push({ kind: pending.kind, href: value, where: `${name}:${pending.line}` });
      pending = null;
    });
  }
  return pairs;
}

/** `/jobs/${job.jobId}` is a real route with a real guard; the id is not
 * the part under test. Substituted so the href can be resolved at all. */
const concrete = (href: string) => href.replace(/\$\{[^}]+\}/g, "x");

/** Every principal the app can produce: an owner, a member with no job
 * function (who holds everything by rule 2), and one per job function. */
const PRINCIPALS: Principal[] = [
  { role: "OWNER", jobFunction: null },
  { role: "MEMBER", jobFunction: null },
  ...JOB_FUNCTIONS.map((jobFunction) => ({ role: "MEMBER", jobFunction })),
];

describe("an alert never points somewhere its recipient cannot go", () => {
  const pairs = builtPairs();

  it("found an href for every alert kind", () => {
    // The size assertion, and it runs before anything reasons about the
    // pairs. A regex that matched nothing would otherwise pass every
    // assertion below it: nothing is ever unreachable in an empty set.
    const found = new Set(pairs.map((pair) => pair.kind));
    const declared = Object.keys(ALERT_CAPABILITY);
    expect(
      declared.filter((kind) => !found.has(kind)),
      "ALERT_CAPABILITY declares these kinds and alerts.ts builds no href for them — " +
        "either the alert is dead code, or this file's pattern stopped matching " +
        "the shape alerts are written in. Both are worth failing on.",
    ).toEqual([]);
    expect(pairs.length).toBeGreaterThanOrEqual(declared.length);
  });

  it("builds no alert of a kind nobody declared a capability for", () => {
    const declared = new Set(Object.keys(ALERT_CAPABILITY));
    expect(
      [...new Set(pairs.map((p) => p.kind))].filter((kind) => !declared.has(kind)),
      "alerts.ts builds these kinds and ALERT_CAPABILITY does not gate them.",
    ).toEqual([]);
  });

});

/**
 * Alert routings that are wrong today, listed by hand with the reason —
 * the same shape as tools.test.ts's CITATION_CAPABILITY_GAPS, and pruned
 * by the test below so the list cannot quietly become permanent.
 *
 * These are NOT waived. Ask does not render a button for any of them:
 * `needsAttention` filters its links through `canReach`, so the person
 * still gets the alert in the prose and is not handed a dead end. What
 * remains broken is the ALERTS PAGE itself, where the row has always been
 * clickable and has always refused — this census found it, it did not
 * create it.
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  "RETAINAGE_RELEASE -> /closeout":
    "Gated MANAGE_BILLING, points at /closeout which is MANAGE_JOBS. ACCOUNTING holds the first and not the second, so an accounts person is shown 'Retainage on X is collectable' and cannot open what it links to. NOT a one-line fix, which is why it is recorded rather than patched here: there is no single page everyone holding MANAGE_BILLING can open — /cash-flow is VIEW_COMPANY_FINANCIALS, which PROJECT_MANAGER deliberately lacks, and the job page's retainage section has its own gate. Diego's call: retarget the alert, widen ACCOUNTING, or split the alert by audience.",
};

describe("the known-bad routings are still bad", () => {
  const pairs = builtPairs();

  it("lists nothing that has since been fixed", () => {
    const stillBroken = new Set(
      PRINCIPALS.flatMap((principal) =>
        pairs
          .filter((pair) =>
            can(principal, ALERT_CAPABILITY[pair.kind as keyof typeof ALERT_CAPABILITY]),
          )
          .filter((pair) => !canReach(principal, concrete(pair.href)))
          .map((pair) => `${pair.kind} -> ${pair.href}`),
      ),
    );
    expect(
      Object.keys(KNOWN_UNREACHABLE).filter((entry) => !stillBroken.has(entry)),
      "An exception list nobody prunes becomes permanent. These are reachable " +
        "now — delete them from KNOWN_UNREACHABLE.",
    ).toEqual([]);
  });
});

describe("an alert never points somewhere its recipient cannot go, part 2", () => {
  const pairs = builtPairs();

  it.each(PRINCIPALS.map((p) => [p.jobFunction ?? p.role, p] as const))(
    "%s can open every page the alerts they receive point at",
    (_name, principal) => {
      const unreachable = pairs
        .filter((pair) => can(principal, ALERT_CAPABILITY[pair.kind as keyof typeof ALERT_CAPABILITY]))
        .filter((pair) => !canReach(principal, concrete(pair.href)))
        .filter((pair) => !(`${pair.kind} -> ${pair.href}` in KNOWN_UNREACHABLE))
        .map((pair) => `${pair.kind} -> ${pair.href} (${pair.where})`);

      expect(
        unreachable,
        "These alerts are shown to this person and point at a page their " +
          "capability refuses. Ask now renders each one as a 'go straight to' " +
          "button, so this is a dead end they were invited to walk into. Fix " +
          "the ALERT_CAPABILITY entry or the href — not this list.",
      ).toEqual([]);
    },
  );
});
