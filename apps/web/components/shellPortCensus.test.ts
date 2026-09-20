/**
 * No full-viewport sizing inside the app shell's scroll port. Issue #376.
 *
 * THE BUG, AS FILED: the document scrolled 112px on `/dashboard` while the
 * shell measured exactly the viewport height and `main` scrolled correctly
 * on its own — `document.scrollingElement.scrollHeight` (973) exceeded
 * `clientHeight` (861) even though nothing outside `main`, and nothing the
 * issue could find inside it, had a `getBoundingClientRect().bottom` past
 * the viewport. The reporter's own hypothesis: something inside the port
 * (the space between the 56px top bar and the 52px metric bar) is sized
 * to the RAW viewport (`h-screen` / `min-h-screen` / `100vh` / `100dvh`)
 * instead of to `--shell-port`, the CSS variable `app/(app)/layout.tsx`
 * declares for exactly this — stated explicitly as a hypothesis rather
 * than a finding, arithmetic that was "suggestive, not proof".
 *
 * WHAT VERIFYING IT FOUND. Every full-viewport-sizing utility in the app
 * was censused (below), and each one was checked by hand against the three
 * things that make it safe: it defines the port rather than consuming it
 * (`app/(app)/layout.tsx` itself), it is `position: fixed` and therefore
 * excluded from the document's scrollable overflow entirely (proven with a
 * real-Chromium repro, not asserted — a `fixed inset-0` element with an
 * absolutely-positioned child taller than the viewport added 0px to
 * `document.scrollingElement.scrollHeight`), it sits outside the shell
 * altogether (the marketing/auth pages, which never render a topbar or a
 * metric bar), or it is `packages/ui/src/SidePanel.tsx`'s safety-net
 * fallback on an otherwise `--shell-port`-bounded value. A same-repro test
 * of `SidePanel` mounted with 3000px of content, using the real compiled
 * Tailwind output, also added 0px. None of today's occurrences reproduce
 * the leak. That is a verified negative, not an assumption — see the PR
 * for the repro methodology; it is not repeated here because a comment
 * cannot fail when the code it describes does.
 *
 * SO THIS FILE IS NOT THE FIX. Nobody has found the element that produced
 * the 112px on the branch that was actually live when it was measured, and
 * this file cannot see one that isn't on `main` today. What it IS: the
 * guard that stops the NEXT one from shipping silently. A page or
 * component that sizes itself to the raw viewport instead of
 * `--shell-port` is exactly the shape of the reporter's hypothesis, and
 * the next time it happens this file names the file and the line instead
 * of costing someone another DevTools session.
 *
 * WHY A CENSUS AND NOT A TYPE OR A LINT RULE. `--shell-port` is a runtime
 * CSS custom property; nothing in the type system or in Tailwind's own
 * linting knows it should have been used instead of `100dvh`. The only
 * place that fact lives is this comment and the one in `layout.tsx` —  so,
 * per this repo's own recurring lesson (`scratch-cleanup-order.test.ts`,
 * `hintCensus.test.ts`), it has to be enforced by a scan that DERIVES its
 * set from the source and counts it independently, not by a hand-kept list
 * that quietly stops being read.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist"]);

/** Every `.tsx` file under `dir`, recursively — the same walk
 * `hintCensus.test.ts` uses, so a file this census cannot see is a file
 * that census cannot see either. */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/** #185's lesson, repeated here on purpose: a comment quoting the pattern
 * it explains can disarm the scanner that reads it. Strip comments before
 * matching anything below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const DIRS = [
  join(repoRoot, "apps/web/app"),
  join(repoRoot, "apps/web/components"),
  join(repoRoot, "packages/ui/src"),
];

const files = DIRS.flatMap((dir) =>
  tsxFiles(dir).map((full) => ({
    path: relative(repoRoot, full),
    code: stripComments(readFileSync(full, "utf8")),
  })),
);

/** A raw-viewport height token: Tailwind's `h-screen`/`min-h-screen`/
 * `max-h-screen`/`h-dvh`/`min-h-dvh`/`h-svh`/`min-h-svh`/`h-lvh`/
 * `min-h-lvh` utilities, or a literal `<number><vh|dvh|svh|lvh>` CSS unit
 * (inside an arbitrary value like `[60dvh]` or a `calc(...)`). Deliberately
 * NOT `vw` — width is not this bug's shape and the shell does not manage
 * it. One match per occurrence, with enough context (80 chars) to see the
 * className it sits inside without re-reading the file. */
