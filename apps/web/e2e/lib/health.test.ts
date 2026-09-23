import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The E2E health check (health.ts) fails a page that shows one of a fixed
 * list of crash sentences. A list like that has the failure mode CLAUDE.md
 * documents for every census in this repo: if the wording it looks for
 * stops being the wording the app renders, the check goes green about
 * nothing — a page can crash all it likes in words the list does not know.
 *
 * So this pins the list to its sources, as TEXT, in the unit suite (which
 * runs on every push — the E2E suite does not). If PageLoadError's copy is
 * rewritten, this fails and points at the two places to change together.
 *
 * Read as text rather than imported: health.ts imports @playwright/test,
 * which has no business loading inside vitest, and the check is about the
 * literal strings anyway.
 */
const webRoot = path.resolve(__dirname, "../..");
const healthSource = readFileSync(path.join(__dirname, "health.ts"), "utf8");
const boundarySource = readFileSync(path.join(webRoot, "components/PageLoadError.tsx"), "utf8");

/** The markers, lifted out of health.ts's `CRASH_MARKERS = [ … ]` literal. */
function markersInSource(): string[] {
  const block = healthSource.match(/export const CRASH_MARKERS = \[([\s\S]*?)\] as const;/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("e2e crash markers", () => {
  const markers = markersInSource();

  it("were actually parsed out of health.ts (the check cannot be about an empty list)", () => {
    expect(markers.length).toBeGreaterThanOrEqual(8);
  });

  it("include the wording this app's own error boundary renders", () => {
    // JSX escapes the apostrophe; compare against the rendered form.
    const rendered = boundarySource.replace(/&apos;/g, "'");
    for (const sentence of ["This page didn't load", "Something went wrong reading your data", "If you report this, include reference"]) {
      expect(rendered, `PageLoadError.tsx no longer renders "${sentence}" — update it and CRASH_MARKERS together`).toContain(sentence);
      expect(markers, `CRASH_MARKERS lost "${sentence}"`).toContain(sentence);
    }
  });

  it("include Next's stock boundary and the redacted Server Action sentence", () => {
    for (const sentence of ["Application error", "Digest:", "Server Components render"]) {
      expect(markers).toContain(sentence);
    }
  });

  it("are not words a healthy page uses", () => {
    // A marker that appears in ordinary copy would make every healthy page
    // fail — the opposite failure, and just as useless. `Digest:` with the
    // colon and capital is checked here because the alerts feature does
    // say "digest".
    const appCopy = ["app", "components"].flatMap((dir) => readTsx(path.join(webRoot, dir)));
    // The boundaries themselves are the one place this wording belongs:
    // app/**/error.tsx, global-error.tsx, and the two shared boundary
    // components they render (PageLoadError, PublicRouteError).
    const withoutBoundary = appCopy.filter((file) => !/(?:^|\/)(?:global-)?error\.tsx$/.test(file) && !/[A-Za-z]Error\.tsx$/.test(file));
    for (const marker of markers) {
      // Only COPY is scanned — string literals and JSX text. A comment
      // quoting Next's stock page (CompanySetupGate.tsx) or a prop named
      // `sendMyAlertDigest: () =>` (SendDigestButton.tsx) both contain a
      // marker's characters and neither is ever on screen.
      const offenders = withoutBoundary.filter((file) => copyOf(readFileSync(file, "utf8")).includes(marker));
      expect(offenders, `"${marker}" appears in ordinary app copy, so a healthy page would fail the health check`).toEqual([]);
    }
  });
});

/**
 * The parts of a .tsx file a person can see: string literals (including
 * template literals) and JSX text between tags, with comments removed
 * first. Coarse on purpose — this is a scan for rendered copy, not a
 * parser — and the boundary file's own wording is asserted separately
 * above, so a false negative here costs little while a false positive
 * (a type name, a comment) would fail a healthy page's health check.
 */
function copyOf(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const literals = withoutComments.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = [...withoutComments.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...literals, ...jsxText].join("\n");
}

function readTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...readTsx(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
