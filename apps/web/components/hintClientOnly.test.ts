/**
 * NO SERVER COMPONENT MAY RENDER <Hint>.
 *
 * `Hint` clones the one control it is given, which means it READS that
 * control's props. A control a server component wrote does not reliably
 * arrive as something with props: React's production Flight serializer
 * defers any element it reaches once the current row has passed 3,200
 * bytes (`3200 < serializedSize`, twice, in
 * `react-server-dom-webpack-server.edge.production.js`) into a row of its
 * own and writes `"$L<id>"` in its place. The browser turns that back into
 * a lazy — `createLazyChunkWrapper` in
 * `react-server-dom-webpack-client.browser.production.js`, i.e.
 * `{ $$typeof, _payload, _init }` — which has no `.props`.
 *
 * On 2026-09-21 that was `MetricBar`, in the `(app)` layout. Reading
 * `props["aria-describedby"]` off the lazy threw, and because the bar is
 * in the SHELL it threw on the dashboard, the jobs list and every job tab
 * at once, on a real contractor's account, with no way back from the UI.
 * The trigger was one invoice moving a few bytes of the same row.
 *
 * Why a census rather than trusting the guard in `Hint`: the guard stops
 * the crash and SILENTLY DROPS the description, which is the entire
 * feature. A lost description is invisible — nothing fails, nobody using a
 * mouse notices, and only somebody on a screen reader pays. So the guard
 * is the floor, and this is the thing that must actually hold.
 *
 * And why it cannot be caught any later: the byte threshold does not exist
 * in the DEVELOPMENT build of that serializer. `next dev` cannot produce
 * it at any payload size — verified by sweeping one — so a server-side
 * <Hint> is clean on a laptop and fatal on production.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** `apps/web` — everything this app's bundler compiles. Not a subdirectory
 *  of it: a file outside the walk is not a small set, it is not in the set
 *  at all, and no count can notice that (the 2026-09-16 theme-contrast
 *  census). The canary below is what proves the walk reached anything. */
const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SKIP = new Set(["node_modules", ".next", ".git", "e2e", "public"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(APP_ROOT);

/** Any import of the Hint module, however it is spelled. Deliberately not
 *  anchored to a quote style or an alias. */
const IMPORTS_HINT = /from\s+["'](?:@\/components\/Hint|\.{1,2}\/(?:components\/)?Hint)["']/;
/** The directive as the bundler reads it: first non-empty, non-comment
 *  line of the file. */
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\s)*["']use client["']/;

const RENDERS_HINT = /<Hint[\s/>]/;

const importers = files
  .map((path) => ({ path, source: readFileSync(path, "utf8") }))
  .filter((file) => IMPORTS_HINT.test(file.source));

const relative = (path: string) => path.slice(APP_ROOT.length);
const relativeOf = (file: { path: string }) => relative(file.path);

describe("every file that renders <Hint> is a client component", () => {
  /* THE SCOPE CANARY. A pattern that matches nothing passes every
     assertion below it, because nothing is ever missing from an empty
     list. `Hint.tsx` must be in the walk, and `hint.test.ts` must be
     among the importers — two files that exist for other reasons and
     would have to be deleted for this to pass vacuously. */
  it("walked the directory the component lives in", () => {
    expect(files.some((path) => relative(path) === "components/Hint.tsx")).toBe(true);
    expect(importers.map((f) => relative(f.path))).toContain("components/hint.test.ts");
  });

  it("found the importers the repository actually has", () => {
    /* Not a hardcoded number. The same question asked a second way — the
       quoted module specifier, found by plain substring rather than by the
       pattern above — so a pattern that stops matching shrinks one side
       and not the other, and fails loudly instead of quietly scanning
       nothing. This file is excluded because it necessarily contains the
       specifier while importing nothing. */
    const byLiteral = files.filter(
      (path) =>
        relative(path) !== "components/hintClientOnly.test.ts" &&
        readFileSync(path, "utf8").includes('"@/components/Hint"'),
    );
    expect(importers.map(relativeOf).sort()).toEqual(byLiteral.map(relative).sort());
    expect(importers.length).toBeGreaterThan(5);
  });

  /* Test files are excluded: nothing bundles them, so none of them can be
     a server component, and their prose mentions `<Hint>` freely. The
     canary above still requires `hint.test.ts` to be among the IMPORTERS,
     so excluding them here cannot empty the walk. */
  const rendered = importers.filter(
    (file) => RENDERS_HINT.test(file.source) && !/\.(?:db)?test\.tsx?$/.test(file.path),
  );

  it("found files that actually render it", () => {
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.map(relativeOf)).toContain("components/MetricBar.tsx");
  });

  it.each(rendered.map((file) => [relative(file.path), file.source] as const))(
    '%s declares "use client"',
    (path, source) => {
      expect(
        USE_CLIENT.test(source),
        `${path} renders <Hint>, which reads its child's props. A child written by a ` +
          `server component can reach the browser as a React lazy with no props, and ` +
          `reading them throws — see this file's header. Add "use client", or move the ` +
          `<Hint> into a component that has it.`,
      ).toBe(true);
    },
  );
});