const TOKEN = /(?:h-screen|min-h-screen|max-h-screen|h-dvh|min-h-dvh|h-svh|min-h-svh|h-lvh|min-h-lvh|[0-9]+(?:dvh|svh|lvh|vh))/g;

type Hit = { path: string; token: string; context: string };

function findHits(code: string, path: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    hits.push({
      path,
      token: m[0],
      context: code.slice(Math.max(0, at - 80), Math.min(code.length, at + m[0].length + 20)),
    });
  }
  return hits;
}

const hits = files.flatMap((f) => findHits(f.code, f.path));

/**
 * Every occurrence this repo has today, and why each one is not the bug.
 *
 * Keyed by path, so a new occurrence in one of these files (a second
 * `min-h-screen` added to `app/page.tsx`, say) still shows up: the
 * per-file EXPECTED count is checked below, not just membership.
 */
const KNOWN: Record<string, { count: number; because: string }> = {
  "apps/web/app/(app)/layout.tsx": {
    count: 2,
    because:
      "Defines the port rather than consuming it. `h-screen` on the shell " +
      "root IS the app's height, and the `100dvh` here is the one place " +
      "`--shell-port` is computed FROM the viewport — everything else is " +
      "supposed to read `--shell-port`, not this.",
  },
  "apps/web/app/layout.tsx": {
    count: 1,
    because:
      "`<body class=\"min-h-screen\">`, the document root. A floor, not a " +
      "ceiling — it can never make the document taller than the shell " +
      "already is, because the shell itself is exactly `h-screen` " +
      "whenever it renders, and the marketing/auth pages below size " +
      "themselves the same way independently of it.",
  },
  "apps/web/app/page.tsx": {
    count: 1,
    because: "Outside `(app)`: no topbar, no sidebar, no metric bar, no scroll port to escape.",
  },
  "apps/web/app/sign-in/[[...sign-in]]/page.tsx": {
    count: 1,
    because: "Same as app/page.tsx — the Clerk sign-in page, outside the shell.",
  },
  "apps/web/app/sign-up/[[...sign-up]]/page.tsx": {
    count: 1,
    because: "Same as app/page.tsx — the Clerk sign-up page, outside the shell.",
  },
  "apps/web/components/HelpButton.tsx": {
    count: 1,
    because:
      "`fixed` dropdown (`max-h-[calc(100dvh-4.5rem)] w-[min(26rem,calc(100vw-1rem))]`, " +
      "though only the `dvh` counts here — this census deliberately does not " +
      "match `vw`, width is not this bug's shape). " +
      "A `position: fixed` element's box is excluded from the scrollable " +
      "overflow of every ancestor up to the document — verified with a " +
      "real-Chromium repro (a `fixed inset-0` element with an " +
      "absolutely-positioned child taller than the viewport added 0px to " +
      "`document.scrollingElement.scrollHeight`), not assumed from how " +
      "`position: fixed` is supposed to work.",
  },
  "apps/web/components/AskLauncher.tsx": {
    count: 1,
    because: "Same as HelpButton.tsx — the Ask dropdown, `fixed`, same clamp.",
  },
  "apps/web/components/WalkthroughTour.tsx": {
    count: 2,
    because:
      "The phone sheet (`max-h-[60dvh]`), both branches of the same ternary. " +
      "Also `fixed` — this overlay's root is `pointer-events-none fixed " +
      "inset-0`, so the same exclusion applies.",
  },
  "packages/ui/src/SidePanel.tsx": {
    count: 1,
    because:
      "`max-h-[var(--shell-port,100dvh)]` — the ONE occurrence that is " +
      "actually inside the scroll port. The PRIMARY value is " +
      "`--shell-port`; the `100dvh` is a fallback for the (today, always " +
      "false) case that variable is undefined. A same-repro test of this " +
      "exact component, mounted open with 3000px of content via the real " +
      "compiled Tailwind output, measured max-height resolve to " +
      "`--shell-port`'s value and added 0px to the document's scroll " +
      "height. If a future caller ever renders <SidePanel> somewhere " +
      "`--shell-port` is not inherited, the fallback still cannot escape " +
      "whatever DOES contain it, because nothing in this app portals " +
      "outside the shell (see the census below) — but a fallback to a raw " +
      "viewport unit is still the exact shape this file exists to catch, " +
      "which is why it stays named here rather than silently allowed.",
  },
};

describe("the shell-port census (#376)", () => {
  it("finds the app, so an empty sweep cannot pass by accident", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.path)).toContain("apps/web/app/(app)/layout.tsx");
    expect(files.map((f) => f.path)).toContain("packages/ui/src/SidePanel.tsx");
  });

  it("has no createPortal anywhere in the app — every occurrence below is a real DOM descendant of the shell it appears in, not something escaping it via a portal", () => {
    const portals = files.filter((f) => /\bcreatePortal\b/.test(f.code)).map((f) => f.path);
    expect(portals).toEqual([]);
  });

  it("matches the same count a plain scan of the token finds — a scanner that quietly matches fewer occurrences than the token itself is the #224 shape (18 of 181 foreign keys)", () => {
    const literal = files.reduce((n, f) => n + (f.code.match(TOKEN) ?? []).length, 0);
    expect(hits.length).toBe(literal);
    expect(hits.length).toBeGreaterThanOrEqual(10);
  });

  it("accounts for every occurrence — an unlisted file or a count that moved is reported by name, not folded into a generic failure", () => {
    const byPath = new Map<string, Hit[]>();
    for (const h of hits) byPath.set(h.path, [...(byPath.get(h.path) ?? []), h]);

    const problems: string[] = [];

    for (const [path, pathHits] of byPath) {
      const known = KNOWN[path];
      if (!known) {
        problems.push(
          `${path}: ${pathHits.length} new occurrence(s) of a raw viewport-height ` +
            `unit (${pathHits.map((h) => h.token).join(", ")}), not in KNOWN. If this ` +
            `is inside the app shell's scroll port (anything a page under ` +
            `app/(app)/** renders), use var(--shell-port) instead — see the ` +
            `comment on <main> in app/(app)/layout.tsx. If it is a position: ` +
            `fixed overlay or a page outside the (app) shell, add it to KNOWN ` +
            `here with a one-line reason, the same way the existing entries are.`,
        );
        continue;
      }
      if (pathHits.length !== known.count) {
        problems.push(
          `${path}: expected ${known.count} occurrence(s), found ${pathHits.length} ` +
            `(${pathHits.map((h) => h.token).join(", ")}). Update KNOWN's count if this ` +
            `change is deliberate and still safe for the reason already given, or fix ` +
            `the new one if it is not.`,
        );
      }
    }

    for (const path of Object.keys(KNOWN)) {
      if (!byPath.has(path)) {
        problems.push(`${path}: KNOWN expects ${KNOWN[path].count} occurrence(s) but the file has none now — update KNOWN.`);
      }
    }

    expect(problems, problems.length === 0 ? "" : ["", ...problems, ""].join("\n")).toEqual([]);
  });

  it("keeps every KNOWN entry's reason non-empty — an entry with no `because` is a bare allowlist, which is how this exact bug shipped", () => {
    const unreasoned = Object.entries(KNOWN)
      .filter(([, v]) => v.because.trim().length < 20)
      .map(([path]) => path);
    expect(unreasoned).toEqual([]);
  });
});
